import { readFile, readlink, realpath, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readGatewayConfiguration } from "./gateway-configuration.mjs";
import { configurationDirectory } from "./configuration.mjs";
import { createGateway } from "./gateway.mjs";
import { createRelayLease } from "./relay-lease.mjs";
import { attachHook } from "./attach.mjs";

const config = await readGatewayConfiguration();
const executable = await realpath(config.lmStudioExecutable);
async function owner() {
  try {
    const { pid } = JSON.parse(
      await readFile(config.lmStudioStateFile, "utf8"),
    );
    if (
      !Number.isInteger(pid) ||
      pid <= 0 ||
      (await readlink(`/proc/${pid}/exe`)) !== executable
    )
      return null;
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : { pid, start: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return null;
    throw error;
  }
}
let identity = await owner();
if (!identity) console.error("LM Studio 未运行，搜索服务保持关闭。");
else {
  await mkdir(configurationDirectory, { recursive: true, mode: 0o700 });
  const leasePath =
      config.leasePath || join(configurationDirectory, "relay.sock"),
    token = randomUUID();
  const lease = await createRelayLease(leasePath, token, () => {
    attached = false;
  });
  const server = createGateway({ ...config, relayToken: token });
  let closing = false,
    checking = false,
    attaching = false,
    attached = false;
  const close = () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    watcher.close();
    void lease.close();
    server.close();
    server.closeAllConnections();
  };
  async function attach() {
    if (attaching || closing || attached) return;
    attaching = true;
    try {
      const apiPort = Number(new URL(config.upstreamUrl).port);
      await attachHook(identity.pid, {
        apiPort,
        relayPort: server.address().port,
        leasePath,
        token,
      });
      attached = true;
      console.error(
        `搜索服务已挂接 LM Studio ${identity.pid}，原入口端口 ${apiPort}。`,
      );
    } catch (error) {
      console.error(error.message);
    } finally {
      attaching = false;
    }
  }
  async function check() {
    if (checking || closing) return;
    checking = true;
    try {
      const current = await owner();
      if (
        !current ||
        current.pid !== identity.pid ||
        current.start !== identity.start
      ) {
        if (!current) close();
        else {
          identity = current;
          attached = false;
          if (server.listening) await attach();
        }
      } else if (server.listening) await attach();
    } catch (error) {
      console.error(error.message);
      close();
      process.exitCode = 1;
    } finally {
      checking = false;
    }
  }
  const watcher = watch(dirname(config.lmStudioStateFile), (_, file) => {
    if (file?.toString() === basename(config.lmStudioStateFile)) void check();
  });
  const timer = setInterval(check, 1000);
  server.listen(0, "127.0.0.1", () => void attach());
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, close);
}

import { readFile, readlink, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, basename } from "node:path";
import { readGatewayConfiguration } from "./gateway-configuration.mjs";
import { createGateway } from "./gateway.mjs";

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
if (!identity) {
  console.error("LM Studio 未运行，搜索网关保持关闭。");
} else {
  const server = createGateway(config);
  let closing = false;
  let checking = false;
  const close = () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    watcher.close();
    server.close();
    server.closeAllConnections();
    console.error("LM Studio 已退出，搜索网关已停止。");
  };
  async function check() {
    if (checking || closing) return;
    checking = true;
    try {
      const current = await owner();
      if (!current) close();
      else if (
        identity.pid !== current.pid ||
        identity.start !== current.start
      ) {
        identity = current;
        console.error(`搜索网关已跟随 LM Studio 进程 ${identity.pid}。`);
      }
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
  const timer = setInterval(check, 250);
  server.listen(config.port, "127.0.0.1", () =>
    console.error(
      `搜索网关已监听 127.0.0.1:${config.port}，跟随 LM Studio 进程 ${identity.pid}。`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, close);
}

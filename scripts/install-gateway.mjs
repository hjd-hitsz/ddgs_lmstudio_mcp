import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readConfiguration,
  configurationDirectory,
} from "../src/configuration.mjs";

const execute = promisify(execFile);
const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const directory = configurationDirectory;
const settingsPath = join(directory, "config.json");
const runtimePath = join(directory, "runtime.json");
const lmHome = join(homedir(), ".lmstudio");
const installation = JSON.parse(
  await readFile(
    join(lmHome, ".internal", "app-install-location.json"),
    "utf8",
  ),
);
const api = JSON.parse(
  await readFile(join(lmHome, ".internal", "http-server-config.json"), "utf8"),
);
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || args[0] !== "--proxy-port" || !/^\d+$/.test(args[1]))
)
  throw new Error(
    "用法：ddgs-lmstudio-mcp install [--proxy-port 7897]；0 表示直连。",
  );
const search = args.length
  ? readConfiguration({ proxyPort: Number(args[1]) })
  : readConfiguration();
const config = {
  upstreamUrl: `http://127.0.0.1:${api.port || 1234}`,
  lmStudioStateFile: join(lmHome, ".internal", "http-server.json"),
  lmStudioExecutable: installation.path,
  lmStudioApiFile: join(lmHome, ".internal", "http-server-config.json"),
};
await mkdir(directory, { recursive: true, mode: 0o700 });
for (const [path, data] of [
  [settingsPath, { proxyPort: search.proxyPort }],
  [runtimePath, config],
]) {
  await writeFile(path + ".tmp", JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(path + ".tmp", path);
}
const units = join(base, "systemd", "user");
await mkdir(units, { recursive: true });
const quote = (value) =>
  '"' +
  String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%") +
  '"';
const service = "ddgs-search-gateway.service";
await writeFile(
  join(units, service),
  `[Unit]\nDescription=Search gateway companion for LM Studio\nStartLimitIntervalSec=30\nStartLimitBurst=10\n\n[Service]\nType=exec\nExecStart=${quote(process.execPath)} ${quote(fileURLToPath(new URL("../src/companion.mjs", import.meta.url)))}\nEnvironment=${quote("DDGS_GATEWAY_CONFIG=" + runtimePath)}\nEnvironment=${quote("XDG_CONFIG_HOME=" + base)}\nEnvironment=NODE_USE_ENV_PROXY=0\nRestart=on-failure\nRestartSec=1\nUMask=0077\n`,
  { mode: 0o600 },
);
await writeFile(
  join(units, "ddgs-search-gateway.path"),
  `[Unit]\nDescription=Start search gateway when LM Studio starts\n\n[Path]\nPathChanged=${config.lmStudioStateFile.replaceAll("%", "%%")}\nUnit=${service}\n\n[Install]\nWantedBy=default.target\n`,
  { mode: 0o600 },
);
await execute("systemctl", ["--user", "daemon-reload"]);
await execute("systemctl", [
  "--user",
  "enable",
  "--now",
  "ddgs-search-gateway.path",
]);
await execute("systemctl", ["--user", "restart", service]);
console.log(
  `已安装 LM Studio 搜索挂接服务，原端口 ${api.port}；${search.proxyPort ? "代理端口 " + search.proxyPort : "直连"}。`,
);

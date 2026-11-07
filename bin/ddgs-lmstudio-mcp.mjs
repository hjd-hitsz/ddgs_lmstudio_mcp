#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const [action, ...args] = process.argv.slice(2);
if (action === "install") {
  process.argv = [...process.argv.slice(0, 2), ...args];
  await import("../scripts/install-gateway.mjs");
} else if (action === "mcp" && !args.length) {
  await import("../src/main.mjs");
} else if (action === "start" && !args.length) {
  await import("../src/companion.mjs");
} else if (action === "status" && !args.length) {
  try {
    execFileSync(
      "systemctl",
      [
        "--user",
        "status",
        "ddgs-search-gateway.path",
        "ddgs-search-gateway.service",
        "--no-pager",
      ],
      { stdio: "inherit" },
    );
  } catch (error) {
    process.exitCode = error.status || 1;
  }
} else {
  console.log(
    "ddgs-lmstudio-mcp install [--proxy-port 7897]\n  安装搜索服务及 LM Studio 启动联动；代理端口 0 表示直连。\nddgs-lmstudio-mcp mcp\n  运行 stdio MCP。\nddgs-lmstudio-mcp start\n  跟随当前 LM Studio 运行搜索网关。\nddgs-lmstudio-mcp status\n  查看启动联动和服务状态。",
  );
  if (action && !["--help", "-h"].includes(action)) process.exitCode = 1;
}

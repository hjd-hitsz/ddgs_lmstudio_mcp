import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfiguration } from "./configuration.mjs";

export async function readGatewayConfiguration() {
  const path =
    process.env.DDGS_GATEWAY_CONFIG ||
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "ddgs-search-gateway",
      "runtime.json",
    );
  const config = JSON.parse(await readFile(path, "utf8"));
  if (config.lmStudioApiFile) {
    const api = JSON.parse(await readFile(config.lmStudioApiFile, "utf8"));
    if (!Number.isInteger(api.port) || api.port < 1 || api.port > 65535)
      throw new Error("LM Studio API 端口无效。");
    config.upstreamUrl = `http://127.0.0.1:${api.port}`;
  }
  if (
    !URL.canParse(config.upstreamUrl) ||
    !["http:", "https:"].includes(new URL(config.upstreamUrl).protocol)
  )
    throw new Error("LM Studio API 地址无效。");
  return {
    ...config,
    search: readConfiguration(),
  };
}

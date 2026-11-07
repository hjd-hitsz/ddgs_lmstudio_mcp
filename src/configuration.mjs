import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const configurationDirectory = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "ddgs-search-gateway",
);

export function readConfiguration(settings) {
  if (!settings) {
    try {
      settings = JSON.parse(
        readFileSync(join(configurationDirectory, "config.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      settings = {};
    }
  }
  const proxyPort = settings.proxyPort ?? 7897;
  if (!Number.isInteger(proxyPort) || proxyPort < 0 || proxyPort > 65535)
    throw new Error("代理端口须为 0～65535 的整数，0 表示直连。");
  return {
    proxyPort,
    proxy: proxyPort ? `http://127.0.0.1:${proxyPort}` : "",
    timeout: 45000,
  };
}

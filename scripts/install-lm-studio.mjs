import { readFile, writeFile, copyFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(homedir(), ".lmstudio", "mcp.json");
let previous;
try {
  previous = await readFile(path, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const data = previous ? JSON.parse(previous) : { mcpServers: {} };
data.mcpServers ||= {};
data.mcpServers["ddgs-lmstudio"] = {
  command: process.execPath,
  args: [fileURLToPath(new URL("../src/main.mjs", import.meta.url))],
  ...(process.env.XDG_CONFIG_HOME && {
    env: { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME },
  }),
};
if (previous) await copyFile(path, `${path}.backup-${Date.now()}`);
const temporary = `${path}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
await rename(temporary, path);
console.log("已将 ddgs-lmstudio MCP 注册到 LM Studio。");

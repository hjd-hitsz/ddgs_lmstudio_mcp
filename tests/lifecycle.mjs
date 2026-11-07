import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { searchFixture } from "./fixture.mjs";

const execute = promisify(execFile);
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error("启动联动检查超时");
}

test(
  "真实 systemd 文件事件跟随应用启动、退出和再次启动",
  { timeout: 30000 },
  async (t) => {
    const f = await searchFixture(t),
      prefix = `ddgs-companion-test-${process.pid}`;
    const units = join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "systemd/user",
    );
    await mkdir(units, { recursive: true });
    const placeholder = http.createServer();
    await new Promise((r) => placeholder.listen(0, "127.0.0.1", r));
    const port = placeholder.address().port;
    await new Promise((r) => placeholder.close(r));
    const state = join(f.directory, "http-server.json"),
      config = join(f.directory, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        apiKey: "fixture",
        upstreamKey: "fixture",
        upstreamUrl: "http://127.0.0.1:1",
        port,
        lmStudioStateFile: state,
        lmStudioExecutable: process.execPath,
      }),
    );
    const quote = (value) =>
      '"' +
      value
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("%", "%%") +
      '"';
    const service = join(units, prefix + ".service"),
      watch = join(units, prefix + ".path");
    await writeFile(
      service,
      `[Service]\nType=exec\nExecStart=${quote(process.execPath)} ${quote(resolve("src/companion.mjs"))}\nEnvironment=${quote("DDGS_GATEWAY_CONFIG=" + config)}\n`,
    );
    await writeFile(
      watch,
      `[Path]\nPathChanged=${state.replaceAll("%", "%%")}\nUnit=${prefix}.service\n`,
    );
    await execute("systemctl", ["--user", "daemon-reload"]);
    await execute("systemctl", ["--user", "start", prefix + ".path"]);
    let child;
    t.after(async () => {
      child?.kill();
      await execute("systemctl", [
        "--user",
        "stop",
        prefix + ".path",
        prefix + ".service",
      ]);
      await rm(service);
      await rm(watch);
      await execute("systemctl", ["--user", "daemon-reload"]);
    });
    const ready = async () => {
      try {
        return (
          await fetch(`http://127.0.0.1:${port}/healthz`, {
            signal: AbortSignal.timeout(300),
          })
        ).ok;
      } catch {
        return false;
      }
    };
    const records = [];
    for (let generation = 0; generation < 2; generation++) {
      const started = Date.now();
      child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import fs from 'node:fs';fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`,
          state,
        ],
        { stdio: "ignore" },
      );
      await until(ready);
      records.push({ generation, startMs: Date.now() - started });
      const stopped = Date.now();
      child.kill("SIGTERM");
      await until(async () => !(await ready()));
      records.at(-1).stopMs = Date.now() - stopped;
      await until(async () => {
        try {
          await execute("systemctl", [
            "--user",
            "is-active",
            prefix + ".service",
          ]);
          return false;
        } catch {
          return true;
        }
      });
      assert.ok(records.at(-1).startMs < 2000);
      assert.ok(records.at(-1).stopMs < 2000);
    }
    await mkdir(".cache", { recursive: true });
    await writeFile(
      ".cache/lifecycle.json",
      JSON.stringify(records, null, 2) + "\n",
    );
  },
);

import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { installHttpHook } from "./http-hook.mjs";

async function targets() {
  try {
    const reply = await fetch("http://127.0.0.1:9229/json/list", {
      signal: AbortSignal.timeout(500),
    });
    return reply.ok ? await reply.json() : [];
  } catch {
    return [];
  }
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  return {
    socket,
    evaluate(expression) {
      const call = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.removeEventListener("message", receive);
          reject(new Error("LM Studio 挂接响应超时。"));
        }, 10000);
        const receive = (event) => {
          const reply = JSON.parse(event.data);
          if (reply.id !== call) return;
          clearTimeout(timer);
          socket.removeEventListener("message", receive);
          if (reply.error || reply.result.exceptionDetails)
            reject(
              new Error(
                reply.result?.exceptionDetails?.exception?.description ||
                  JSON.stringify(reply.error),
              ),
            );
          else resolve(reply.result.result.value);
        };
        socket.addEventListener("message", receive);
        socket.send(
          JSON.stringify({
            id: call,
            method: "Runtime.evaluate",
            params: { expression, returnByValue: true, awaitPromise: true },
          }),
        );
      });
    },
  };
}

export async function attachHook(pid, options) {
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  if (Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== process.getuid())
    throw new Error("LM Studio 与搜索服务须属于同一用户。");
  let available = await targets();
  const opened = !available.length;
  if (opened) {
    if (!(BigInt("0x" + status.match(/^SigCgt:\s+(\w+)/m)[1]) & (1n << 9n)))
      throw new Error("LM Studio 未提供动态挂接入口。");
    process.kill(pid, "SIGUSR1");
    for (let attempt = 0; attempt < 30 && !available.length; attempt++) {
      await delay(100);
      available = await targets();
    }
  }
  if (!available.length) throw new Error("LM Studio 调试接入未就绪。");
  const session = await connect(available[0].webSocketDebuggerUrl);
  let verified = false;
  try {
    if ((await session.evaluate("process.pid")) !== pid)
      throw new Error("调试端口由其他进程占用，未执行挂接。");
    verified = true;
    return await session.evaluate(
      `(${installHttpHook.toString()})(${JSON.stringify(options)})`,
    );
  } finally {
    if (opened && verified)
      await session.evaluate(
        'setTimeout(() => process.getBuiltinModule("inspector").close(), 50); true',
      );
    session.socket.close();
    if (opened && verified)
      for (let attempt = 0; attempt < 20 && (await targets()).length; attempt++)
        await delay(50);
  }
}

import net from "node:net";
import { chmod, unlink, lstat } from "node:fs/promises";

export async function createRelayLease(path, token, onDisconnect = () => {}) {
  try {
    if (!(await lstat(path)).isSocket())
      throw new Error("搜索服务 socket 路径已被其他文件占用。");
    const alive = await new Promise((resolve, reject) => {
      const probe = net.connect(path);
      probe.once("connect", () => {
        probe.destroy();
        resolve(true);
      });
      probe.once("error", (error) =>
        error.code === "ECONNREFUSED" ? resolve(false) : reject(error),
      );
    });
    if (alive) throw new Error("搜索挂接服务已在运行。");
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let input = "",
      accepted = false;
    socket.setTimeout(5000, () => {
      if (!accepted) socket.destroy();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      if (accepted) onDisconnect();
    });
    socket.on("data", (chunk) => {
      if (accepted) return;
      input += chunk.toString();
      if (input.length > 1024) {
        socket.destroy();
        return;
      }
      if (!input.includes("\n")) return;
      if (input.trim() !== token) {
        socket.destroy();
        return;
      }
      accepted = true;
      socket.setTimeout(0);
      socket.write("ready\n");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await unlink(path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}

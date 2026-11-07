export async function installHttpHook({
  apiPort,
  relayPort,
  leasePath,
  token,
}) {
  const http = process.getBuiltinModule("http");
  const net = process.getBuiltinModule("net");
  const key = Symbol.for("ddgs-lmstudio-mcp.http-hook");
  const server = process
    ._getActiveHandles()
    .find(
      (handle) =>
        handle instanceof http.Server && handle.address()?.port === apiPort,
    );
  if (!server) throw new Error("LM Studio HTTP 服务尚未监听。");
  if (server[key]?.token === token)
    return { pid: process.pid, port: apiPort, attached: true };
  server[key]?.dispose();
  const lease = net.connect(leasePath);
  await new Promise((resolve, reject) => {
    let reply = "";
    lease.setTimeout(5000, () =>
      lease.destroy(new Error("搜索服务连接超时。")),
    );
    lease.once("error", reject);
    lease.on("connect", () => lease.write(token + "\n"));
    const receive = (chunk) => {
      reply += chunk.toString();
      if (reply.length > 1024) {
        lease.destroy();
        reject(new Error("搜索服务响应无效。"));
        return;
      }
      if (!reply.includes("\n")) return;
      if (reply.trim() !== "ready") {
        lease.destroy();
        reject(new Error("搜索服务认证失败。"));
        return;
      }
      lease.removeListener("data", receive);
      lease.setTimeout(0);
      resolve();
    };
    lease.on("data", receive);
    lease.once("close", () => reject(new Error("搜索服务连接已关闭。")));
  });
  const emit = server.emit;
  function dispose() {
    if (server.emit === intercept) server.emit = emit;
    if (server[key]?.token === token) delete server[key];
    server.removeListener("close", dispose);
    lease.destroy();
  }
  function intercept(event, request, response, ...rest) {
    if (event !== "request")
      return emit.call(this, event, request, response, ...rest);
    if (
      request.method === "GET" &&
      request.url === "/.well-known/ddgs-lmstudio"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ attached: true, pid: process.pid, port: apiPort }),
      );
      return true;
    }
    if (request.headers["x-ddgs-bypass"] === token) {
      delete request.headers["x-ddgs-bypass"];
      request.rawHeaders = request.rawHeaders.filter(
        (value, index, entries) =>
          (index % 2 ? entries[index - 1] : value).toLowerCase() !==
          "x-ddgs-bypass",
      );
      return emit.call(this, event, request, response, ...rest);
    }
    if (
      request.method !== "POST" ||
      request.url.split("?")[0] !== "/v1/messages"
    )
      return emit.call(this, event, request, response, ...rest);
    const outgoing = http.request(
      {
        hostname: "127.0.0.1",
        port: relayPort,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, "x-ddgs-relay": token },
      },
      (reply) => {
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
        reply.on("error", () => response.destroy());
      },
    );
    outgoing.on("error", () => {
      if (response.destroyed) return;
      if (response.headersSent) return response.destroy();
      response.writeHead(503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "搜索接入服务已断开，请重试。" },
        }),
      );
    });
    request.on("aborted", () => outgoing.destroy());
    response.on("close", () => {
      if (!response.writableEnded) outgoing.destroy();
    });
    request.pipe(outgoing);
    return true;
  }
  lease.on("error", dispose);
  lease.on("close", dispose);
  server.once("close", dispose);
  server[key] = { token, dispose };
  server.emit = intercept;
  return { pid: process.pid, port: apiPort, attached: true };
}

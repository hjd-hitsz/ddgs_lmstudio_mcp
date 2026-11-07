import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { timingSafeEqual } from "node:crypto";
import { createSearch } from "./search.mjs";
import {
  nativeSearchRequest,
  executeNativeSearch,
  searchResultText,
} from "./native-search.mjs";
import { writeMessage } from "./message-response.mjs";

export function createGateway(configuration) {
  const search = createSearch(configuration.search);
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ready: true, service: "ddgs-search-gateway" }));
      return;
    }
    const supplied = Buffer.from(
      request.headers["x-api-key"] ||
        request.headers.authorization?.replace(/^Bearer /, "") ||
        "",
    );
    const expected = Buffer.from(configuration.apiKey);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(401, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          type: "error",
          error: {
            type: "authentication_error",
            message: "搜索网关认证失败。",
          },
        }),
      );
      return;
    }
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    let stage = "request";
    try {
      if (!request.url.startsWith("/v1/"))
        throw new Error("接口路径须位于 /v1/。");
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) throw new Error("请求超过 64 MiB。");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const body =
        request.method === "POST" &&
        request.url.split("?")[0] === "/v1/messages"
          ? JSON.parse(bytes.toString())
          : null;
      const native = body && nativeSearchRequest(body);
      if (native) {
        stage = "search";
        const result = await executeNativeSearch(native, search, abort.signal);
        writeMessage(response, body, searchResultText(result));
        console.error(
          JSON.stringify({
            event: "web_search",
            results: result.results.length,
          }),
        );
        return;
      }
      stage = "upstream";
      const headers = {
        ...request.headers,
        "x-api-key": configuration.upstreamKey,
        authorization: `Bearer ${configuration.upstreamKey}`,
      };
      for (const name of [
        "host",
        "content-length",
        "connection",
        "accept-encoding",
      ])
        delete headers[name];
      const reply = await fetch(
        configuration.upstreamUrl.replace(/\/$/, "") + request.url,
        {
          method: request.method,
          headers,
          ...(bytes.length && { body: bytes }),
          signal: abort.signal,
        },
      );
      const outputHeaders = Object.fromEntries(
        [...reply.headers].filter(
          ([key]) =>
            ![
              "content-length",
              "content-encoding",
              "transfer-encoding",
              "connection",
            ].includes(key),
        ),
      );
      response.writeHead(reply.status, outputHeaders);
      if (reply.body) await pipeline(Readable.fromWeb(reply.body), response);
      else response.end();
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const message =
        stage === "request"
          ? error.message
          : stage === "search"
            ? "搜索服务执行失败，请重试。"
            : "模型服务请求失败，请检查上游连接。";
      console.error(
        JSON.stringify({
          event: `${stage}_error`,
          code: error.code || error.name,
        }),
      );
      response
        .writeHead(stage === "request" ? 400 : 502, {
          "Content-Type": "application/json",
        })
        .end(
          JSON.stringify({
            type: "error",
            error: {
              type: stage === "request" ? "invalid_request_error" : "api_error",
              message,
            },
          }),
        );
    }
  });
  return server;
}

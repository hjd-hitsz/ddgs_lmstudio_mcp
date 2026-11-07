import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGateway } from "../src/gateway.mjs";
import { nativeSearchRequest } from "../src/native-search.mjs";
import { searchFixture, nativeRequest } from "./fixture.mjs";

async function fixture(t) {
  const f = await searchFixture(t),
    requests = [];
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body });
    res
      .writeHead(req.url === "/v1/failure" ? 429 : 200, {
        "Content-Type": "application/json",
        "retry-after": "7",
      })
      .end(JSON.stringify({ upstream: true }));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const gateway = createGateway({
    apiKey: "gateway-secret",
    upstreamKey: "model-secret",
    upstreamUrl: `http://127.0.0.1:${upstream.address().port}`,
    search: f.configuration,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  t.after(async () => {
    for (const server of [gateway, upstream]) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
  return { ...f, requests, url: `http://127.0.0.1:${gateway.address().port}` };
}

test("搜索请求首次即由 ddgs 执行，模型上游零请求，JSON 与 SSE 都返回真实来源", async (t) => {
  const f = await fixture(t);
  for (const stream of [false, true]) {
    const reply = await fetch(f.url + "/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": "gateway-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...nativeRequest("中文模型搜索"), stream }),
    });
    assert.equal(reply.status, 200);
    const text = await reply.text();
    assert.match(text, /docs.example.org/);
    assert.match(text, /可信搜索摘要/);
    if (stream) {
      assert.match(reply.headers.get("content-type"), /event-stream/);
      assert.match(text, /message_stop/);
    } else assert.equal(JSON.parse(text).stop_reason, "end_turn");
  }
  assert.equal(f.requests.length, 0);
});

test("普通请求与自定义 WebSearch 工具原样转发，保留错误和响应头", async (t) => {
  const f = await fixture(t),
    body = {
      model: "local",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "WebSearch", input_schema: { type: "object" } }],
    };
  const reply = await fetch(f.url + "/v1/messages", {
    method: "POST",
    headers: {
      authorization: "Bearer gateway-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(f.requests[0].body), body);
  assert.equal(f.requests[0].headers["x-api-key"], "model-secret");
  const failure = await fetch(f.url + "/v1/failure", {
    headers: { "x-api-key": "gateway-secret" },
  });
  assert.equal(failure.status, 429);
  assert.equal(failure.headers.get("retry-after"), "7");
});

test("认证、请求格式和搜索故障分别报错，故障后搜索恢复", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + "/v1/models")).status, 401);
  const post = (body) =>
    fetch(f.url + "/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "gateway-secret" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post({ ...nativeRequest("x"), messages: [] })).status,
    400,
  );
  assert.equal((await post(nativeRequest("failure"))).status, 502);
  assert.equal((await post(nativeRequest("recovered"))).status, 200);
});

test("域名过滤在检索和结果两端执行，普通相似正文保持转发归属", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.url + "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": "gateway-secret" },
    body: JSON.stringify(
      nativeRequest("docs", { allowed_domains: ["example.org"] }),
    ),
  });
  const result = JSON.parse((await response.json()).content[0].text);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, "https://docs.example.org/start");
  assert.ok(f.calls[0].url.searchParams.get("q").includes("site:example.org"));
  assert.equal(
    nativeSearchRequest({ messages: nativeRequest("x").messages }),
    null,
  );
  assert.throws(
    () =>
      nativeSearchRequest(
        nativeRequest("x", {
          allowed_domains: ["example.org"],
          blocked_domains: ["example.net"],
        }),
      ),
    /分别/,
  );
});

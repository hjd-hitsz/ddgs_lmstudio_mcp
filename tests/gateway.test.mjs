import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { nativeSearchRequest } from "../src/native-search.mjs";
import { searchFixture, nativeRequest } from "./fixture.mjs";
import { hookedServer } from "./http-fixture.mjs";

async function fixture(t) {
  const f = await searchFixture(t),
    requests = [];
  const servers = await hookedServer(
    t,
    f.directory,
    async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push({ url: req.url, headers: req.headers, body });
      const authorized = req.headers["x-api-key"] === "original-key";
      res
        .writeHead(!authorized ? 401 : req.url === "/v1/failure" ? 429 : 200, {
          "content-type": "application/json",
          "retry-after": "7",
        })
        .end(JSON.stringify({ upstream: true }));
    },
    f.configuration,
  );
  return { ...f, ...servers, requests };
}
const headers = {
  "x-api-key": "original-key",
  "content-type": "application/json",
};

test("原端口和原凭据保持不变，原生搜索返回 JSON 与 SSE，搜索请求不送入模型", async (t) => {
  const f = await fixture(t);
  for (const stream of [false, true]) {
    const reply = await fetch(f.url + "/v1/messages", {
      method: "POST",
      headers,
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
  assert.equal(
    f.requests.filter((req) => req.url === "/v1/messages").length,
    0,
  );
  assert.equal(f.requests.length, 2);
});

test("普通模型请求原样交还 LM Studio，原凭据、错误和其他接口保持原行为", async (t) => {
  const f = await fixture(t),
    body = {
      model: "local",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "WebSearch", input_schema: { type: "object" } }],
    };
  const reply = await fetch(f.url + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(f.requests[0].body), body);
  assert.equal(f.requests[0].headers["x-api-key"], "original-key");
  assert.equal(f.requests[0].headers["x-ddgs-bypass"], undefined);
  const failure = await fetch(f.url + "/v1/failure", { headers });
  assert.equal(failure.status, 429);
  assert.equal(failure.headers.get("retry-after"), "7");
});

test("原服务认证继续生效，格式和搜索错误可恢复", async (t) => {
  const f = await fixture(t),
    post = (body, auth = headers) =>
      fetch(f.url + "/v1/messages", {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
  assert.equal((await post(nativeRequest("x"), {})).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await post({ ...nativeRequest("x"), messages: [] })).status,
    400,
  );
  assert.equal((await post(nativeRequest("failure"))).status, 502);
  assert.equal((await post(nativeRequest("recovered"))).status, 200);
});

test("域名限制在检索和结果两端执行", async (t) => {
  const f = await fixture(t),
    response = await fetch(f.url + "/v1/messages", {
      method: "POST",
      headers,
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

test("搜索服务断开后立即解除挂接，原端口继续提供原服务", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + "/.well-known/ddgs-lmstudio")).status, 200);
  await f.lease.close();
  for (let i = 0; i < 20; i++) {
    const response = await fetch(f.url + "/.well-known/ddgs-lmstudio", {
      headers,
    });
    if ((await response.json()).upstream) break;
    await delay(20);
  }
  const reply = await fetch(f.url + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(nativeRequest("direct")),
  });
  assert.deepEqual(await reply.json(), { upstream: true });
  assert.equal(f.calls.length, 0);
});

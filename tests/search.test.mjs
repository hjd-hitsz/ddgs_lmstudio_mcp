import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetch } from "undici";
import { createSearch, parseResults } from "../src/search.mjs";
import { readConfiguration } from "../src/configuration.mjs";
import { searchFixture } from "./fixture.mjs";

const input = (query) => ({
  query,
  max_results: 30,
  region: "cn-zh",
  safesearch: "moderate",
});

test("JavaScript 搜索正确编码查询、解析摘要和 DuckDuckGo 跳转链接", async (t) => {
  const f = await searchFixture(t),
    query = "中文搜索 & $(touch SHOULD_NOT_EXIST); `whoami`";
  const result = await createSearch(f.configuration)("text", input(query));
  assert.equal(result.results[0].title, query);
  assert.equal(result.results[0].snippet, "可信搜索摘要");
  assert.equal(result.results[0].url, "https://docs.example.org/start");
  assert.equal(f.calls[0].url.searchParams.get("q"), query);
  assert.equal(f.calls[0].url.searchParams.get("kl"), "cn-zh");
});

test("HTTP 失败、超时及取消后恢复，空结果和新闻保持正确结构", async (t) => {
  const f = await searchFixture(t),
    search = createSearch(f.configuration);
  await assert.rejects(search("text", input("failure")), /HTTP 503/);
  assert.deepEqual((await search("text", input("empty"))).results, []);
  assert.equal(
    (await search("news", input("news"))).results[0].source,
    "Example",
  );
  await assert.rejects(search("text", input("slow")));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(search("text", input("cancel"), controller.signal), {
    name: "AbortError",
  });
  assert.equal((await search("text", input("recovered"))).results.length, 2);
});

test("验证码和未知页面明确失败，真实空结果保持空列表", () => {
  assert.throws(
    () => parseResults('<form action="/anomaly.js"></form>'),
    /验证码/,
  );
  assert.throws(() => parseResults("<html>unexpected</html>"), /无法识别/);
  assert.deepEqual(parseResults('<div class="no-results"></div>').results, []);
});

test("默认代理为 7897，0 使用直接连接并忽略系统代理", async (t) => {
  assert.equal(readConfiguration({}).proxy, "http://127.0.0.1:7897");
  assert.equal(readConfiguration({ proxyPort: 0 }).proxy, "");
  for (const proxyPort of [-1, 65536, 1.5, "7897"])
    assert.throws(() => readConfiguration({ proxyPort }));
  const server = http.createServer((req, res) =>
    res.end('<div class="no-results"></div>'),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const previous = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = "http://127.0.0.1:1";
  try {
    const search = createSearch({
      ...readConfiguration({ proxyPort: 0 }),
      request: (_, options) =>
        fetch(`http://127.0.0.1:${server.address().port}`, options),
    });
    assert.deepEqual((await search("text", input("direct"))).results, []);
  } finally {
    if (previous === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previous;
  }
});

test("自定义代理端口通过 CONNECT 发送请求", async (t) => {
  let connected = false;
  const proxy = http.createServer();
  proxy.on("connect", (request, socket) => {
    connected = request.url === "html.duckduckgo.com:443";
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => proxy.close(r)));
  await assert.rejects(
    createSearch(readConfiguration({ proxyPort: proxy.address().port }))(
      "text",
      input("proxy"),
    ),
  );
  assert.equal(connected, true);
});

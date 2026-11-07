import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.mjs";
import { searchFixture } from "./fixture.mjs";

test("MCP 通过标准客户端发现工具和读取搜索结果，服务持有代理配置", async (t) => {
  const fixture = await searchFixture(t);
  const server = createServer(fixture.configuration);
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["web_search", "news_search"],
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema.properties.proxyPort, undefined);
    assert.equal(tool.inputSchema.properties.command, undefined);
  }
  const result = await client.callTool({
    name: "web_search",
    arguments: { query: "中文 MCP 搜索" },
  });
  assert.notEqual(result.isError, true);
  assert.equal(
    result.structuredContent.results[0].url,
    "https://docs.example.org/start",
  );
  const failure = await client.callTool({
    name: "web_search",
    arguments: { query: "failure" },
  });
  assert.equal(failure.isError, true);
});

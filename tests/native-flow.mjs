import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readConfiguration } from "../src/configuration.mjs";
import { hookedServer } from "./http-fixture.mjs";
import { searchFixture } from "./fixture.mjs";

test(
  "真实 Claude Code 原生 WebSearch 经搜索网关返回来源并继续下一轮",
  { timeout: 120000 },
  async (t) => {
    const fixture = await searchFixture(t),
      requests = [];
    const query = "LM Studio MCP documentation";
    const handler = async (req, res) => {
      if (req.method === "GET") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end('{"data":[]}');
        return;
      }
      let bytes = "";
      for await (const chunk of req) bytes += chunk;
      const body = JSON.parse(bytes);
      requests.push(body);
      if (req.url.includes("count_tokens")) {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end('{"input_tokens":100}');
        return;
      }
      const results = body.messages.flatMap((m) =>
        Array.isArray(m.content)
          ? m.content.filter((b) => b.type === "tool_result")
          : [],
      );
      const main = body.tools?.some((tool) => tool.name === "WebSearch");
      const content =
        main && !results.length
          ? [
              {
                type: "tool_use",
                id: "toolu_native_search",
                name: "WebSearch",
                input: { query },
              },
            ]
          : [
              {
                type: "text",
                text: results.length
                  ? "原生搜索已取得真实来源，继续回答。"
                  : '{"title":"搜索验证"}',
              },
            ];
      const stop = content[0].type === "tool_use" ? "tool_use" : "end_turn";
      const message = {
        id: `msg_${randomUUID()}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      };
      if (!body.stream) {
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(message));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (event) =>
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      send({
        type: "message_start",
        message: { ...message, content: [], stop_reason: null },
      });
      for (const [index, block] of content.entries()) {
        send({
          type: "content_block_start",
          index,
          content_block:
            block.type === "tool_use"
              ? { ...block, input: {} }
              : { type: "text", text: "" },
        });
        send({
          type: "content_block_delta",
          index,
          delta:
            block.type === "tool_use"
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(block.input),
                }
              : { type: "text_delta", text: block.text },
        });
        send({ type: "content_block_stop", index });
      }
      send({
        type: "message_delta",
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 20 },
      });
      send({ type: "message_stop" });
      res.end();
    };
    const search =
      process.env.NATIVE_SEARCH_LIVE === "1"
        ? readConfiguration()
        : fixture.configuration;
    const { url } = await hookedServer(t, fixture.directory, handler, search);
    const env = {
      ...process.env,
      CLAUDE_CONFIG_DIR: join(fixture.directory, "native"),
      ANTHROPIC_BASE_URL: url,
      ANTHROPIC_API_KEY: "native-gateway",
      ANTHROPIC_MODEL: "fixture-model",
      ANTHROPIC_AUTH_TOKEN: "",
    };
    delete env.CLAUDECODE;
    const { stdout } = await promisify(execFile)(
      process.env.CLAUDE_EXECUTABLE || "claude",
      [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--model",
        "fixture-model",
        "--tools",
        "WebSearch",
        "--allowedTools",
        "WebSearch",
        "--setting-sources",
        "",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
        "--max-turns",
        "4",
        "调用 WebSearch 搜索 LM Studio MCP documentation，依据工具结果继续回答。",
      ],
      {
        cwd: fixture.directory,
        env,
        timeout: 100000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const events = stdout.trim().split("\n").map(JSON.parse);
    const results = events
      .filter((e) => e.type === "user")
      .flatMap((e) => e.message.content)
      .filter((b) => b.type === "tool_result");
    assert.equal(results.length, 1);
    assert.notEqual(results[0].is_error, true);
    assert.match(results[0].content, /https?:/);
    assert.equal(
      requests.filter((r) =>
        r.tools?.some((tool) => tool.type === "web_search_20250305"),
      ).length,
      0,
    );
    assert.ok(
      requests.some((r) =>
        r.messages.some(
          (m) =>
            Array.isArray(m.content) &&
            m.content.some(
              (b) => b.type === "tool_result" && b.content.includes("https"),
            ),
        ),
      ),
    );
    assert.equal(
      events.findLast((e) => e.type === "result").subtype,
      "success",
    );
    await mkdir(".cache", { recursive: true });
    await writeFile(
      `.cache/native-${process.env.NATIVE_SEARCH_LIVE === "1" ? "live" : "fixture"}.json`,
      JSON.stringify(
        {
          liveSearch: process.env.NATIVE_SEARCH_LIVE === "1",
          nativeToolResults: results,
          completed: true,
          searchRequestsToModel: 0,
        },
        null,
        2,
      ) + "\n",
    );
  },
);

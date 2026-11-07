import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function searchFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "search-test-")),
    calls = [];
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    calls,
    configuration: {
      timeout: 100,
      proxy: "",
      async request(url, options) {
        const parsed = new URL(url),
          query = parsed.searchParams.get("q");
        calls.push({ url: parsed, options });
        if (query === "slow")
          await delay(30000, undefined, { signal: options.signal });
        if (query === "failure")
          return new Response("unavailable", { status: 503 });
        if (parsed.pathname === "/news.js")
          return Response.json({
            results: [
              {
                title: query,
                url: "https://docs.example.org/start",
                excerpt: "可信搜索摘要",
                date: 1794000000,
                source: "Example",
              },
            ],
          });
        const escape = (value) =>
          value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll('"', "&quot;");
        return new Response(
          query === "empty"
            ? '<div class="no-results">No results</div>'
            : `<input name="vqd" value="4-123-456"><div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.org%2Fstart">${escape(query)}</a><div class="result__snippet">可信搜索摘要</div></div><div class="result"><a class="result__a" href="https://other.example.net/">其他来源</a><div class="result__snippet">其他摘要</div></div>`,
        );
      },
    },
  };
}

export function nativeRequest(query, tool = {}) {
  return {
    model: "fixture-model",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Perform a web search for the query: ${query}`,
          },
        ],
      },
    ],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 8, ...tool },
    ],
    tool_choice: { type: "auto" },
    stream: false,
    max_tokens: 32000,
  };
}

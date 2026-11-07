import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createSearch } from "./search.mjs";

export function createServer(configuration) {
  const search = createSearch(configuration);
  const server = new McpServer({ name: "duckduckgo-search", version: "0.1.0" });
  for (const [name, kind, title, description] of [
    [
      "web_search",
      "text",
      "网页搜索",
      "搜索实时网页，返回标题、网址和摘要。回答中引用结果网址。",
    ],
    [
      "news_search",
      "news",
      "新闻搜索",
      "搜索近期新闻，返回标题、网址、摘要、日期和来源。回答中引用结果网址。",
    ],
  ]) {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          query: z.string().trim().min(1).max(1000).describe("搜索词"),
          max_results: z
            .number()
            .int()
            .min(1)
            .max(30)
            .default(30)
            .describe("最多返回的结果数"),
          region: z
            .string()
            .regex(/^[a-z]{2}-[a-z]{2}$/)
            .default("us-en")
            .describe("区域，例如 cn-zh 或 us-en"),
          safesearch: z.enum(["on", "moderate", "off"]).default("moderate"),
          timelimit: z
            .enum(kind === "news" ? ["d", "w", "m"] : ["d", "w", "m", "y"])
            .optional()
            .describe("时间范围：天、周、月或年"),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (input, extra) => {
        try {
          const result = await search(kind, input, extra.signal);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          };
        } catch (error) {
          const detail = error.killed
            ? "搜索超时，请稍后重试。"
            : error.code === "ENOENT"
              ? "搜索程序未找到，请检查 MCP 服务安装。"
              : error.message;
          const message = configuration.proxy
            ? detail.replaceAll(configuration.proxy, "[代理]")
            : detail;
          return {
            isError: true,
            content: [
              { type: "text", text: `搜索失败：${message.slice(0, 1500)}` },
            ],
          };
        }
      },
    );
  }
  return server;
}

import { fetch, Agent, ProxyAgent } from "undici";
import { load } from "cheerio";
import { setTimeout as delay } from "node:timers/promises";

export function parseResults(html) {
  const $ = load(html);
  if ($('form[action*="anomaly"]').length || $(".anomaly-modal").length)
    throw new Error("DuckDuckGo 要求验证码，请稍后重试或更换代理出口。");
  const results = [];
  $(".result").each((_, element) => {
    const link = $(element).find(".result__a");
    if (!link.length || $(element).hasClass("result--ad")) return;
    const target = new URL(link.attr("href"), "https://duckduckgo.com");
    const url = target.searchParams.get("uddg") || target.href;
    if (!["http:", "https:"].includes(new URL(url).protocol)) return;
    results.push({
      title: link.text().trim(),
      url,
      snippet: $(element).find(".result__snippet").text().trim(),
    });
  });
  if (!results.length && !$(".no-results, .no-results__message").length)
    throw new Error("DuckDuckGo 返回了无法识别的搜索页面。");
  return { results, token: $('input[name="vqd"]').first().val() };
}

export function createSearch(configuration) {
  let pending = Promise.resolve(),
    lastFinished = 0;
  return (kind, input, signal) => {
    const task = pending.then(async () => {
      signal?.throwIfAborted();
      const wait = 1000 - (Date.now() - lastFinished);
      if (wait > 0) await delay(wait, undefined, { signal });
      const dispatcher = configuration.proxy
        ? new ProxyAgent(configuration.proxy)
        : new Agent();
      const deadline = AbortSignal.timeout(configuration.timeout);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const request = configuration.request || fetch;
      async function get(url) {
        const response = await request(url, { dispatcher, signal: combined });
        if (!response.ok)
          throw new Error(`DuckDuckGo 请求失败（HTTP ${response.status}）。`);
        return response;
      }
      try {
        const parameters = new URLSearchParams({
          q: input.query,
          kl: input.region,
          kp: { on: "1", moderate: "-1", off: "-2" }[input.safesearch],
        });
        if (input.timelimit) parameters.set("df", input.timelimit);
        const page = parseResults(
          await (
            await get(`https://html.duckduckgo.com/html/?${parameters}`)
          ).text(),
        );
        let results = page.results;
        if (kind === "news") {
          if (!page.token) throw new Error("DuckDuckGo 未返回新闻检索令牌。");
          parameters.set("vqd", page.token);
          parameters.set("o", "json");
          parameters.set("noamp", "1");
          const news = await (
            await get(`https://duckduckgo.com/news.js?${parameters}`)
          ).json();
          if (!Array.isArray(news.results))
            throw new Error("DuckDuckGo 新闻结果格式无效。");
          results = news.results.map((row) => ({
            title: load(row.title || "").text(),
            url: row.url,
            snippet: load(row.excerpt || "").text(),
            date: row.date ? new Date(row.date * 1000).toISOString() : "",
            source: row.source || "",
          }));
        }
        return {
          query: input.query,
          results: results.slice(0, input.max_results),
        };
      } finally {
        lastFinished = Date.now();
        await dispatcher.close();
      }
    });
    pending = task.catch(() => {});
    return task;
  };
}

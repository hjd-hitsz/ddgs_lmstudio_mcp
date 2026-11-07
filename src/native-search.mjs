const prefix = "Perform a web search for the query: ";

export function nativeSearchRequest(body) {
  const tools =
    body.tools?.filter((tool) => tool.type?.startsWith("web_search_")) || [];
  if (!tools.length) return null;
  const tool = tools[0];
  const content = body.messages?.[0]?.content;
  const text =
    typeof content === "string"
      ? content
      : content?.length === 1 && content[0].type === "text"
        ? content[0].text
        : "";
  if (
    tools.length !== 1 ||
    body.tools.length !== 1 ||
    tool.type !== "web_search_20250305" ||
    tool.name !== "web_search" ||
    body.messages?.length !== 1 ||
    body.messages[0].role !== "user" ||
    !text.startsWith(prefix)
  )
    throw new Error(
      "搜索网关当前支持 Claude Code 原生 WebSearch 辅助请求（web_search_20250305）。",
    );
  const query = text.slice(prefix.length).trim();
  if (!query || query.length > 4000)
    throw new Error("搜索词须为 1～4000 个字符。");
  if (tool.allowed_domains?.length && tool.blocked_domains?.length)
    throw new Error("搜索域名白名单与黑名单须分别使用。");
  for (const domain of [
    ...(tool.allowed_domains || []),
    ...(tool.blocked_domains || []),
  ]) {
    if (
      typeof domain !== "string" ||
      /[\s?#@]/.test(domain) ||
      domain.includes(":") ||
      !new URL(`https://${domain}`).hostname.includes(".")
    )
      throw new Error("搜索域名规则须为主机名或主机名加路径。");
  }
  return {
    query,
    allowedDomains: tool.allowed_domains || [],
    blockedDomains: tool.blocked_domains || [],
  };
}

function matchesRule(url, rule) {
  const target = new URL(url);
  const allowed = new URL(`https://${rule}`);
  return (
    (target.hostname === allowed.hostname ||
      target.hostname.endsWith(`.${allowed.hostname}`)) &&
    target.pathname.startsWith(allowed.pathname)
  );
}

export async function executeNativeSearch(request, search, signal) {
  const site = request.allowedDomains.length
    ? ` (${request.allowedDomains.map((domain) => `site:${domain}`).join(" OR ")})`
    : "";
  const exclude = request.blockedDomains
    .map((domain) => ` -site:${domain}`)
    .join("");
  const response = await search(
    "text",
    {
      query: request.query + site + exclude,
      max_results: 30,
      region: "us-en",
      safesearch: "moderate",
    },
    signal,
  );
  const results = response.results.filter((result) => {
    if (!URL.canParse(result.url)) return false;
    return (
      (!request.allowedDomains.length ||
        request.allowedDomains.some((domain) =>
          matchesRule(result.url, domain),
        )) &&
      !request.blockedDomains.some((domain) => matchesRule(result.url, domain))
    );
  });
  return { query: request.query, results };
}

export function searchResultText(result) {
  return JSON.stringify(
    { query: result.query, results: result.results },
    null,
    2,
  );
}

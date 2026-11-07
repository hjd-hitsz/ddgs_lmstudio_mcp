# ddgs_lmstudio_mcp

为 LM Studio 提供 DuckDuckGo 网页和新闻搜索。搜索由 JavaScript 实现，随 npm 包交付，运行只需 Node.js。

项目包含两种入口：LM Studio 可直接使用的 stdio MCP，以及兼容 Claude Code 原生 `WebSearch` 的 Anthropic Messages 网关。

```text
Claude Code → 搜索网关 → LM Studio（模型请求）
                     → DuckDuckGo（原生 WebSearch 请求）
LM Studio → MCP → DuckDuckGo
```

## 安装

需要 Node.js 22.12 或更新版本。自动启动联动适用于具有用户级 systemd 的 Linux 桌面，并读取当前用户的 LM Studio 安装信息。首次安装前启动一次 LM Studio 并开启其本地 API 服务。

直接从 GitHub 安装：

```sh
npm install -g github:hjd-hitsz/ddgs_lmstudio_mcp
ddgs-lmstudio-mcp install
```

在源码目录安装：

```sh
npm install -g .
ddgs-lmstudio-mcp install
```

也可安装由 `npm pack` 生成的 npm 包：

```sh
npm install -g ./ddgs_lmstudio_mcp-0.1.0.tgz
ddgs-lmstudio-mcp install
```

安装命令自动注册 LM Studio MCP，并建立搜索网关的启动联动。LM Studio 启动后网关跟随启动，LM Studio 退出后网关停止。项目内的 `src/companion.mjs` 是网关启动入口。

## 代理

唯一配置项为 `proxyPort`，默认 `7897`，对应 `http://127.0.0.1:7897`。

```sh
# 默认启用本机 7897 端口的 HTTP 代理
ddgs-lmstudio-mcp install

# 修改代理端口
ddgs-lmstudio-mcp install --proxy-port 7890

# 关闭代理，直接连接 DuckDuckGo
ddgs-lmstudio-mcp install --proxy-port 0
```

配置保存在 `$XDG_CONFIG_HOME/ddgs-search-gateway/config.json`，未设置 XDG 时为 `~/.config/ddgs-search-gateway/config.json`：

```json
{
  "proxyPort": 7897
}
```

设置为 `0` 时搜索直接连接，忽略系统代理环境变量。重复执行安装命令会保留已保存的端口；显式传入 `--proxy-port` 时更新端口。

模型只提交搜索词等工具参数，网络连接由服务统一管理。

## Claude Code 原生搜索

将调用方的 Anthropic 服务地址指向 `http://127.0.0.1:1235`，API Key 使用本机自动生成的 `runtime.json` 中的 `apiKey`。网关通过 LM Studio 状态自动发现其本地 API 地址。

Claude Code 的原生 `WebSearch` 辅助请求由网关执行搜索并返回来源，普通模型请求转发到 LM Studio。模型继续使用原来的 `WebSearch` 工具。

`runtime.json` 保存自动生成的凭据、发现的程序路径和运行状态，权限为 `0600`，由安装器维护。源码和启动入口均包含在项目及 npm 包内。

## 运行和维护

```sh
ddgs-lmstudio-mcp status
journalctl --user -u ddgs-search-gateway.service
```

`ddgs-lmstudio-mcp mcp` 启动 stdio MCP，提供 `web_search` 和 `news_search`。`ddgs-lmstudio-mcp start` 在前台跟随当前 LM Studio 运行网关。

移动源码或更换 npm 安装位置后重新执行安装命令，更新启动路径。

停止自动联动：

```sh
systemctl --user disable --now ddgs-search-gateway.path
systemctl --user stop ddgs-search-gateway.service
```

DuckDuckGo 返回验证码、HTTP 错误或异常页面时，搜索明确报错；代理恢复后可继续搜索。

## 开发验证

```sh
npm ci
npm run check
npm run test:native
npm run test:lifecycle
NATIVE_SEARCH_LIVE=1 npm run test:native
npm pack
```

基础测试覆盖搜索解析、代理与直连、取消与失败恢复，以及网关的 JSON/SSE 协议。原生调用测试运行本机 Claude Code CLI，通过模拟模型响应触发真实 WebSearch 调用；启用 `NATIVE_SEARCH_LIVE` 后使用真实 DuckDuckGo 网络搜索。生命周期测试创建临时用户 systemd 服务和模拟应用进程，检查启动、退出与再次启动。

## 模块

- `src/search.mjs`：JavaScript DuckDuckGo 搜索、代理、超时与取消。
- `src/companion.mjs`：LM Studio 进程身份与网关生命周期。
- `src/gateway.mjs`：认证、请求路由和上游转发。
- `src/native-search.mjs`：原生搜索请求解析和域名约束。
- `src/server.mjs`：MCP 工具定义。
- `bin/ddgs-lmstudio-mcp.mjs`：npm 命令入口。
- `scripts/install-gateway.mjs`：安装和用户 systemd 联动。

## 许可证

[MIT](LICENSE)

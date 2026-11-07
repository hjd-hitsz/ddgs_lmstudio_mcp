# 开发说明

## 运行机制

`src/companion.mjs` 持有搜索服务，读取 LM Studio 桌面应用的进程和 API 端口。用户级 systemd path 监听应用状态文件，应用启动时触发服务，应用退出后服务停止。

`src/attach.mjs` 通过同用户 Electron/Node.js 动态调试接口调用 `src/http-hook.mjs`，在现有 HTTP 服务中安装内存请求处理器。由本服务开启的调试入口在挂接后关闭，用户已经开启的调试入口保持原样。私有 Unix socket 维持挂接生命周期，搜索服务断开后恢复原处理器。

`src/gateway.mjs` 使用随机内部令牌接收挂接请求。普通模型请求保留原凭据和正文，交还 LM Studio；原生 WebSearch 辅助请求先由 LM Studio 校验凭据，再调用 `src/search.mjs` 执行 DuckDuckGo 搜索。内部端口绑定回环地址并由系统分配。

`src/server.mjs` 提供独立 stdio MCP 工具。安装器只写入本项目配置和用户服务，客户端的 MCP 登记由使用者自行管理。

配置保存在 `$XDG_CONFIG_HOME/ddgs-search-gateway`，未设置 XDG 时使用 `~/.config/ddgs-search-gateway`。`config.json` 保存唯一用户选项 `proxyPort`，`runtime.json` 保存自动发现的应用信息。

## 兼容性

动态挂接已在 Linux、LM Studio 0.4.24 上验证，依赖桌面应用保留 Node.js 动态调试接入能力。应用版本关闭该能力或调试端口被其他进程占用时，服务记录挂接失败并保留原应用运行。此挂接方式使用运行时内部接口，需要在 LM Studio 升级后重新验证。

DuckDuckGo 搜索使用公开 HTML 和新闻接口。验证码、HTTP 错误及无法识别的页面均返回搜索错误，网络恢复后可重试。

## 验证

```sh
npm ci
npm run check
npm run test:native
npm run test:lifecycle
NATIVE_SEARCH_LIVE=1 npm run test:native
npm pack
```

- 基础测试覆盖原端口请求挂接、原凭据认证、JSON/SSE、断开恢复、搜索解析、代理与直连、取消及失败恢复。
- 原生调用测试运行本机 Claude Code CLI，以模拟模型响应触发 WebSearch；启用 `NATIVE_SEARCH_LIVE` 后使用真实 DuckDuckGo 搜索。
- 生命周期测试使用真实用户 systemd 和隔离应用进程，验证启动、挂接、退出及再次启动。

手工验证使用 LM Studio 0.4.24 和 Bonsai 2：Claude Code 通过原端口 1234 发起 WebSearch，取得 10 条来源后继续生成带引用的回答。搜索服务被终止后原模型接口保持可用，服务重启后自动恢复挂接；原程序文件及调用方配置的 SHA-256 校验值保持一致。该验证使用本机特定模型，模型名称和端口由实际 LM Studio 环境决定。

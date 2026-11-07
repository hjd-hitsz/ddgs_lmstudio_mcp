# ddgs_lmstudio_mcp

为 LM Studio 增加 DuckDuckGo 网页和新闻搜索，内置 JavaScript 搜索实现，通过 npm 安装。

Claude Code 继续使用原来的 LM Studio 地址和凭据。搜索服务动态挂接 LM Studio 已有的 HTTP 服务，识别原生 `WebSearch` 辅助请求并返回搜索结果；普通模型请求继续交给 LM Studio。

```text
Claude Code → LM Studio 原端口（例如 1234）
                 ├─ 模型请求 → LM Studio
                 └─ WebSearch → DuckDuckGo 搜索服务
```

## 安装

需要 Node.js 22.12 或更新版本、Linux 用户级 systemd，以及当前用户运行的 LM Studio 桌面应用。已验证 LM Studio 0.4.24。首次安装前启动一次 LM Studio 并开启本地 API 服务。

```sh
npm install -g github:hjd-hitsz/ddgs_lmstudio_mcp
ddgs-lmstudio-mcp install
```

源码安装可使用 `npm install -g .`，也可安装 `npm pack` 生成的包。

安装器只保存本项目配置并创建本项目的用户服务。程序自动读取 LM Studio 的安装位置、进程和 API 端口，保持 LM Studio、Claude Code 及其他调用方的配置原样。安装和运行均使用普通用户权限。

LM Studio 启动后搜索服务自动挂接；退出后服务停止。搜索服务停止或异常退出时，挂接自动解除，原端口继续提供 LM Studio 的原有服务。

## 代理

唯一配置项为 `proxyPort`，默认 `7897`，对应 `http://127.0.0.1:7897`。设为 `0` 时直接连接 DuckDuckGo，忽略系统代理环境变量。

```sh
# 修改代理端口
ddgs-lmstudio-mcp install --proxy-port 7890

# 关闭代理
ddgs-lmstudio-mcp install --proxy-port 0
```

配置保存在 `$XDG_CONFIG_HOME/ddgs-search-gateway/config.json`，未设置 XDG 时为 `~/.config/ddgs-search-gateway/config.json`：

```json
{
  "proxyPort": 7897
}
```

重复执行安装命令会保留已保存的端口；显式传入 `--proxy-port` 时更新端口。

## 运行和维护

```sh
ddgs-lmstudio-mcp status
journalctl --user -u ddgs-search-gateway.service
```

`ddgs-lmstudio-mcp start` 在前台跟随当前 LM Studio 运行。移动源码或更换 npm 安装位置后重新执行安装命令，更新本项目的启动路径。

停止自动挂接：

```sh
systemctl --user disable --now ddgs-search-gateway.path
systemctl --user stop ddgs-search-gateway.service
```

项目同时提供独立 stdio MCP：`ddgs-lmstudio-mcp mcp`，包含 `web_search` 和 `news_search`。客户端可自行连接；安装器保持客户端的 MCP 配置原样。

## 挂接机制

服务使用 Electron/Node.js 的动态调试接口，在 LM Studio 现有 HTTP 服务中安装内存请求处理器。只在挂接期间打开由本服务启动的调试入口，完成后立即关闭；已由用户开启的调试入口保持原样。私有 Unix socket 维持挂接生命周期，搜索服务断开即恢复原处理器。

原认证凭据继续交给 LM Studio 校验。搜索服务内部使用临时随机令牌，绑定回环地址；内部端口由系统分配。

此能力依赖 LM Studio 桌面应用保留动态调试接入能力。如果应用版本关闭该能力，或调试端口被其他进程占用，服务会记录挂接失败，保留原应用运行。DuckDuckGo 返回验证码、HTTP 错误或异常页面时，搜索明确报错，网络恢复后可重试。

## 开发验证

```sh
npm ci
npm run check
npm run test:native
npm run test:lifecycle
NATIVE_SEARCH_LIVE=1 npm run test:native
npm pack
```

基础测试覆盖原端口请求挂接、原凭据认证、JSON/SSE、断开恢复、搜索解析、代理与直连，以及取消和失败恢复。原生调用测试运行本机 Claude Code CLI，通过模拟模型响应触发原生 WebSearch；启用 `NATIVE_SEARCH_LIVE` 后使用真实 DuckDuckGo 搜索。生命周期测试通过真实用户 systemd 和隔离应用进程验证启动、挂接、退出及再次启动。

## 许可证

[MIT](LICENSE)

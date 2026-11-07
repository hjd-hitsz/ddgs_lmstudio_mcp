# ddgs_lmstudio_mcp

为 LM Studio 提供 DuckDuckGo 搜索，让 Claude Code 使用本地模型时能够调用原生 `WebSearch`，沿用现有服务地址和凭据。

## 安装

环境：Linux（用户级 systemd）、Node.js 22.12+、LM Studio 桌面版。先启动 LM Studio 并开启本地 API 服务，再执行：

```sh
npm install -g github:hjd-hitsz/ddgs_lmstudio_mcp
ddgs-lmstudio-mcp install
```

安装后随 LM Studio 自动启动和停止。升级时重新执行以上命令。

## 代理

默认使用 `http://127.0.0.1:7897`。唯一配置项为代理端口，`0` 表示关闭代理、直接联网。

```sh
# 修改代理端口
ddgs-lmstudio-mcp install --proxy-port 7890

# 关闭代理
ddgs-lmstudio-mcp install --proxy-port 0
```

## 使用

在 Claude Code 中选择 LM Studio 的本地模型，正常发起需要联网搜索的任务即可。

查看服务状态和日志：

```sh
ddgs-lmstudio-mcp status
journalctl --user -u ddgs-search-gateway.service
```

其他 MCP 客户端可通过 `ddgs-lmstudio-mcp mcp` 连接，使用网页搜索 `web_search` 和新闻搜索 `news_search`。

## 卸载

```sh
systemctl --user disable --now ddgs-search-gateway.path
systemctl --user stop ddgs-search-gateway.service
npm uninstall -g ddgs_lmstudio_mcp
```

## 开发

实现、兼容性与验证说明见[开发文档](https://github.com/hjd-hitsz/ddgs_lmstudio_mcp/blob/main/docs/development.md)。

## 许可证

[MIT](LICENSE)

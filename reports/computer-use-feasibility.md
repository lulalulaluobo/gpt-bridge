# Computer Use 接入调研与初步验证

日期：2026-10-13。范围：现成组件调研及独立本机验证；尚未接入正式应用、现有 Tunnel 或 Release。

## 结论

本机已通过真实 MCP 完成“截图与界面读取 → 输入 → 点击 → 再观察确认”的最小闭环。建议先用 Peekaboo 验证 macOS 的完整 Tunnel 链路，再决定正式集成。Windows 后端尚未实测，不能据此承诺双平台同时可用。

这里复用 MCP 工具能力，由 ChatGPT 决定动作；本轮未调用 Peekaboo 自带 agent/analyze，也未提供额外模型 API key。无需先引入另一套模型推理循环。

## 候选方案

| 组件 | 定位与复用部分 | 本轮结论 |
| --- | --- | --- |
| [Peekaboo](https://github.com/openclaw/Peekaboo) | macOS 原生截图、Accessibility 元素、输入操作、stdio MCP；MIT | 4.9.2 官方 arm64 CLI 已实测，优先作为 Mac 验证后端 |
| [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) | 跨平台桌面驱动，CLI/MCP/SDK；项目 MIT | 适合作为统一后端候选；本轮只核对文档，未安装或操作；后台能力需逐平台/应用确认 |
| [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | Windows 界面观察、输入及窗口控制；MIT | Windows 备选，文档列出 Python 3.13+；必须在 Windows 真机另测 |

Peekaboo 当前发布版要求 macOS 15+；gpt-bridge 原来支持 macOS 14+，正式方案须保留 14 上的既有功能并禁用不兼容的 Computer Use，或明确调整最低版本。不能直接假定兼容。

Cua Driver 默认驱动可不安装模型；其可选 perception 扩展包含不同许可的组件，首轮不引入。项目总体许可证不代表可选扩展的许可证。

来源：
- [Peekaboo 4.9.2 Release](https://github.com/openclaw/Peekaboo/releases/tag/v4.9.2)
- [该版本 MCP 接口与状态语义](https://github.com/openclaw/Peekaboo/blob/v4.9.2/docs/MCP.md)
- [该版本 README 与系统要求](https://github.com/openclaw/Peekaboo/blob/v4.9.2/README.md)
- [Cua Driver 接口及可选 perception 说明](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)
- [Windows-MCP 安装与工具文档](https://github.com/CursorTouch/Windows-MCP/blob/main/README.md)

## 本机实测

实验目录：`experiments/computer-use/`，与正式代码隔离，未提交到远程。

下载官方 `peekaboo-macos-arm64.tar.gz`，SHA-256 与发布的 checksums.txt 一致：
`d0679fdccab7295261add8be4880a7ba0f87a8e6e1aa0fec1d21c6c98c79f448`。

CLI 版本：4.9.2，build `959665e5f`。测试环境：macOS 26.5。

最初 CLI 权限查询自动连接到本机 Peekaboo Bridge，因此该次查询不作为独立后端证据。后续明确启动 `peekaboo mcp --no-remote`，动作元数据 route 为 local。

| 验证 | 结果与证据 |
| --- | --- |
| MCP initialize | PASS；协议协商 2024-11-05，服务 peekaboo-mcp 4.9.2；`evidence/01-initialize.json` |
| tools/list | PASS；26 个工具，包含 see/click/type/scroll/press；`02-tools-list.json` |
| 当前执行环境系统权限 | Screen Recording、Accessibility、Event Synthesizing 均返回 Granted；`03-tools-call.json` |
| 指定窗口截图与元素读取 | PASS；只观察实验应用 GPTBridgeCUProbe，返回 PNG image block 和可操作元素 ID；`04-tools-call.json`、`04-capture.png` |
| 输入与读回 | PASS；使用 see 返回的 snapshot 和 elem_2 调用 type；再次 see 读回 `gpt-bridge-cu-20261013-a71c`；`05/06-tools-call.json` |
| 点击与效果确认 | PASS（由后续观察确认）；elem_3 点击只发送一次；界面读回“点击 1 次；输入：gpt-bridge-cu-20261013-a71c”；`07/08-tools-call.json`、`08-capture.png` |
| 收尾 | 实验 MCP 客户端及其子进程结束，实验 GUI PID 84685 已退出；正式 Git 跟踪文件没有修改 |

实验原生窗口由 `Probe.swift` 创建；`mcp_probe.py` 是独立 stdio 测试客户端，保存原始 JSON-RPC 响应与截图。它是实验脚手架，不是正式接入实现。

权限结果只证明本次进程启动环境可用，不能替代未来从签名 gpt-bridge 应用启动、首次安装和打包后的系统权限验证。

### 实测发现：点击返回错误不代表没有执行

点击响应 `isError: true`，文字为 “Click did not return a confirmed outcome”。元数据实际为：

```json
{"dispatch_state":"dispatched","mutation_dispatched":true,"effect":"unverifiable","retry_safe":false,"escalation":"observe_before_retry","route":"local"}
```

没有重试点击。重新 see 后看到了点击次数 1 和完整验证标识，截图也一致。

正式接入必须区分“未发送”“已发送但效果未知”“观察后确认”；不能把一般错误统一转换成可重试。超时和取消同样不能假定动作没执行。

## 建议的接入结构

ChatGPT → 现有 OpenAI Tunnel → gpt-bridge MCP 网关：

- 文件/命令工具 → 现有 Desktop Commander 与文件权限代理。
- Computer Use 工具 → 新的桌面操作策略层 → Peekaboo MCP（Mac），Windows 后端后续单独验证。

当前 `desktop/bridge/proxy.mjs` 只接受 DC 工具白名单，并使用 DC 的参数 schema；直接把 click/see 加进名字列表无法工作。需要按后端分别注册、校验与路由，并管理两个子进程生命周期。

当前代理会移除 `_meta`。Computer Use 不能直接沿用这种处理：必须在适配器保留需要的动作状态、目标身份和坐标上下文，并把影响下一步判断的状态放入模型可读的结构化/文本结果；不能只依赖客户端未必显示的 `_meta`。不需要因此放开现有 MCP App widget 元数据。

建议先开放最小工具集合：状态、观察指定窗口、点击、输入、滚动、按键、停止；使用 `cu_` 前缀避免名称冲突。不整体转发 agent、analyze、clipboard、browser、app quit-all 等全部上游能力。

每次观察返回截图、snapshot、目标窗口身份及坐标基准；动作必须引用有效的观察。首版优先元素操作，坐标操作要明确图片像素与屏幕逻辑坐标的换算。

桌面端新增独立“允许控制电脑”开关（默认关闭）、当前目标应用/窗口和立即停止。目录只读权限不构成 GUI 沙箱，GUI 可打开其他文件；界面不能把两者混为同一安全边界。停止应拒绝新动作并清理待执行动作，已发送动作不能承诺撤销。

## 进入正式开发前还需验证

下一关只做一次集中端到端验证：用独立测试 Tunnel 把本次 MCP 后端接入 ChatGPT，确认网页模型实际收到截图，并在同一实验窗口完成“观察 → 输入 → 点击 → 再观察”的闭环。核对图像是否被保留、schema 能否被网页接受、snapshot/结果状态是否能跨 Tunnel 正确使用。普通文本 echo 成功不能替代这一关。

本轮尚未测试：Tunnel 图像往返、ChatGPT 网页操作、Windows、滚动/拖拽/快捷键、多屏/Retina 坐标、屏幕锁定、取消、失焦/窗口关闭、打包签名后权限。当前只可标记“Mac 本机 MCP 初步验证通过”，不能标记“gpt-bridge 已支持 Computer Use”。

这关通过后，再确认最小 UI/工具范围并开发正式集成；当前不更改正式隧道或发布新版本。

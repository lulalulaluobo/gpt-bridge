# Computer Use Tunnel 端到端验证（PASS）

## 最终核验

2026-10-13 网页回传与本地记录一致：runID `1c276c6b-c3d1-43cc-bad5-ca58e6d8f95a`，验证码 `CU-648DD026`；实际调用 info → observe → type → click → observe。输入、点击各一次。原生按钮处理器 result.json 的 passed=true、clickCount=1，最后截图 observation-4.png 显示“验证通过 · 点击 1 次”。

点击返回 mutationDispatched=true、effect=unverifiable；没有重试，通过后续截图核实结果。这是正式实现必须保留的语义。

实验服务已停止，恢复脚本成功退出。正式服务 PID 4311，running/healthy/ready 均 true，原工作区 fingerprint `82c5335aadf2f913c15d99be1b220237f6783c52601ad18302622056ff4b5151` 一致；没有覆盖 connections.json。网页刷新工具可恢复文件/命令工具。

验证范围为 macOS 专用窗口的图像返回、输入、点击；不代表任意应用或 Windows 已验证。下文保留本次验证流程记录。

2026-10-13；本地基线提交 `730f280`，未推送远程。用户已明确同意临时复用当前隧道，期间暂停文件/命令工具。

## 测试启动时的状态（历史记录）

- 原正式服务 PID 53857 已由原控制器安全停止；切换前 activeTasks=0，list_sessions 无活动会话。
- 实验使用相同 Tunnel ID、单独 runtime state/profile，alias `gpt-bridge-cu-test`。
- 已核实 process_running、healthy、ready 均 true。
- 实验初始 runID `1c276c6b-c3d1-43cc-bad5-ca58e6d8f95a`；gateway PID 93424；GUI PID 93467。未来检查以 runtime/e2e/run.json 和真实进程为准，不只信这些历史 PID。
- 只提供 cu_probe_info / cu_probe_observe / cu_probe_type / cu_probe_click。
- observe 只返回专用测试窗口的图片，剔除上游 AX/OCR 文本；验证码不出现在工具说明、提示词或状态响应里。
- type/click 在服务端绑定本次 GUI PID、窗口和元素，不接受任意应用、坐标、PID 或路径。输入一次、点击一次；服务期限为启动后 45 分钟，过期拒绝操作。
- 本地 smoke 已通过：四工具发现、PNG 返回、文本不泄漏屏幕验证码、拒绝传入任意 PID；首次发现 GUI 就绪竞态，增加应用就绪文件检查后通过。
- 正式安装包、应用配置文件和原工具实现均未修改。凭据仅经钥匙串→内存→运行进程环境传递；gateway 在启动子进程前移除 Runtime key。
- 内置浏览器访问 ChatGPT 遇到 Cloudflare 人机验证，未绕过；临时标签已关闭。网页验证需在用户已登录的浏览器继续。

## 用户集中执行一次

1. 打开原 ChatGPT 插件详情，刷新/更新工具；确认出现 4 个 `cu_probe_*` 工具并启用。
2. 保持本机测试窗口打开；测试期间不要点 gpt-bridge 的连接/重启，也不要手动输入测试码。
3. 新建 Work 对话，@ 选择同一插件，发送：

```text
仅使用这个插件的 cu_probe_* 工具，完成 Computer Use 验证。
1. 实际调用 cu_probe_info，记录 runID。
2. 实际调用 cu_probe_observe。必须从工具返回的截图里读出“屏幕验证码”；若看不到图片，停止并报告，不能猜测或使用其他工具。
3. 实际调用 cu_probe_type，text 为你从截图读出的完整验证码，只调用一次。
4. 实际调用 cu_probe_click，只调用一次。若响应表示动作已发送但结果不确定，不要重复点击。
5. 再实际调用 cu_probe_observe，从截图确认是否显示“验证通过”和“点击 1 次”。
返回 runID、截图中读出的验证码、各次工具实际结果和最终截图。不要用文件读取、终端、Python、浏览器或其他插件获取验证码，不要让我代填验证码。
```

回传网页结果和是否看到图片。助手随后核对本地 `runtime/e2e/result.json`（真实按钮处理器写入）、`calls.ndjson`（实际 MCP 调用）、观察截图；三者一致才能标记端到端通过。

## 恢复正式服务

用户回传后，无论验证通过与否，先执行并核对：

```sh
python3 experiments/computer-use/tunnel_probe.py restore
```

也可双击 `experiments/computer-use/Restore.command`。

恢复脚本先停止实验 runtime，确认其目标进程退出，再按私有 restore.json 里的原活动工作区启动正式服务；核对健康/就绪、工作区 fingerprint。不会覆盖 connections.json；若用户期间修改该配置则停止自动恢复，提示从应用重新连接。凭据仍从钥匙串读取，不回显、不写文件。

正式服务恢复后需在网页刷新插件工具，恢复文件/命令工具清单。若实验已过期或网关异常，先恢复，不自行重复启动、猜验证码或扩大工具权限。

## 证据与后续开发门槛

实验源文件在 experiments/computer-use/；runtime/ 下为私有运行记录、图像与恢复快照，不提交凭据或运行二进制。

本机与网页端到端均通过，正式服务已恢复。下一阶段按用户授权接入应用内控制开关、权限管理和停止按钮；不自动推送或发布。

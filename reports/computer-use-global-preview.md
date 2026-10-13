# 全局电脑控制预览

2026-10-13。用户确认原错误发生时仅开启了屏幕录制，辅助功能尚未开启；随后已在本机手动开启辅助功能。

本次修复保留权限检测失败时的逐项结果，明确报告缺少的权限；界面同时展示应用自身与控制后端的授权结果，并提供系统权限请求入口。Peekaboo 报告为可选的 Event Synthesizing 不再被当作开启的必需条件；实际工具错误仍原样返回，不跳过执行层限制。

用户已授权全局应用控制，因此移除每次选择授权应用的交互。开启后可使用 computer_apps、computer_open、computer_windows、computer_observe、computer_type、computer_click。授权持续到停止、断开或应用退出；重连不恢复授权。选择应用和窗口由模型完成，无需用户逐个添加。Peekaboo 4.9.2 MCP 支持后台启动与指定窗口操作，不支持前台焦点切换；本版不宣称具备该能力。

点击与输入仍绑定最新观察及进程身份，窗口切换后旧观察失效。操作结果不确定时不重放，需重新观察。文件权限与命令工具保持独立。

验证：Swift 15 项通过；目录权限 18 项通过；代理回归 114 项通过；Computer Use 专项覆盖关闭门禁、全局发现/启动、窗口一致性、旧观察失效、PID 复用、停止与启动竞态。

打包后原生专用窗口集成验证通过：全局开启、指定窗口截图、输入、点击一次、结果确认、停止后文件工具继续可用。此项是本地打包程序验证，未冒充新版网页端到端验收。

DMG：`desktop/dist/gpt-bridge-0.11-cu-global-preview-arm64.dmg`；hdiutil 校验通过。SHA256：`9c1ce0321025cda21de2b9c911ee3bb952da7bec5f33a7c9491ef665ee8fc984`。

已替换 `/Applications/gpt-bridge.app` 并恢复隧道，PID63091，running/healthy/ready=true，activeTasks=0。工作区指纹仍为 `82c5335aadf2f913c15d99be1b220237f6783c52601ad18302622056ff4b5151`，配置文件未修改。旧版位于 `desktop/build/backups/gpt-bridge-before-global-cu-20261013.app.archived`。未推送远程或发布 Release。原生 UI 曾读到“已连接”，随后连接间歇失败，不能据此声称已验证新面板所有交互。

官方执行上下文说明：https://peekaboo.sh/integrations/subprocess.html 。应用 UI 授权与后端进程权限不能互相推定；本次已确认的缺失项是辅助功能。原生 UI 自动化目前连接失败，不能宣称已自动核验用户系统设置。

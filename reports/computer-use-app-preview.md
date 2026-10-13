# Computer Use 应用开发预览

2026-10-13。用户要求先验证再开发；网页端到端已通过，原正式隧道曾恢复（PID4311，健康/就绪通过，activeTasks=0）。随后用户明确要求重新打包DMG并替换本机服务。新版已安装到 /Applications/gpt-bridge.app，旧应用已正常退出并停止旧服务；新应用PID28540已启动，但当前等待用户在本机允许钥匙串访问，服务尚未重新连接。未推送 GitHub、未发布 Release。

安装包：desktop/dist/gpt-bridge-0.11-cu-preview-arm64.dmg；hdiutil verify通过。SHA256：84f9feca08f9dffa5d4eb099c9546b6663109a469c08c69647469ff74b134e0f。旧版回退备份：desktop/build/backups/gpt-bridge-before-cu-20261013.zip（ZIP校验通过），另保留.app.archived目录。构建副本已注销并归档，正常启动入口仍只有 /Applications/gpt-bridge.app。

升级前connections.json摘要：eae91465b07a7066ec41c42af7d7ae50a530983c435e37b861d20b6f9b10b1dc；不覆盖用户数据。收到用户“已允许”后先查status/健康/就绪，再查看应用“电脑控制”的系统权限。不要绕过macOS密码提示。

用户演示窗口已打开：gpt-bridge CU Test，PID29454；记录目录 experiments/computer-use/runtime/app-demo-b3a209b8-5159-49c0-bb5e-f565cf1d720c。演示仅等用户网页测试，未替用户输入或点击。任务提示词见 reports/computer-use-task-prompt.md。用户需选择该应用并开启15分钟，再刷新网页工具。

## 实现

- 连接设置中的“电脑控制”：选择本机已打开应用，开启15分钟；默认关闭，服务重启/应用启动关闭。菜单栏和设置均可立即停止。
- 屏幕录制、辅助功能、输入权限检查，系统设置入口。Peekaboo 4.9.2 CLI 随包，使用 --no-remote，子进程不继承隧道密钥。Mac最低14保持，电脑控制仅15+；Windows不开放。
- computer_observe / computer_type / computer_click 与原文件和命令工具并存。进程身份绑定启动时间和可执行路径，首次观察锁定窗口；动作只接受最近截图中出现的元素，不开放任意PID/路径/坐标。一次观察只能派发一次动作，失败或超时不自动重试。
- 撤销由独立管理命令写入私有授权文件；代理定时检查并关闭后端，不需等待网页模型下一次调用。已派发动作不可撤销。
- 工具调度说明：文件与结构化工具优先、批处理用已启用命令、界面步骤用CU；权限拒绝不得换工具绕过。屏幕内容按数据处理。

## 验证

- Swift测试15项通过。
- 原代理检查114项、目录权限18项通过。
- computer-use-test.mjs：默认关闭、严格参数、图像转发、进程身份变化、观察消费、防重复、停止、过期检查通过。
- computer-use-live.mjs：打包后的真实Peekaboo＋原生专用测试窗口，截图→输入→截图→点击→截图成功；原生事件结果passed=true、clickCount=1；停止后电脑工具拒绝，而write_file仍可成功。
- release构建及codesign --verify --deep --strict通过。保留0.11版本号及cu-preview构建标识，不替换已发布0.11资产。

## 实际范围与未验收

仅三个界面工具；尚未开放滚动、拖拽、快捷键、任意坐标和多窗口切换。系统签名变化后的用户权限流程及网页对新版三个工具的调用尚未验收。之前网页已通过的是四个隔离实验工具，不能把它当成新版工具验收。任意应用、跨机器和Windows均未验证。

本轮不需要用户重复旧测试。后续安装时先保留旧应用回退，核对系统权限后才开启电脑控制；在网页刷新工具清单即可发现新版工具。

## 官方定义与协作

Computer Use 是通过浏览器/桌面UI完成任务，模型从截图及工具结果决定动作；执行端负责落实。官方允许代码执行、内置computer工具及自定义函数/MCP接口。此项目使用自定义MCP接口和Peekaboo执行端，并非调用API内置computer工具。

- https://developers.openai.com/api/docs/guides/tools-computer-use
- https://openai.com/index/introducing-chatgpt-agent/

例如：文件工具读数据→命令清洗CSV→电脑控制在软件导入→截图/文件核对结果。模型选择工具，本机执行权限；屏幕授权与目录权限分开，均不等于OS沙箱。

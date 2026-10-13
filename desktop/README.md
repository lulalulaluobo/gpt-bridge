# gpt-bridge 0.11 桌面端

Apple Silicon，macOS 14 或更新版本。菜单栏应用把私有 OpenAI 隧道与本地 MCP 文件、命令能力连接起来。

[下载 0.11](https://github.com/lulalulaluobo/gpt-bridge/releases/tag/v0.11) · [完整配置教程](../README.md)

## 安装与日常使用

1. 打开 `gpt-bridge-0.11-arm64.dmg`，将 `gpt-bridge.app` 拖入 Applications，推出 DMG，再从 Applications 打开应用。
2. 创建或选择私有隧道，填写 Tunnel ID 与同一组织中具备 Read + Use 权限的 Runtime API key。密钥只保存到本机钥匙串；已保存时留空保留。
3. 用 macOS 文件夹选择器选择主目录。在侧栏“共用目录”添加文件夹，统一设置只读或读写；所有工作区和连接资料共用这份列表。名称自动取路径最后一个文件夹名。点击“应用并连接”。
4. 在 ChatGPT 添加私有 MCP 插件，连接方式选择同一隧道及“无需身份验证”，保留操作确认。私有隧道的组织和工作区权限继续生效。
5. 在对话中用 `@` 选中插件，实际读取一个授权目录里的测试文件。

可以保存多个本地工作区，一次启用一个。菜单栏提供状态和工作区管理；切换工作区继续使用同一隧道。存在活动任务时先等待结束或由你取消，再切换或断开。

“只读 / 读写”约束文件工具。命令执行单独开关；开启后命令仍使用当前 Mac 用户权限，可能访问或修改文件工具授权以外的路径。此版没有操作系统级命令隔离。[执行层权限边界](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/SECURITY.md)

关闭设置窗口后菜单栏和连接继续运行。可在设置中选择登录 Mac 时启动、启动应用后自动连接；主动断开后不会立即自动重连。休眠、断网和关机期间远程调用可能不可用，运行中的任务不能跨关机继续。

本版不开放 PDF 写入工具；`read_file` 的 PDF 读取依底层能力提供。核心连接与文件、命令功能无需 Chrome，不会自动下载浏览器。

工作区页面只管理主目录和命令开关；共用目录独立管理，底部固定保存与应用按钮。运行细节位于设置中的“连接诊断”。保存不会重启当前连接，应用才更新权限。未选中的主目录不会自动加入授权，但若它属于共用目录范围，仍按共用权限访问。嵌套共用目录按最具体路径匹配；工作区根目录继承适用共用规则中的只读约束。

## 从 MacBridge 升级与卸载

升级前先断开并退出旧应用。安装 gpt-bridge 后打开，已有配置、密钥和工作目录保留，单目录配置迁移为一个本地工作区。确认新版本正常后移除旧 `MacBridge.app`，保留一个日常应用入口。已有 ChatGPT 插件可以继续使用，升级新增工具后在网页设置刷新工具。

从 0.10 升级时，所有工作区的附加目录合并为全局共用目录；重复路径只留一条，权限冲突保留只读。配置升级为 schema 2，首次写入前自动备份 `connections-v1-backup.json`。回退旧应用需要同时恢复这份旧配置备份，勿让旧版本直接读写新配置。

- 配置、状态、专用执行层 HOME：`~/Library/Application Support/MacBridge/`
- 密钥：登录钥匙串，服务 `local.macbridge.desktop.runtime`。
- 原脚本部署：`~/.local/share/macbridge/`。导入已有部署会将其密钥存入钥匙串，原文件保留。
- Bundle identifier 保留 `local.macbridge.desktop`，内部可执行文件仍名为 `MacBridge`，用于兼容升级。

卸载前关闭登录自启并断开退出，再移除 Applications 中的应用。默认保留配置和钥匙串，重新安装时可继续使用。需要彻底清理时再分别移除本应用数据和钥匙串条目；不要混删其他应用或旧脚本部署。

当前使用个人 ad-hoc 签名，尚未进行 Developer ID 签名或 Apple 公证。首次安装被 macOS 拦截时，在确认来源后通过“隐私与安全性 → 仍要打开”处理，无需全局关闭系统保护。

## 构建与测试

源码现含 **Computer Use 开发预览**，尚未更新已发布的 0.11 Release。macOS 15+ 可在“连接与设置 → 电脑控制”选择已打开的应用、检查屏幕录制和辅助功能权限、开启 15 分钟授权。菜单栏及设置均可立即停止；停止不会撤销已派发的操作。只开放截图、按观察结果定位元素并点击、输入；尚无任意坐标、拖拽或全桌面控制。隧道重启会关闭授权。macOS 14 仍可使用原文件与命令功能；Windows 暂不开放电脑控制。

新构建内置校验过的 Peekaboo 4.9.2 CLI，无需额外安装 Peekaboo DMG。更新后的应用签名可能需要重新授予系统权限；旧 CLI 预检通过不能替代应用安装后的权限验收。

工具协作：文件内容优先文件工具，批处理优先已启用的命令，界面操作才使用电脑控制。模型拆解并调度，本机代理检查权限。权限拒绝不能通过换工具绕过。一次操作后重新观察，不能自动重试不确定的点击或输入。此实现通过自定义 MCP 工具接入，未调用 OpenAI API 内置 `computer` 工具。[官方定义](https://developers.openai.com/api/docs/guides/tools-computer-use)

补充验证：`node scripts/computer-use-test.mjs` 检查关闭、目标身份、过期观察、防重复执行、撤销与到期；`scripts/computer-use-live.mjs <Resources目录> <专用测试窗口二进制>` 验证真实后端和专用窗口，不占用正式隧道。

在 `desktop` 目录运行：

```bash
python3 scripts/bootstrap-runtime.py
swift test
python3 scripts/package.py --dmg
```

构建输入固定为 Node.js 24.9.0、tunnel-client 0.0.16 和 Desktop Commander 0.2.52。下载及校验缓存位于 `build/runtime-input/`，执行层的 npm 锁文件位于仓库 `runtime/`。打包用 `npm ci --ignore-scripts` 干净安装，不读取用户密钥，不复制运行中的 `node_modules`。

使用 `python3 scripts/bootstrap-runtime.py --check` 只检查已下载归档的固定校验和。已有同版本构建输入时：

```bash
python3 scripts/package.py --node /path/to/node-v24.9.0/bin/node \
  --runtime-source /path/to/verified/runtime --dmg --keep-app
```

`--runtime-source` 只提供 `vendor/tunnel-client-v0.0.16/` 中的二进制及许可证；npm package 和 lockfile 始终从仓库 `runtime/` 读取。Node 安装需保留同版本 npm 与 LICENSE，供构建和打包使用。

输出 `dist/gpt-bridge-0.11-arm64.dmg`。DMG 构建默认移除临时应用目录；`--keep-app` 留下 `dist/gpt-bridge.app` 供本机测试安装。安装卷暂存目录始终清理，避免重复应用入口。

运行依赖额外固定 `sharp 0.35.5`、`uuid 11.1.1`，仅对 `md-to-pdf` 替换 `chokidar 4.0.3`，保持 Desktop Commander 0.2.52。图像转换、ExcelJS 工作簿读写和模块基本兼容已验证。

2026-10-13 的 npm audit 仍报告 6 个 moderate 依赖项，high 和 critical 为 0。剩余项为同一条 `md-to-pdf → gray-matter → js-yaml 3 → argparse 1 → sprintf-js` 链，末端 sprintf-js 当时没有已发布补丁。代理不开放 PDF 生成功能；普通文件及 PDF 读取不会调用 js-yaml 的 argparse 命令行路径。PDF 读取使用的 sharp 已修补；开启本机命令后仍可调用其他程序，这不是系统级隔离。[完整依赖说明](../README.md#已知依赖限制)

第三方许可证和构建清单位于应用 `Contents/Resources/`。对外稳定发行需正式签名、公证与跨机器验证；本机临时签名不能替代这些检查。仓库尚未指定自有源码许可证，第三方组件遵循各自随包许可证。

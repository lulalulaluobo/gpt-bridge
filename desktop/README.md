# gpt-bridge 0.10 桌面端

Apple Silicon，macOS 14 或更新版本。菜单栏应用把私有 OpenAI 隧道与本地 MCP 文件、命令能力连接起来。

[下载 0.10](https://github.com/lulalulaluobo/gpt-bridge/releases/tag/v0.10) · [完整配置教程](../README.md)

## 安装与日常使用

1. 打开 `gpt-bridge-0.10-arm64.dmg`，将 `gpt-bridge.app` 拖入 Applications，推出 DMG，再从 Applications 打开应用。
2. 创建或选择私有隧道，填写 Tunnel ID 与同一组织中具备 Read + Use 权限的 Runtime API key。密钥只保存到本机钥匙串；已保存时留空保留。
3. 用 macOS 文件夹选择器选择主目录、添加访问目录，名称自动取路径最后一个文件夹名，逐目录设置只读或读写。保存后连接。
4. 在 ChatGPT 添加私有 MCP 插件，连接方式选择同一隧道及“无需身份验证”，保留操作确认。私有隧道的组织和工作区权限继续生效。
5. 在对话中用 `@` 选中插件，实际读取一个授权目录里的测试文件。

可以保存多个本地工作区，一次启用一个。菜单栏提供状态和工作区管理；切换工作区继续使用同一隧道。存在活动任务时先等待结束或由你取消，再切换或断开。

“只读 / 读写”约束文件工具。命令执行单独开关；开启后命令仍使用当前 Mac 用户权限，可能访问或修改文件工具授权以外的路径。此版没有操作系统级命令隔离。[执行层权限边界](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/SECURITY.md)

关闭设置窗口后菜单栏和连接继续运行。可在设置中选择登录 Mac 时启动、启动应用后自动连接；主动断开后不会立即自动重连。休眠、断网和关机期间远程调用可能不可用，运行中的任务不能跨关机继续。

0.10 不开放 PDF 写入工具；`read_file` 的 PDF 读取依底层能力提供。核心连接与文件、命令功能无需 Chrome，不会自动下载浏览器。

## 从 MacBridge 升级与卸载

升级前先断开并退出旧应用。安装 gpt-bridge 后打开，已有配置、密钥和工作目录保留，单目录配置迁移为一个本地工作区。确认新版本正常后移除旧 `MacBridge.app`，保留一个日常应用入口。已有 ChatGPT 插件可以继续使用，升级新增工具后在网页设置刷新工具。

- 配置、状态、专用执行层 HOME：`~/Library/Application Support/MacBridge/`
- 密钥：登录钥匙串，服务 `local.macbridge.desktop.runtime`。
- 原脚本部署：`~/.local/share/macbridge/`。导入已有部署会将其密钥存入钥匙串，原文件保留。
- Bundle identifier 保留 `local.macbridge.desktop`，内部可执行文件仍名为 `MacBridge`，用于兼容升级。

卸载前关闭登录自启并断开退出，再移除 Applications 中的应用。默认保留配置和钥匙串，重新安装时可继续使用。需要彻底清理时再分别移除本应用数据和钥匙串条目；不要混删其他应用或旧脚本部署。

当前使用个人 ad-hoc 签名，尚未进行 Developer ID 签名或 Apple 公证。首次安装被 macOS 拦截时，在确认来源后通过“隐私与安全性 → 仍要打开”处理，无需全局关闭系统保护。

## 构建与测试

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

输出 `dist/gpt-bridge-0.10-arm64.dmg`。DMG 构建默认移除临时应用目录；`--keep-app` 留下 `dist/gpt-bridge.app` 供本机测试安装。安装卷暂存目录始终清理，避免重复应用入口。

运行依赖额外固定 `sharp 0.35.5`、`uuid 11.1.1`，仅对 `md-to-pdf` 替换 `chokidar 4.0.3`，保持 Desktop Commander 0.2.52。图像转换、ExcelJS 工作簿读写和模块基本兼容已验证。

2026-10-13 的 npm audit 仍报告 6 个 moderate 依赖项，high 和 critical 为 0。剩余项为同一条 `md-to-pdf → gray-matter → js-yaml 3 → argparse 1 → sprintf-js` 链，末端 sprintf-js 当时没有已发布补丁。代理不开放 PDF 生成功能；普通文件及 PDF 读取不会调用 js-yaml 的 argparse 命令行路径。PDF 读取使用的 sharp 已修补；开启本机命令后仍可调用其他程序，这不是系统级隔离。[完整依赖说明](../README.md#已知依赖限制)

第三方许可证和构建清单位于应用 `Contents/Resources/`。对外稳定发行需正式签名、公证与跨机器验证；本机临时签名不能替代这些检查。仓库尚未指定自有源码许可证，第三方组件遵循各自随包许可证。

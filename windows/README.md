# gpt-bridge Windows 托盘版

Windows 10 / 11 x64，要求 .NET Framework 4.8（较新版本 Windows 已预装）。任务栏右侧的通知区域显示常驻图标，设置窗口打开时也会显示任务栏按钮。

## 使用

1. 推荐双击 `gpt-bridge-0.11-windows-x64-setup.exe` 安装，再从开始菜单打开 gpt-bridge。安装到当前用户的 `%LOCALAPPDATA%\Programs\gpt-bridge`，无需管理员权限，也无需另装 Node.js 或 npm。安装前先在旧版托盘菜单选择“断开并退出”。也可以使用 ZIP 便携版：完整解压到固定位置，双击 `gpt-bridge.exe`，保留旁边的 `resources` 文件夹。
2. 在“连接与设置”填写 Tunnel ID 和同一组织中具备隧道 Read + Use 权限的 Runtime API key。在“工作区”选择主工作目录；目录名称直接取所选文件夹名。
3. 在“共用目录”添加资料或输出文件夹，选择只读或读写。共用权限适用于所有工作区和连接资料。点击“应用并连接”。
4. 显示“已连接”后，在 ChatGPT 创建私有 MCP 插件，选择同一 Tunnel 和“无需身份验证”，保留操作确认。实际调用 `read_file` 读取授权目录中的测试文件。[完整连接教程](../README.md#首次连接)

关闭或最小化设置窗口后，托盘图标和连接继续运行。双击图标打开设置；右键菜单提供状态、切换工作区、应用并连接、断开、断开并退出。图标如果被 Windows 收进折叠菜单，可从任务栏的隐藏图标区域拖到常显区域。

“保存”更新配置，“应用并连接”更新运行中的权限。切换工作区、断开、退出前检查活动命令、Node REPL、搜索和正在进行的工具调用；存在活动任务时操作被阻止。工作区根目录继承更具体的共用目录只读限制，不能通过切换根目录提升权限。

可选择“登录 Windows 时启动”和“打开应用后自动连接”。登录启动只显示托盘；主动断开后自动连接暂停，直到再次手动连接。程序使用当前用户的 Run 注册表项，不需要管理员权限。应用采用单实例机制，重复打开会唤起已有窗口。

Runtime key 使用 Windows DPAPI 的 CurrentUser 范围加密，存放在 `%LOCALAPPDATA%\gpt-bridge\credentials\`；不会写进配置或命令行。数据目录仅当前用户和 SYSTEM 可访问。配置及运行记录位于 `%LOCALAPPDATA%\gpt-bridge\`。请在应用中填写真实密钥，不要发送到聊天或提交到仓库。

命令执行默认关闭，开启后使用当前 Windows 用户权限；文件目录权限不能隔离任意命令。文件工具检查实际路径、junction、大小写、嵌套只读规则和移动双方权限。仅支持本地盘文件夹；整盘、UNC 网络路径、设备路径及 NTFS 备用数据流不作为文件工具入口。当前不开放 PDF 写入，不自动下载 Chrome。

## 源码构建与验证

在仓库根目录，使用 Windows 自带的 C# 编译器和 Python 3.11 或更新版本：

```powershell
python windows/scripts/package.py --test
python windows/scripts/package.py
python windows/scripts/installer.py
python windows/scripts/installer-smoke.py
node windows/scripts/bridge-smoke.mjs windows/dist/gpt-bridge/resources
node desktop/scripts/proxy-smoke.mjs windows/dist/gpt-bridge/resources
```

输出为 `windows/dist/gpt-bridge-0.11-windows-x64.zip`，同时保留解压目录 `windows/dist/gpt-bridge/` 和 ZIP 的 SHA-256 文件。`--app-only` 只编译界面供开发，不能用于连接；`--check` 只校验已缓存的官方运行包。

`installer.py` 将已有构建目录压缩成一个 `windows/dist/gpt-bridge-0.11-windows-x64-setup.exe`，并生成 SHA-256 文件。它校验并使用固定的 Inno Setup 6.7.3，仅将编译工具以官方便携模式放入 `windows/build/`，不注册系统安装或文件关联。安装包离线包含完整依赖；只在安装时释放文件，平时启动无需重复解压。这是单文件安装包，安装后仍有依赖目录。当前运行时需要 Node.js、原生隧道程序和 npm 模块，不能只保留界面的 EXE。

`installer-smoke.py` 使用独立 AppId、互斥锁及构建目录测试安装、覆盖升级、运行中保护和卸载，并校验全部安装文件的哈希；不启动实际应用，不修改真实的登录启动项和用户数据。[Inno Setup 官方说明](https://jrsoftware.org/isinfo.php)

构建固定 Node.js 24.9.0、OpenAI tunnel-client 0.0.16 与 Desktop Commander 0.2.52，并校验官方 Windows ZIP 的 SHA-256。npm 使用共用的 `desktop/runtime/package-lock.json` 与 `npm ci --ignore-scripts`；不复制用户配置、密钥或运行中的依赖。第三方许可证、依赖清单和构建摘要保存在 `resources/`。

当前是未签名的个人预览版。尚未完成 Authenticode 签名或跨机器安装验证；现有 macOS 版另见 [desktop/README.md](../desktop/README.md)。依赖版本和已知依赖限制与 macOS 0.11 相同，见 [依赖说明](../README.md#已知依赖限制)。真实私有隧道的联网验证需要在应用内配置自己的 Tunnel ID 与 Runtime key。

## 升级与卸载

升级前在托盘中选择“断开并退出”，再运行新版安装包，或替换 ZIP 版的整个解压目录。安装程序检查当前用户的应用实例，不会强制结束连接。保留 `%LOCALAPPDATA%\gpt-bridge\`，已有配置和加密密钥继续使用。安装包会将已有的登录启动项迁移到安装位置；ZIP 版移动后需要在新位置重新保存设置。

安装版从 Windows“已安装的应用”卸载，卸载前先断开退出。卸载器删除指向本次安装的登录启动项，保留本机配置和加密密钥。ZIP 版卸载前关闭“登录 Windows 时启动”并保存，再断开退出、删除解压目录。彻底卸载时再单独删除 `%LOCALAPPDATA%\gpt-bridge\`。

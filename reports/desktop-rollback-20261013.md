# 普通版回退与应用启动优化

按用户要求，桌面代码恢复到加入电脑控制前的 `730f280`，并新增 macOS `open_application`。原 Git 历史保留在 `backup/cu-preview-before-removal-20261013`；本次以新的回退提交记录，不改写远程历史。

新工具通过 `/usr/bin/open -a` 启动已安装应用，参数以数组传递，不经过 shell 或 AppleScript，受当前工作区命令开关约束。只报告启动请求被接受，不把它当作应用文档操作完成。Keynote 等应用的 AppleScript 文档控制仍须 macOS 按目标应用授予自动化权限；普通 Mac 没有允许全部目标的一键选项。更新后的临时签名可能使已有系统授权失效，长期需稳定开发者签名。

验证：应用启动校验测试通过；代理114项回归通过；打包后的真实 MCP 清单19个工具，无 computer_* / cu_probe_*；实际调用 open_application({app:"Keynote"}) 返回 launch_requested，确认 Keynote PID48903运行。未通过 AppleScript 请求控制应用，未修改演示文稿。

已替换 `/Applications/gpt-bridge.app`，服务PID33321，running/healthy/ready=true、activeTasks=0。工作区指纹和 connections.json SHA256保持一致。

Peekaboo CLI、实验窗口源码及运行产物、研究/验证报告、CU预览DMG、含CU的应用副本和CU私有开关文件已从项目及安装目录移到 `~/.Trash/gpt-bridge-computer-use-removed-20261013`，安装包与当前服务不再含该组件。废纸篓未清空。

DMG：`desktop/dist/gpt-bridge-0.11-arm64.dmg`，hdiutil校验及应用签名校验通过。SHA256：`894a2e7097905aaa576d8487403afa3c182eed1893980d46e3fb89e1742a00ef`。

用户确认提示来自macOS，因此没有修改ChatGPT的插件权限。网页需刷新工具并按需启用open_application；网页新工具调用尚未验收。本次未推送GitHub或发布Release。

Apple说明：https://support.apple.com/en-nz/guide/mac-help/mchl108e1718/mac

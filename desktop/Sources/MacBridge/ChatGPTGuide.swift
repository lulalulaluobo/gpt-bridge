import SwiftUI

struct ChatGPTGuide: View {
    @Bindable var model: AppModel
    var body: some View {
        GroupBox("最后一步：添加 ChatGPT 插件") {
            VStack(alignment: .leading, spacing: 10) {
                Text("1. 在 Platform 创建私有隧道并关联你的 ChatGPT 工作区。\n2. 在上方应用并连接，等待显示“已连接”。\n3. 在 ChatGPT 创建私有 MCP 插件，选择该隧道和“无需身份验证”，按需启用工具。")
                    .font(.callout)
                HStack {
                    Button("复制 Tunnel ID", action: model.copyTunnel).disabled(model.draft.tunnelID.isEmpty)
                    if let chatURL = URL(string: "https://chatgpt.com") {
                        Link("打开 ChatGPT ↗", destination: chatURL)
                    }
                }
                Text("换隧道后需在 ChatGPT 更新插件关联。工具列表未变化时，在插件详情刷新工具。")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(10)
        }
    }
}

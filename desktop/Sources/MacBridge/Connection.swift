import Foundation

struct Connection: Codable, Identifiable, Equatable, Sendable {
    var id = UUID().uuidString.lowercased()
    var name = "我的 Mac"
    var tunnelID = ""
    var workspaces: [LocalWorkspace] = [LocalWorkspace()]
    var selectedWorkspaceID: String?

    init() { selectedWorkspaceID = workspaces.first?.id }

    var selectedWorkspace: LocalWorkspace? {
        workspaces.first { $0.id == selectedWorkspaceID }
    }

    // Source compatibility only. New configurations encode workspaces instead.
    var workspace: String {
        get { selectedWorkspace?.root ?? "" }
        set {
            if let index = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }) {
                workspaces[index].root = newValue
            }
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, tunnelID, workspaces, selectedWorkspaceID, workspace
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        tunnelID = try container.decode(String.self, forKey: .tunnelID)
        if container.contains(.workspaces) {
            workspaces = try container.decode([LocalWorkspace].self, forKey: .workspaces)
            selectedWorkspaceID = try container.decode(String.self, forKey: .selectedWorkspaceID)
        } else {
            let root = try container.decode(String.self, forKey: .workspace)
            // Preserve native command capability of the previous deployment.
            workspaces = [LocalWorkspace(id: id, root: root, allowCommands: true)]
            selectedWorkspaceID = id
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(tunnelID, forKey: .tunnelID)
        try container.encode(workspaces, forKey: .workspaces)
        try container.encode(selectedWorkspaceID, forKey: .selectedWorkspaceID)
    }

    func validated() throws -> Connection {
        var result = self
        result.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        result.tunnelID = tunnelID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard UUID(uuidString: id) != nil else { throw AppFailure("连接标识无效。") }
        guard !result.name.isEmpty, result.name.count <= 80 else { throw AppFailure("请输入 1–80 字的连接名称。") }
        guard result.tunnelID.range(of: "^tunnel_[A-Za-z0-9]+$", options: .regularExpression) != nil else {
            throw AppFailure("Tunnel ID 应以 tunnel_ 开头，仅包含英文字母和数字。")
        }
        guard !workspaces.isEmpty, Set(workspaces.map(\.id)).count == workspaces.count else {
            throw AppFailure("连接至少需要一个工作区，且工作区标识不能重复。")
        }
        result.workspaces = try workspaces.map { try $0.validated() }
        guard result.selectedWorkspace != nil else { throw AppFailure("请选择有效的本地工作区。") }
        return result
    }
}

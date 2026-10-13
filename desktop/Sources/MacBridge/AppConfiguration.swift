import Foundation

struct AppConfiguration: Codable, Sendable {
    var schemaVersion = 2
    var connections: [Connection] = []
    var sharedDirectories: [AccessDirectory] = []
    var selectedID: String?
    var connectOnLaunch = false
    // Persist an explicit disconnect across application launches.
    var manuallyDisconnected = false

    init() {}

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, connections, sharedDirectories, selectedID, connectOnLaunch, manuallyDisconnected
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let version = try c.decode(Int.self, forKey: .schemaVersion)
        guard (1...2).contains(version) else { throw AppFailure("配置来自更新版本，请更新 gpt-bridge。") }
        connections = try c.decode([Connection].self, forKey: .connections)
        selectedID = try c.decodeIfPresent(String.self, forKey: .selectedID)
        connectOnLaunch = try c.decodeIfPresent(Bool.self, forKey: .connectOnLaunch) ?? false
        manuallyDisconnected = try c.decodeIfPresent(Bool.self, forKey: .manuallyDisconnected) ?? false
        sharedDirectories = try c.decodeIfPresent([AccessDirectory].self, forKey: .sharedDirectories) ?? []
        if version == 1 {
            sharedDirectories += connections.flatMap(\.workspaces).flatMap(\.directories)
        }
        sharedDirectories = try Self.normalizedDirectories(sharedDirectories)
        if version == 2 && connections.flatMap(\.workspaces).contains(where: { !$0.directories.isEmpty }) {
            throw AppFailure("配置包含旧的工作区目录，请从备份恢复或重新导入。")
        }
        for ci in connections.indices {
            for wi in connections[ci].workspaces.indices { connections[ci].workspaces[wi].directories = [] }
        }
    }

    static func normalizedDirectories(_ directories: [AccessDirectory]) throws -> [AccessDirectory] {
        var result: [AccessDirectory] = []
        for directory in directories {
            let value = try directory.validated()
            if let i = result.firstIndex(where: { $0.path == value.path }) {
                if value.access == .readOnly { result[i].access = .readOnly }
            } else { result.append(value) }
        }
        guard Set(result.map(\.id)).count == result.count else { throw AppFailure("目录标识重复，请重新选择文件夹。") }
        return result
    }

    /// Expand the global grants only at the runtime boundary. Stored workspaces remain independent.
    static func applying(_ directories: [AccessDirectory], to connection: Connection) -> Connection {
        var result = connection
        result.workspaces = connection.workspaces.map { workspace in
            var value = workspace
            let root = URL(filePath: value.root).standardizedFileURL.resolvingSymlinksInPath().path
            value.root = root
            value.directories = directories.filter { $0.path != root }
            // The selected root must not turn a shared read-only folder into a writable subtree.
            let inherited = directories.filter { root == $0.path || root.hasPrefix($0.path + "/") }
                .max { $0.path.count < $1.path.count }
            if inherited?.access == .readOnly { value.rootAccess = .readOnly }
            return value
        }
        return result
    }
}

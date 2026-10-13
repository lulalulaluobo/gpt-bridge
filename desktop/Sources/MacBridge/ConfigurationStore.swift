import Foundation

struct ConfigurationStore: Sendable {
    let root: URL
    init(root: URL = FileManager.default.homeDirectoryForCurrentUser
        .appending(path: "Library/Application Support/MacBridge")) { self.root = root }

    func load() throws -> AppConfiguration {
        let file = root.appending(path: "connections.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return AppConfiguration() }
        let config = try JSONDecoder().decode(AppConfiguration.self, from: Data(contentsOf: file))
        guard config.schemaVersion == 2 else { throw AppFailure("配置来自更新版本，请更新 gpt-bridge。") }
        for connection in config.connections { _ = try connection.validated() }
        return config
    }

    func save(_ configuration: AppConfiguration) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true,
                               attributes: [.posixPermissions: 0o700])
        let file = root.appending(path: "connections.json")
        let backup = root.appending(path: "connections-v1-backup.json")
        if fm.fileExists(atPath: file.path), !fm.fileExists(atPath: backup.path) {
            let oldData = try Data(contentsOf: file)
            if let object = try JSONSerialization.jsonObject(with: oldData) as? [String: Any],
               object["schemaVersion"] as? Int == 1 {
                try oldData.write(to: backup, options: .atomic)
                try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
            }
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(configuration).write(to: file, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

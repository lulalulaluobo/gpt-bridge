import Foundation

struct ConfigurationStore: Sendable {
    let root: URL
    init(root: URL = FileManager.default.homeDirectoryForCurrentUser
        .appending(path: "Library/Application Support/MacBridge")) { self.root = root }

    func load() throws -> AppConfiguration {
        let file = root.appending(path: "connections.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return AppConfiguration() }
        let config = try JSONDecoder().decode(AppConfiguration.self, from: Data(contentsOf: file))
        guard config.schemaVersion == 1 else { throw AppFailure("配置来自更新版本，请更新 gpt-bridge。") }
        for connection in config.connections { _ = try connection.validated() }
        return config
    }

    func save(_ configuration: AppConfiguration) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true,
                               attributes: [.posixPermissions: 0o700])
        let file = root.appending(path: "connections.json")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(configuration).write(to: file, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

import Testing
import Foundation
@testable import MacBridge

struct ConfigurationTests {
    @Test func migratesOldWorkspaceWithoutChangingCredentialIdentity() throws {
        let id = UUID().uuidString.lowercased()
        let old: [String: String] = ["id": id, "name": "MacBridge", "tunnelID": "tunnel_legacy",
                                    "workspace": "/tmp/Existing workspace"]
        let data = try JSONSerialization.data(withJSONObject: old)
        let migrated = try JSONDecoder().decode(Connection.self, from: data)
        #expect(migrated.id == id)
        #expect(migrated.workspaces.count == 1)
        #expect(migrated.selectedWorkspaceID == id)
        #expect(migrated.selectedWorkspace?.root == "/tmp/Existing workspace")
        #expect(migrated.selectedWorkspace?.allowCommands == true)
        #expect(migrated.selectedWorkspace?.rootAccess == .readWrite)
        let encoded = try JSONEncoder().encode(migrated)
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(object["workspace"] == nil)
        #expect(object["workspaces"] != nil)
        #expect(try JSONDecoder().decode(Connection.self, from: encoded) == migrated)
    }

    @Test func derivesNamesAndValidatesSelectedWorkspace() throws {
        var connection = Connection()
        connection.tunnelID = "tunnel_foldernames"
        connection.workspaces = [LocalWorkspace(root: "/tmp/中文资料"), LocalWorkspace(root: "/tmp/Code project")]
        connection.selectedWorkspaceID = connection.workspaces[1].id
        #expect(connection.selectedWorkspace?.name == "Code project")
        #expect(AccessDirectory(path: "/tmp/中文资料/").name == "中文资料")
        #expect(connection.workspaces.allSatisfy { !$0.allowCommands })
        #expect(AccessDirectory(path: "/tmp/data").access == .readOnly)
        #expect(try connection.validated().workspaces.count == 2)
        connection.selectedWorkspaceID = UUID().uuidString
        #expect(throws: AppFailure.self) { try connection.validated() }
    }

    @Test func rejectsDuplicateDirectoriesAndRetainsNestedPolicy() throws {
        var workspace = LocalWorkspace(root: "/tmp/root")
        workspace.directories = [AccessDirectory(path: "/tmp/root/child", access: .readOnly)]
        #expect(try workspace.validated().directories[0].access == .readOnly)
        workspace.directories.append(AccessDirectory(path: "/tmp/root"))
        #expect(throws: AppFailure.self) { try workspace.validated() }
    }
    @Test func rejectsUnsafeInputs() throws {
        var c = Connection()
        #expect(throws: AppFailure.self) { try c.validated() }
        c.tunnelID = "tunnel_abc123"; c.workspace = "/"
        #expect(throws: AppFailure.self) { try c.validated() }
        c.workspace = "/tmp/with\nnewline"
        #expect(throws: AppFailure.self) { try c.validated() }
        c.workspace = "/tmp/Mac Bridge's files"
        #expect(try c.validated().workspace == c.workspace)
    }
    @Test func persistsPreferencesWithoutSecrets() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigurationStore(root: root)
        var c = Connection(); c.tunnelID = "tunnel_test123"
        var config = AppConfiguration(); config.connections = [c]; config.selectedID = c.id
        config.connectOnLaunch = true; config.manuallyDisconnected = true
        try store.save(config)
        let read = try store.load()
        #expect(read.connections == [c])
        #expect(read.manuallyDisconnected && read.connectOnLaunch)
        let attrs = try FileManager.default.attributesOfItem(atPath: root.appending(path: "connections.json").path)
        #expect((attrs[.posixPermissions] as? Int) == 0o600)
    }
    @Test func corruptConfigurationIsNotOverwrittenOnLoad() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appending(path: "connections.json")
        try Data("broken".utf8).write(to: file)
        #expect(throws: (any Error).self) { try ConfigurationStore(root: root).load() }
        #expect(try String(contentsOf: file, encoding: .utf8) == "broken")
    }
}

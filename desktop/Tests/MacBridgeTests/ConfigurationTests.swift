import Testing
import Foundation
@testable import MacBridge

struct ConfigurationTests {
    @Test func migratesDirectoriesGloballyAndRoundTripsWithoutReintroducingWorkspaceGrants() throws {
        var a = Connection(); a.tunnelID = "tunnel_migration"
        a.workspaces = [LocalWorkspace(root: "/tmp/one", directories: [AccessDirectory(path: "/tmp/shared", access: .readWrite)]),
                        LocalWorkspace(root: "/tmp/two", directories: [AccessDirectory(path: "/tmp/shared", access: .readOnly),
                                                                       AccessDirectory(path: "/tmp/extra")])]
        a.selectedWorkspaceID = a.workspaces[1].id
        var b = Connection(); b.tunnelID = "tunnel_other"
        b.workspaces[0].directories = [AccessDirectory(path: "/tmp/other-connection")]
        var old = AppConfiguration(); old.schemaVersion = 1; old.connections = [a, b]; old.selectedID = a.id
        old.connectOnLaunch = true; old.manuallyDisconnected = true
        let migrated = try JSONDecoder().decode(AppConfiguration.self, from: JSONEncoder().encode(old))
        #expect(migrated.schemaVersion == 2)
        #expect(migrated.sharedDirectories.count == 3)
        #expect(migrated.sharedDirectories.first?.access == .readOnly)
        #expect(migrated.connections.flatMap(\.workspaces).allSatisfy { $0.directories.isEmpty })
        #expect(migrated.connections[0].selectedWorkspaceID == a.selectedWorkspaceID)
        #expect(migrated.connectOnLaunch && migrated.manuallyDisconnected)
        let roundtrip = try JSONDecoder().decode(AppConfiguration.self, from: JSONEncoder().encode(migrated))
        #expect(roundtrip.sharedDirectories == migrated.sharedDirectories)
        for connection in roundtrip.connections {
            let runtime = AppConfiguration.applying(roundtrip.sharedDirectories, to: connection)
            #expect(runtime.workspaces.allSatisfy { $0.directories == migrated.sharedDirectories })
        }
    }

    @Test func sameRootGrantUsesReadOnlyWithoutDuplicateAndCanonicalAliasesMerge() throws {
        var c = Connection(); c.workspace = "/tmp/project"
        let path = try LocalWorkspace.validatedPath(c.workspace)
        let grants = try AppConfiguration.normalizedDirectories([
            AccessDirectory(path: "/tmp/project", access: .readWrite),
            AccessDirectory(path: path, access: .readOnly)
        ])
        #expect(grants.count == 1)
        let resolved = AppConfiguration.applying(grants, to: c)
        #expect(resolved.selectedWorkspace?.rootAccess == .readOnly)
        #expect(resolved.selectedWorkspace?.directories.isEmpty == true)
        #expect(c.selectedWorkspace?.rootAccess == .readWrite)
        c.workspace = path + "/nested-project"
        #expect(AppConfiguration.applying(grants, to: c).selectedWorkspace?.rootAccess == .readOnly)
        c.workspace = path + "-other"
        #expect(AppConfiguration.applying(grants, to: c).selectedWorkspace?.rootAccess == .readWrite)
    }

    @Test func savingMigrationCreatesExactRecoverableBackup() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigurationStore(root: root)
        var c = Connection(); c.tunnelID = "tunnel_backup"
        c.workspaces[0].directories = [AccessDirectory(path: "/tmp/reference")]
        var old = AppConfiguration(); old.schemaVersion = 1; old.connections = [c]
        try store.save(old)
        let original = try Data(contentsOf: root.appending(path: "connections.json"))
        let migrated = try store.load()
        try store.save(migrated)
        #expect(try Data(contentsOf: root.appending(path: "connections-v1-backup.json")) == original)
        #expect(try store.load().sharedDirectories.count == 1)
    }

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

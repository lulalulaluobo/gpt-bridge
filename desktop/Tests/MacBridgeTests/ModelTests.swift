import Testing
import Foundation
import Security
@testable import MacBridge

struct ModelTests {
    @Test @MainActor func sharedPermissionChangesFollowEveryWorkspaceAndRemainDraftUntilApplied() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let model = AppModel(store: ConfigurationStore(root: root), monitor: false, runtime: MockRuntime())
        let id = model.draft.id
        defer {
            try? FileManager.default.removeItem(at: root)
            SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: "local.macbridge.desktop.runtime", kSecAttrAccount as String: id] as CFDictionary)
        }
        model.draft.tunnelID = "tunnel_global"
        model.secret = "synthetic-shared-test"
        let second = LocalWorkspace(root: "/tmp/second")
        model.draft.workspaces.append(second)
        model.sharedDirectories = [AccessDirectory(path: "/tmp/shared-ro", access: .readOnly)]
        await model.saveAndConnect()
        #expect(model.status.activeWorkspace?.directories.count == 1)
        await model.activateSavedWorkspace(second.id)
        #expect(model.status.activeWorkspaceID == second.id)
        #expect(model.status.activeWorkspace?.directories.first?.access == .readOnly)
        model.sharedDirectories[0].access = .readWrite
        #expect(!model.workspaceIsApplied)
        #expect(model.status.activeWorkspace?.directories.first?.access == .readOnly)
        await model.saveAndConnect()
        #expect(model.status.activeWorkspace?.directories.first?.access == .readWrite)
        model.sharedDirectories = []
        _ = try model.saveDraft()
        #expect(model.status.activeWorkspace?.directories.count == 1)
        let firstID = try #require(model.selected?.workspaces.first?.id)
        await model.activateSavedWorkspace(firstID)
        #expect(model.status.activeWorkspace?.directories.isEmpty == true)
        let restored = AppModel(store: ConfigurationStore(root: root), monitor: false, runtime: MockRuntime())
        #expect(restored.sharedDirectories.isEmpty)
        #expect(restored.draft.workspaces.allSatisfy { $0.directories.isEmpty })
    }
    @Test @MainActor func savingWorkspaceDoesNotApplyOrRestartRuntime() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let runtime = MockRuntime()
        let model = AppModel(store: ConfigurationStore(root: root), monitor: false, runtime: runtime)
        let id = model.draft.id
        defer {
            try? FileManager.default.removeItem(at: root)
            SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: "local.macbridge.desktop.runtime",
                           kSecAttrAccount as String: id] as CFDictionary)
        }
        model.draft.tunnelID = "tunnel_savedworkspace"
        model.secret = "synthetic-workspace-test"
        _ = try model.saveDraft()
        await model.connect()
        #expect(model.error == nil)
        let originallyApplied = model.status.activeWorkspace
        #expect(model.workspaceIsApplied)
        model.sharedDirectories.append(AccessDirectory(path: "/tmp/reference", access: .readOnly))
        _ = try model.saveDraft()
        #expect(model.status.activeWorkspace == originallyApplied)
        #expect(!model.workspaceIsApplied)
        #expect(await runtime.startCount == 1)
        await model.connect()
        #expect(model.workspaceIsApplied)
        #expect(await runtime.startCount == 2)
    }

    @Test @MainActor func menuSwitchUsesSavedWorkspaceAndPreservesActiveOnFailure() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let runtime = MockRuntime()
        let model = AppModel(store: ConfigurationStore(root: root), monitor: false, runtime: runtime)
        let id = model.draft.id
        defer {
            try? FileManager.default.removeItem(at: root)
            SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: "local.macbridge.desktop.runtime",
                           kSecAttrAccount as String: id] as CFDictionary)
        }
        model.draft.tunnelID = "tunnel_switchworkspace"
        model.secret = "synthetic-switch-test"
        let second = LocalWorkspace(root: "/tmp/second workspace")
        model.draft.workspaces.append(second)
        _ = try model.saveDraft()
        await model.connect()
        let activeID = model.status.activeWorkspaceID
        await runtime.setRejectSwitch(true)
        await model.activateSavedWorkspace(second.id)
        #expect(model.error == "有活动任务，不能切换工作区。")
        #expect(model.status.activeWorkspaceID == activeID)
        #expect(model.selected?.selectedWorkspaceID == activeID)
        await runtime.setRejectSwitch(false)
        await model.activateSavedWorkspace(second.id)
        #expect(model.status.activeWorkspaceID == second.id)
        #expect(model.selected?.selectedWorkspaceID == second.id)
    }
    @Test @MainActor func storesProfilesAndRejectsLiveEdits() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let model = AppModel(store: ConfigurationStore(root: root), monitor: false)
        let id = model.draft.id
        defer {
            try? FileManager.default.removeItem(at: root)
            SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: "local.macbridge.desktop.runtime",
                           kSecAttrAccount as String: id] as CFDictionary)
        }
        model.draft.tunnelID = "tunnel_modeltest"
        model.secret = "synthetic-model-test"
        let saved = try model.saveDraft()
        #expect(model.secret.isEmpty)
        #expect(model.connections == [saved])
        let restored = AppModel(store: ConfigurationStore(root: root), monitor: false)
        #expect(restored.selected == saved)
        model.status = RuntimeStatus(running: true, healthy: true, ready: true, pid: 1, activeID: id)
        model.draft.tunnelID = "tunnel_changed"
        #expect(throws: AppFailure.self) { try model.saveDraft() }
        #expect(try ConfigurationStore(root: root).load().connections[0].tunnelID == "tunnel_modeltest")
    }
}

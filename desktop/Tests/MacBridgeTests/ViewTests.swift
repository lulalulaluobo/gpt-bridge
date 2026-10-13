import Testing
import SwiftUI
import AppKit
@testable import MacBridge

struct ViewTests {
    @Test(arguments: [false, true]) @MainActor func rendersSettings(shared: Bool) throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let model = AppModel(store: ConfigurationStore(root: root), monitor: false)
        defer { try? FileManager.default.removeItem(at: root) }
        model.sharedDirectories = [
            AccessDirectory(path: "/Users/example/Documents/资料库"),
            AccessDirectory(path: "/Users/example/Movies/导出", access: .readWrite)
        ]
        model.draft.workspaces = [LocalWorkspace(root: "/Users/example/Projects/内容创作"), LocalWorkspace(root: "/Users/example/Projects/代码开发")]
        model.draft.selectedWorkspaceID = model.draft.workspaces.first?.id
        model.message = "工作区已生效。在 ChatGPT 使用当前隧道的插件。"
        model.status = RuntimeStatus(running: true, healthy: true, ready: true, activeID: model.draft.id,
                                     activeWorkspaceID: model.draft.selectedWorkspaceID,
                                     activeWorkspaceRoot: model.draftWorkspace.root,
                                     activeWorkspace: model.effectiveDraftWorkspace, allowCommands: false, activeTasks: 0)
        let content = shared ? AnyView(SharedDirectoriesView(model: model).padding(28)) : AnyView(SettingsView(model: model))
        let width: CGFloat = shared ? 640 : 900
        let view = content.frame(width: width, height: 620)
            .background(Color(nsColor: .windowBackgroundColor))
            .environment(\.colorScheme, .light)
        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: width, height: 620)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = hosting
        window.displayIfNeeded()
        RunLoop.current.run(until: Date.now.addingTimeInterval(0.2))
        hosting.layoutSubtreeIfNeeded()
        let bounds = hosting.bounds
        let bitmap = try #require(hosting.bitmapImageRepForCachingDisplay(in: bounds))
        hosting.cacheDisplay(in: bounds, to: bitmap)
        let data = try #require(bitmap.representation(using: .png, properties: [:]))
        #expect(data.count > 4000)
        if let output = ProcessInfo.processInfo.environment["MACBRIDGE_SNAPSHOT_PATH"] {
            try data.write(to: URL(filePath: shared ? output + "-shared.png" : output))
        }
    }
}

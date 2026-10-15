import SwiftUI

@MainActor @Observable
final class MethodLibraryModel {
    var directories: [String] = []
    var documents: [MethodDocument] = []
    var query = ""
    var error: String?
    var notice: String?
    var busy = false
    var loaded = false
    var matched = 0
    var nextOffset: Int?
    var refreshedAt: Date?
    var preview = ""
    var previewNextOffset: Int?
    private var searchedQuery = ""
    private let root: URL
    private let client: MethodLibraryClient
    private struct Configuration: Codable { var schemaVersion = 1; var directories: [String] }
    private struct SearchResponse: Decodable {
        var results: [MethodDocument]; var matched: Int; var nextOffset: Int?
        var incomplete: Bool; var skipped: Int; var errors: [DirectoryError]
    }
    private struct DirectoryError: Decodable { var path: String; var error: String }
    private struct ReadResponse: Decodable { var text: String; var nextOffset: Int? }

    init(root: URL = ConfigurationStore().root, resources: URL = Bundle.main.resourceURL!) {
        self.root = root; client = MethodLibraryClient(root: root, resources: resources)
        do {
            let file = root.appending(path: "method-library.json")
            if FileManager.default.fileExists(atPath: file.path) {
                let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: file))
                guard config.schemaVersion == 1 else { throw AppFailure("方法库配置版本不支持。") }
                directories = config.directories
            }
            loaded = true
        } catch { self.error = "无法读取方法库配置，原文件已保留：\(error.localizedDescription)" }
    }

    private func save(_ paths: [String]) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(Configuration(directories: paths))
        let file = root.appending(path: "method-library.json")
        try data.write(to: file, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        directories = paths
    }

    func addDirectory() async {
        guard loaded, !busy else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = true; panel.showsHiddenFiles = true
        panel.title = "添加方法资料目录"; panel.prompt = "允许只读"
        panel.message = "网页 GPT 可检索和读取这些目录中的 Skill 文档。"
        guard panel.runModal() == .OK else { return }
        do {
            let paths = Array(Set(directories + panel.urls.map { $0.resolvingSymlinksInPath().path })).sorted()
            guard paths.count <= 30 else { throw AppFailure("最多添加 30 个资料目录。") }
            guard !paths.contains("/") && !paths.contains(where: { root.path.hasPrefix($0 + "/") || $0.hasPrefix(root.path + "/") || $0 == root.path }) else {
                throw AppFailure("请选择具体资料文件夹，不要选择磁盘根目录或应用数据目录。")
            }
            try save(paths); await refresh()
        } catch { self.error = error.localizedDescription }
    }

    func remove(_ directory: String) async {
        guard loaded, !busy else { return }
        do { try save(directories.filter { $0 != directory }); await refresh() }
        catch { self.error = error.localizedDescription }
    }

    func refresh(more: Bool = false) async {
        guard loaded, !busy else { return }
        busy = true; defer { busy = false }
        error = nil; notice = nil
        if !more { documents = []; nextOffset = nil; matched = 0; searchedQuery = query }
        guard !directories.isEmpty else { refreshedAt = .now; return }
        do {
            let input: [String: Any] = ["action": "search", "query": searchedQuery, "offset": more ? nextOffset ?? 0 : 0, "limit": 20]
            let result = try JSONDecoder().decode(SearchResponse.self, from: await client.query(JSONSerialization.data(withJSONObject: input)))
            documents += result.results.filter { row in !documents.contains { $0.id == row.id } }
            matched = result.matched; nextOffset = result.nextOffset; refreshedAt = .now
            var notes = result.errors.map { "\($0.path)：\($0.error)" }
            if result.incomplete { notes.append("扫描达到上限，请选择更具体的资料目录。") }
            if result.skipped > 0 { notes.append("跳过 \(result.skipped) 个符号链接、不可读或超大文档。") }
            notice = notes.isEmpty ? nil : notes.joined(separator: "\n")
        } catch { self.error = error.localizedDescription }
    }

    func read(_ document: MethodDocument, more: Bool = false) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        error = nil
        if !more { preview = ""; previewNextOffset = nil }
        do {
            let input: [String: Any] = ["action": "read", "library_path": document.library_path,
                                      "document_path": document.document_path, "offset": more ? previewNextOffset ?? 0 : 0, "length": 100]
            let result = try JSONDecoder().decode(ReadResponse.self, from: await client.query(JSONSerialization.data(withJSONObject: input)))
            preview += (more ? "\n" : "") + result.text; previewNextOffset = result.nextOffset
        } catch { self.error = error.localizedDescription }
    }
}

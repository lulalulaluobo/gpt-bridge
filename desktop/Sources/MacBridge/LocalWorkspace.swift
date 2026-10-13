import Foundation

struct LocalWorkspace: Codable, Identifiable, Equatable, Sendable {
    var id = UUID().uuidString.lowercased()
    var root = FileManager.default.homeDirectoryForCurrentUser.appending(path: "MacBridgeWorkspace").path
    var rootAccess: DirectoryAccess = .readWrite
    var directories: [AccessDirectory] = []
    var allowCommands = false
    var name: String { URL(filePath: root).lastPathComponent }
    var directoryCount: Int { directories.count + 1 }

    func validated() throws -> LocalWorkspace {
        guard UUID(uuidString: id) != nil else { throw AppFailure("工作区标识无效。") }
        var result = self
        result.root = try Self.validatedPath(root)
        result.directories = try directories.map { try $0.validated() }
        guard Set(result.directories.map(\.id)).count == result.directories.count,
              Set([result.root] + result.directories.map(\.path)).count == result.directories.count + 1 else {
            throw AppFailure("同一工作区不能重复添加目录。")
        }
        return result
    }

    static func validatedPath(_ path: String) throws -> String {
        guard path.hasPrefix("/"), !path.contains("\n"), !path.contains("\0"), path != "/" else {
            throw AppFailure("请选择有效的文件夹，不能选择整个磁盘。")
        }
        let canonical = URL(filePath: path).standardizedFileURL.resolvingSymlinksInPath().path
        guard canonical != "/" else { throw AppFailure("文件夹不能指向整个磁盘。") }
        return canonical
    }
}

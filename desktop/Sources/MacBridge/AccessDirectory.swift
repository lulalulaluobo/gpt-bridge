import Foundation

struct AccessDirectory: Codable, Identifiable, Equatable, Sendable {
    var id = UUID().uuidString.lowercased()
    var path: String
    var access: DirectoryAccess = .readOnly
    var name: String { URL(filePath: path).lastPathComponent }

    func validated() throws -> AccessDirectory {
        guard UUID(uuidString: id) != nil else { throw AppFailure("访问目录标识无效。") }
        var result = self
        result.path = try LocalWorkspace.validatedPath(path)
        return result
    }
}

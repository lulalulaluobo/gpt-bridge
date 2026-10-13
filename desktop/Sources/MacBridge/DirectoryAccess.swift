import Foundation

enum DirectoryAccess: String, Codable, CaseIterable, Identifiable, Sendable {
    case readOnly
    case readWrite
    var id: Self { self }
    var title: String { self == .readOnly ? "只读" : "读写" }
}

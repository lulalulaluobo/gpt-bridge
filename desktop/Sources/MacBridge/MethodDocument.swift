import Foundation

struct MethodDocument: Decodable, Identifiable, Sendable {
    var title: String
    var preview: String
    var document_path: String
    var library_path: String
    var id: String { library_path + "/" + document_path }
}

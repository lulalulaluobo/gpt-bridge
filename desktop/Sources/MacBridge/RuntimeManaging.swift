import Foundation

protocol RuntimeManaging: Sendable {
    func call(_ action: String, connection: Connection?, key: String?) async throws -> RuntimeStatus
}

import Foundation

struct ComputerControlStatus: Decodable, Sendable {
    struct Permission: Decodable, Identifiable, Sendable {
        var name: String
        var granted: Bool
        var id: String { name }
        var title: String {
            switch name {
            case "Screen Recording": return "屏幕录制"
            case "Accessibility": return "辅助功能"
            case "Event Synthesizing": return "输入控制"
            default: return name
            }
        }
    }
    var available = false
    var enabled = false
    var targetName: String?
    var expires: Double?
    var permissions: [Permission]?
    var error: String?
}

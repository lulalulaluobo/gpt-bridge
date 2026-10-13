import AppKit
import Foundation

let output = URL(filePath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let inset = Double(pixels) * 0.06
        let rect = NSRect(x: inset, y: inset, width: Double(pixels) - inset * 2, height: Double(pixels) - inset * 2)
        NSColor(calibratedRed: 0.08, green: 0.23, blue: 0.40, alpha: 1).setFill()
        NSBezierPath(roundedRect: rect, xRadius: Double(pixels) * 0.20, yRadius: Double(pixels) * 0.20).fill()
        if let symbol = NSImage(systemSymbolName: "link", accessibilityDescription: nil) {
            let configuration = NSImage.SymbolConfiguration(pointSize: Double(pixels) * 0.46, weight: .semibold)
                .applying(.init(paletteColors: [.white]))
            let configured = symbol.withSymbolConfiguration(configuration) ?? symbol
            let symbolRect = NSRect(x: Double(pixels) * 0.24, y: Double(pixels) * 0.29, width: Double(pixels) * 0.52, height: Double(pixels) * 0.42)
            configured.draw(in: symbolRect)
        }
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { continue }
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try png.write(to: output.appending(path: name))
    }
}

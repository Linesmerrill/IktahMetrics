// Generates the IktahMetrics app icon: 1024×1024 PNG with a dark navy
// rounded square, the "IM" wordmark, and a green chart-up accent line.
// Run: swift scripts/make-icon.swift assets/icon.png
import AppKit
import Foundation

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let size: CGFloat = 1024

let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()

// Background: dark navy with rounded corners (macOS Big Sur+ "squircle"-ish).
NSColor(srgbRed: 0.071, green: 0.075, blue: 0.102, alpha: 1).setFill()
let bgPath = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size),
                          xRadius: 224, yRadius: 224)
bgPath.fill()

// Soft inner ring for depth.
NSColor(srgbRed: 0.373, green: 0.878, blue: 0.643, alpha: 0.14).setStroke()
let inner = NSBezierPath(roundedRect: NSRect(x: 36, y: 36, width: size - 72, height: size - 72),
                         xRadius: 200, yRadius: 200)
inner.lineWidth = 6
inner.stroke()

// Chart-up accent across the lower-left to upper-right quadrant.
NSColor(srgbRed: 0.373, green: 0.878, blue: 0.643, alpha: 0.55).setStroke()
let chart = NSBezierPath()
chart.move(to: NSPoint(x: 200, y: 230))
chart.line(to: NSPoint(x: 380, y: 380))
chart.line(to: NSPoint(x: 540, y: 300))
chart.line(to: NSPoint(x: 760, y: 540))
chart.lineWidth = 36
chart.lineCapStyle = .round
chart.lineJoinStyle = .round
chart.stroke()

// Arrowhead on the chart end.
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 760, y: 540))
arrow.line(to: NSPoint(x: 700, y: 540))
arrow.move(to: NSPoint(x: 760, y: 540))
arrow.line(to: NSPoint(x: 760, y: 480))
arrow.lineWidth = 36
arrow.lineCapStyle = .round
arrow.stroke()

// "IM" wordmark, centered, slightly above geometric center to balance the
// chart visually.
let text = "IM"
let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 360, weight: .heavy),
    .foregroundColor: NSColor(srgbRed: 0.953, green: 0.957, blue: 0.969, alpha: 1.0),
    .kern: -8,
]
let attrStr = NSAttributedString(string: text, attributes: attrs)
let textSize = attrStr.size()
let textRect = NSRect(
    x: (size - textSize.width) / 2,
    y: (size - textSize.height) / 2 + 40,
    width: textSize.width,
    height: textSize.height
)
attrStr.draw(in: textRect)

img.unlockFocus()

guard let tiff = img.tiffRepresentation,
      let bmp = NSBitmapImageRep(data: tiff),
      let data = bmp.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("Failed to render PNG\n".data(using: .utf8)!)
    exit(1)
}

do {
    try data.write(to: URL(fileURLWithPath: outPath))
    print("Wrote \(outPath) (\(Int(size))×\(Int(size)))")
} catch {
    FileHandle.standardError.write("Failed to write \(outPath): \(error)\n".data(using: .utf8)!)
    exit(1)
}

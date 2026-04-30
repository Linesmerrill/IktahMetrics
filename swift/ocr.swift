import Foundation
import Vision
import AppKit
import CoreGraphics

let stderr = FileHandle.standardError

func fail(_ msg: String) -> Never {
    stderr.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count >= 2 else {
    fail("usage: ocr <image-path>  |  ocr --frontmost  |  ocr --list-windows")
}

let arg1 = CommandLine.arguments[1]

// Subcommand: print the localized name and bundle identifier of the
// currently-frontmost application, tab-separated. No screen-recording
// permission required — this uses the public NSWorkspace API.
if arg1 == "--frontmost" {
    let app = NSWorkspace.shared.frontmostApplication
    let name = app?.localizedName ?? ""
    let bundleId = app?.bundleIdentifier ?? ""
    print("\(name)\t\(bundleId)")
    exit(0)
}

// Subcommand: list every on-screen window with its owner, title, and bounds.
// Format per line: pid\tbundleId\towner\ttitle\tx\ty\tw\th
// Used to let the user pick a target app, then track its window bounds
// dynamically (so capture follows the game window when it moves/resizes).
if arg1 == "--list-windows" {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        exit(0)
    }
    for win in info {
        let layer = (win[kCGWindowLayer as String] as? Int) ?? 0
        if layer != 0 { continue } // skip menubar / dock / status items
        let alpha = (win[kCGWindowAlpha as String] as? Double) ?? 1.0
        if alpha < 0.01 { continue }
        guard let bounds = win[kCGWindowBounds as String] as? [String: Any] else { continue }
        let w = (bounds["Width"] as? Double) ?? 0
        let h = (bounds["Height"] as? Double) ?? 0
        if w < 100 || h < 100 { continue } // skip notifications / tiny widgets
        let x = (bounds["X"] as? Double) ?? 0
        let y = (bounds["Y"] as? Double) ?? 0
        let pid = (win[kCGWindowOwnerPID as String] as? Int) ?? 0
        let owner = (win[kCGWindowOwnerName as String] as? String) ?? ""
        let title = (win[kCGWindowName as String] as? String) ?? ""
        let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? ""
        // Tab-separated; titles can contain spaces but never tabs.
        print("\(pid)\t\(bundleId)\t\(owner)\t\(title)\t\(Int(x))\t\(Int(y))\t\(Int(w))\t\(Int(h))")
    }
    exit(0)
}

// Otherwise, treat arg1 as an image path and OCR it.
let url = URL(fileURLWithPath: arg1)
guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("failed to load image at \(arg1)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("OCR request failed: \(error)")
}

guard let observations = request.results else { exit(0) }

for obs in observations {
    if let candidate = obs.topCandidates(1).first {
        print(candidate.string)
    }
}

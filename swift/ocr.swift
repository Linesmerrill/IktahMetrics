import Foundation
import Vision
import AppKit

let stderr = FileHandle.standardError

func fail(_ msg: String) -> Never {
    stderr.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count >= 2 else {
    fail("usage: ocr <image-path>  |  ocr --frontmost")
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

# IktahMetrics · Idle Iktah XP/sec overlay

A small **macOS menu bar app** that watches a region of your Idle Iktah window,
OCRs the live `~X xp / Y seconds` line, and shows the resulting
**XP per second** right in the menu bar. An optional draggable + resizable
overlay can be toggled on for a bigger readout — so you can compare activities
and pick the highest-XP one without doing the math.

OCR is done locally with Apple's [Vision framework](https://developer.apple.com/documentation/vision)
via a tiny Swift helper. No paid APIs, nothing leaves your machine.

<img width="240" height="172" alt="image" src="https://github.com/user-attachments/assets/9acba18c-17b1-4a44-b8d7-acd07a3db556" />
<img width="184" height="31" alt="image" src="https://github.com/user-attachments/assets/7481dd7e-9314-4447-bbd0-05f458020f9d" />

<img width="397" height="293" alt="image" src="https://github.com/user-attachments/assets/a695a4fb-bbdf-4ccc-991f-34ee701d8580" />



## Stack

- Electron (frameless transparent always-on-top window)
- macOS `screencapture -R` for region capture
- Swift CLI (`swift/ocr.swift`, ~30 lines) wrapping `VNRecognizeTextRequest`
- Vanilla HTML/CSS/JS in the renderer
- electron-builder → universal DMG

## Project layout

```
.
├── main.js                # Electron main process + IPC + capture/OCR pipeline
├── preload.js             # contextBridge surface (window.iktahmetrics.*)
├── package.json           # electron + electron-builder
├── src/
│   ├── index.html         # overlay UI
│   ├── renderer.js        # polling loop + parsing
│   ├── styles.css
│   ├── picker.html        # full-screen region picker
│   └── picker.js
├── swift/
│   ├── ocr.swift          # Vision OCR CLI helper
│   └── build.sh           # builds universal binary → build/ocr
└── build/
    └── ocr                # universal binary, packaged into app Resources
```

## Setup

```sh
# 1. Build the OCR helper (universal arm64 + x86_64 binary)
npm run build:ocr

# 2. Install Electron
npm install

# 3. Run in dev
npm start
```

You can test the OCR helper on its own:

```sh
./build/ocr path/to/screenshot.png
# prints recognized text lines, one per observation
```

## Usage

IktahMetrics lives in the macOS menu bar — no Dock icon, no floating window
unless you ask for one.

1. Launch the app. `XPS` appears in the menu bar.
2. Click it → **Set Region…** The screen dims; drag a rectangle around the
   `~X xp / 6.6 seconds` line in Idle Iktah. <kbd>Esc</kbd> cancels.
3. Click the menu again → **Start** (or press <kbd>⌘⇧S</kbd>). The menu bar
   title now updates with the live `xp/s` every ~1s.
4. The menu's first line shows status; the second shows the session-best.
   **Reset Session Best** zeroes it.
5. **Show Overlay** toggles a frameless, draggable, resizable card with a
   bigger readout. Drag anywhere on the card to move it; drag the SE corner
   (or any edge) to resize. Position and size persist across launches.
6. **Quit IktahMetrics** (<kbd>⌘Q</kbd>) exits.

State persists across launches:
- region: `~/Library/Application Support/IktahMetrics/region.json`
- overlay visibility + bounds: `~/Library/Application Support/IktahMetrics/overlay.json`

## Permissions

Capturing the screen requires **Screen Recording** permission on macOS 10.15+.

- On first capture, macOS prompts: allow IktahMetrics (and re-launch if needed).
- If you skipped the prompt, grant manually:
  **System Settings → Privacy & Security → Screen Recording → enable IktahMetrics**.
- In dev (`npm start`), permission is requested for **Electron** itself
  (or your terminal, depending on how Electron was launched). You may need
  to toggle it off/on once after the first prompt.

OCR via Vision needs no special permission — it runs entirely in-process.

## Distribution

```sh
npm run dist       # builds build/ocr, then a universal DMG into dist/
npm run pack       # unpacked .app for quick local testing
```

The universal binary is packaged at `Contents/Resources/ocr` inside the `.app`,
and `main.js` resolves the path automatically (`process.resourcesPath` when
packaged, `./build/ocr` in dev).

> **Note:** for distribution outside your own machine you'll want to codesign
> + notarize the app and the embedded `ocr` helper. electron-builder handles
> the app side if you set `CSC_*` env vars; the helper inherits the hardened
> runtime via the bundle.

## Parsing details

- OCR output is one recognized text line per observation.
- Match is `/([\d.]+)\s*xp\s*\/\s*([\d.]+)\s*seconds/i` — leading `~` is stripped.
- If multiple matches appear in OCR output, the first is used.
- Mismatched OCR (e.g. when the activity is paused or the region is wrong)
  surfaces as `no match` with a short preview of what was actually read.

## Troubleshooting

- **`screencapture failed`** → Screen Recording permission not granted yet,
  or the saved region went off-screen (e.g. monitor unplugged). Re-pick.
- **`ocr failed`** → make sure `build/ocr` exists. Re-run `npm run build:ocr`.
- **`no match`** → the region likely doesn't fully contain the text, or
  it captured neighboring UI. Re-pick a tighter rectangle.
- **Overlay disappears in fullscreen game** → it's set
  `visibleOnFullScreen`, but Steam's exclusive fullscreen on some Macs hides
  all overlays. Switch the game to windowed/borderless.

## Why a Swift helper instead of Tesseract / a JS OCR lib?

Vision's recognizer ships with macOS, has zero install cost, and handles the
game's stylized pixel digits considerably better than Tesseract on default
config. A 30-line Swift CLI keeps the dependency surface tiny and avoids
shipping a 50MB language model.

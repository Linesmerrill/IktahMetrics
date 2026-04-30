# IktahMetrics · Idle Iktah XP/sec overlay

A small **macOS menu bar app** that watches your Idle Iktah window, OCRs the
live `~X xp / Y seconds` line, and shows the resulting **XP per second** right
in the menu bar. An optional draggable + resizable overlay can be toggled on
for a bigger readout — so you can compare activities and pick the highest-XP
one without doing the math.

OCR is done locally with Apple's [Vision framework](https://developer.apple.com/documentation/vision)
via a tiny Swift helper. No paid APIs, nothing leaves your machine.

<img width="240" height="172" alt="image" src="https://github.com/user-attachments/assets/9acba18c-17b1-4a44-b8d7-acd07a3db556" />
<img width="184" height="31" alt="image" src="https://github.com/user-attachments/assets/7481dd7e-9314-4447-bbd0-05f458020f9d" />

<img width="397" height="293" alt="image" src="https://github.com/user-attachments/assets/a695a4fb-bbdf-4ccc-991f-34ee701d8580" />

## Stack

- Electron menu-bar app (frameless transparent overlay window)
- macOS `/usr/sbin/screencapture -R` for region capture, with the parent
  Electron process ad-hoc codesigned for stable TCC attribution
- Swift CLI (`swift/ocr.swift`) wrapping `VNRecognizeTextRequest`,
  `NSWorkspace.frontmostApplication`, and `CGWindowListCopyWindowInfo`
- Vanilla HTML/CSS/JS in the renderer
- electron-builder → universal DMG, auto-released on every push to `main`

## Project layout

```
.
├── main.js                    # Electron main process: tray, IPC, polling, OCR
├── preload.js                 # contextBridge surface (window.iktahmetrics.*)
├── package.json               # electron + electron-builder
├── src/
│   ├── index.html             # overlay UI
│   ├── renderer.js            # display logic (push-driven from main)
│   ├── styles.css
│   ├── picker.html            # full-screen drag-rectangle region picker
│   ├── picker.js
│   ├── app-picker.html        # "track an app's window" picker
│   └── app-picker.js
├── swift/
│   ├── ocr.swift              # OCR / frontmost / list-windows CLI
│   └── build.sh               # builds universal binary → build/ocr
├── data/
│   └── thresholds.json        # community-sourced XP-level thresholds
├── .github/workflows/
│   └── release.yml            # build + publish DMG on push to main
└── build/
    └── ocr                    # universal binary, packaged into Resources
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

You can test the OCR helper standalone:

```sh
./build/ocr path/to/screenshot.png   # OCR an image
./build/ocr --frontmost              # name and bundle ID of the frontmost app
./build/ocr --list-windows           # all on-screen windows w/ bounds
```

## Usage

IktahMetrics lives in the macOS menu bar — no Dock icon, no floating window
unless you ask for one.

1. Launch the app. `XPS` appears in the menu bar.
2. Click it → choose one of:
   - **Track App Window…** (recommended) — pick `idle_iktah` from the list.
     The capture region follows the game window automatically when you move
     or resize it.
   - **Set Fixed Region…** — drag a rectangle around the activity card if
     you want a tighter capture region with fixed coordinates.
3. **Start** (or <kbd>⌘⇧S</kbd>). The menu bar title now reads e.g.
   `🎣 · L37 · 1.06 xp/s` and updates ~once a second.
4. The menu's first line shows live status (rate · level · % · ETA).
   The second shows the session-best for the current skill.
5. **Show Overlay** toggles the bigger draggable, resizable card. Drag
   anywhere on the card to move it; drag the SE corner to resize. Position
   and size persist across launches.
6. **Quit IktahMetrics** (<kbd>⌘Q</kbd>) exits.

### What the overlay shows

- **Skill + level** (e.g. `🎣 Fishing  L37`) auto-detected from the game UI
- Big bold **XP/sec** rate
- Within-level XP progress and percent (e.g. `651 / 2,478 xp · 26.3%`)
- ETA to next level (e.g. `next level in 28m 11s`)
- Per-skill **session best** XP/sec
- A small status line that surfaces transient errors

When IktahMetrics can't get a fresh OCR sample (game in another Space,
window covered, etc.), it switches to **estimated** mode: the displayed
values are projected forward from the last good sample. Rate turns yellow
with a `~` prefix and the status line says `estimated · game in background`.
The moment a real sample lands, the values snap back to truth.

## XP thresholds (community-sourced)

To compute *within-level* progress, the app needs to know the XP threshold
that started the current level. It learns these from observation: when you
see `Level N · X / T`, it records that level `N+1` requires `T` total XP.

Three-tier resolution at lookup time:

1. **Local observations** — `~/Library/Application Support/IktahMetrics/thresholds.json`
2. **Remote (cached)** — fetched on launch from
   [`data/thresholds.json`](data/thresholds.json) in this repo
3. **Bundled seed table** — shipped with the app

Tray menu → **Share Observed Thresholds…** copies your local-only
observations to the clipboard *and* opens a pre-filled GitHub issue at
this repo, so you can contribute back in one click. Once a threshold lands
on `main`, it propagates to everyone on the next launch.

## Updates

Tray menu → **Check for Updates** queries the latest GitHub release and
shows one of:

- `Update available: vX.Y.Z →` (clicking opens the releases page)
- `Up to date (vCURRENT)`
- `Update check failed (vCURRENT)` — click to retry

Releases are produced automatically by [.github/workflows/release.yml](.github/workflows/release.yml)
on every push to `main`: it bumps the patch version, builds a universal
DMG, and publishes it to GitHub Releases with auto-generated notes.

## State files

All under `~/Library/Application Support/IktahMetrics/`:

- `region.json` — saved capture region (window-tracking or fixed)
- `overlay.json` — overlay visibility + bounds
- `thresholds.json` — your local XP-threshold observations
- `remote-thresholds.json` — cache of the community thresholds file
- `settings.json` — misc settings

## Installing the DMG

Each release ships **two DMGs** — pick the one matching your Mac's CPU:

- `IktahMetrics-X.Y.Z-arm64.dmg` — Apple Silicon (M1 / M2 / M3 / M4)
- `IktahMetrics-X.Y.Z.dmg` — Intel Mac (x64)

Per-arch builds keep each download to ~200MB instead of ~425MB for a
universal build (which would ship both runtimes inside one bundle).

IktahMetrics isn't notarized by Apple (no Developer ID — that's $99/year),
so macOS will warn you on first launch. Two extra steps:

1. **Drag the `.app` to `/Applications`** before launching. Don't run it
   from the mounted DMG — macOS "translocates" apps run from disk images
   to a random temp path, which makes Screen Recording permission grants
   stick to the wrong location.
2. On first launch macOS says *"…cannot be opened because it is from an
   unidentified developer / could be malware"*. **Right-click → Open**
   (or in System Settings → Privacy & Security, click **Open Anyway**).
   Or, from a terminal:
   ```sh
   xattr -dr com.apple.quarantine /Applications/IktahMetrics.app
   ```

The release build is signed in CI. By default, the workflow does **ad-hoc
codesigning** — the signature is derived from the app's contents, so it
stays stable across launches of the same release but **changes between
releases**. macOS TCC will then re-prompt for Screen Recording on every
update.

To make TCC grants persist across updates, store a **self-signed code
signing certificate** in repo secrets — every release then shares an
identity, and TCC remembers your grant across updates.

```sh
bash scripts/make-codesign-cert.sh
# Add the printed CSC_LINK and CSC_KEY_PASSWORD to:
#   github.com/Linesmerrill/IktahMetrics/settings/secrets/actions
```

The cert is self-signed (not from Apple), so the "unidentified developer"
warning still appears once on first install — but **the permission loop
on updates goes away** because TCC matches releases by signing identity,
not by content hash.

## Permissions

Capturing the screen requires **Screen Recording** permission on macOS 10.15+.

- On first capture, macOS prompts: allow IktahMetrics (and re-launch if needed).
- If you skipped the prompt, grant manually:
  **System Settings → Privacy & Security → Screen Recording → enable IktahMetrics**.
- In dev (`npm start`), permission is requested for **Electron** itself
  (or your terminal, depending on how Electron was launched). You may need
  to toggle it off/on once after the first prompt.
- **Permission re-prompts in a loop after an update?** That's TCC
  failing to match the new release's signature against the saved grant
  (typical with ad-hoc-only signing — see [Installing the DMG](#installing-the-dmg)).
  Reset the entry and clear the quarantine bit:
  ```sh
  tccutil reset ScreenCapture com.merrill.iktahmetrics
  xattr -dr com.apple.quarantine /Applications/IktahMetrics.app
  ```
  Then relaunch and grant once more. To avoid this on future updates,
  set up a stored signing certificate as described above.

The overlay window itself is excluded from screen captures
(`NSWindow.sharingType = .none`), so its readout doesn't pollute the OCR
that drives it.

OCR via Vision needs no special permission — it runs in-process.

## Distribution

```sh
npm run dist       # builds build/ocr, then a universal DMG into dist/
npm run pack       # unpacked .app for quick local testing
```

The universal `ocr` binary is packed at `Contents/Resources/ocr` inside
the `.app`; `main.js` resolves the path automatically (`process.resourcesPath`
when packaged, `./build/ocr` in dev). `package.json`'s
`build.mac.x64ArchFiles: "Contents/Resources/ocr"` tells `@electron/universal`
to accept the already-lipo'd helper.

> **Note:** the release pipeline currently does ad-hoc codesigning only
> (`scripts/after-pack.js` runs `codesign --force --deep --sign -` on the
> `.app`). For Gatekeeper-friendly distribution outside your own machine
> you'll want a real Apple Developer ID + notarization. electron-builder
> handles the signing side if you set `CSC_LINK` + `CSC_KEY_PASSWORD`,
> and `notarize` config for notarization.

## Parsing details

- OCR output is one recognized text line per Vision observation.
- Cyrillic homoglyphs (e.g. `х` U+0445) are normalized to Latin before
  parsing — Vision occasionally returns them for pixel-art fonts.
- Rate match is `/([\d.]+)\s*xp\s*\/\s*([\d.]+)\s*seconds/i`. Implausible
  rates (outside `0.01–50 xp/s`) are rejected as OCR misreads.
- Active skill is detected by matching the activity card's `Level N`
  against per-skill levels in the sidebar (each skill has its own level,
  so the active one's level uniquely matches). Falls back to a count +
  orphan heuristic when ambiguous.
- XP progress (`X / Y`) is anchored to a `Level N` line within ±1/+3 lines
  to avoid matching unrelated `X / Y` patterns like inventory `29 / 30`.

## Diagnostics

If something looks wrong, the tray menu has:

- **Reset Tracking** — clears the cached `lastInfo` and session bests.
  Use this when stale state from a previous activity is bleeding through.
- **Reveal Last Capture in Finder** — opens the most recent screen capture.
  Confirm what you actually captured.
- **Save Last OCR Output…** — dumps Vision's recognized text for the last
  tick to a temp file and opens it. The fastest way to see *why* a parse
  failed.

## Troubleshooting

- **`screencapture failed`** → Screen Recording permission not granted yet,
  or the saved region went off-screen (e.g. monitor unplugged). Re-pick.
- **`ocr failed`** → make sure `build/ocr` exists. Re-run `npm run build:ocr`.
- **Wrong rate / stuck on stale value** → save the last OCR output and
  check whether the rate text is in there. Common causes: window-tracking
  bounds are wrong (re-pick), Vision is returning Cyrillic homoglyphs (now
  handled), or the activity changed and a transient frame got cached
  (Reset Tracking).
- **Wrong skill detected** → the sidebar OCR is your friend; if "Level N"
  matches multiple sidebar levels (rare), the count + orphan fallback may
  pick the wrong one. Reset Tracking once a clean OCR sample is captured.
- **Overlay disappears in fullscreen game** → it's set
  `visibleOnFullScreen`, but Steam's exclusive fullscreen on some Macs
  hides all overlays. Switch the game to windowed/borderless.

## Credits

Skill icons are [Font Awesome Free 6](https://fontawesome.com/) glyphs,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
(icons) and [SIL OFL 1.1](https://scripts.sil.org/OFL) (font). They're
rendered as monochrome template PNGs by `scripts/build-skill-icons.js`
so macOS can auto-tint them to the menu bar's foreground color.

## Why a Swift helper instead of Tesseract / a JS OCR lib?

Vision's recognizer ships with macOS, has zero install cost, and handles
Idle Iktah's stylized pixel digits considerably better than Tesseract on
default config. A small Swift CLI keeps the dependency surface tiny and
avoids shipping a 50MB language model.

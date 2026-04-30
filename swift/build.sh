#!/usr/bin/env bash
# Build a universal (arm64 + x86_64) macOS binary for the OCR helper.
# Output: build/ocr (gets copied into the app bundle's Resources by electron-builder).
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="swift/ocr.swift"
OUT_DIR="build"
OUT_BIN="$OUT_DIR/ocr"

mkdir -p "$OUT_DIR"

ARM_BIN="$OUT_DIR/ocr-arm64"
X86_BIN="$OUT_DIR/ocr-x86_64"

echo "Compiling arm64..."
swiftc -O -target arm64-apple-macos11 -framework Vision -framework AppKit \
    -o "$ARM_BIN" "$SRC"

echo "Compiling x86_64..."
swiftc -O -target x86_64-apple-macos10.15 -framework Vision -framework AppKit \
    -o "$X86_BIN" "$SRC"

echo "Lipo into universal binary..."
lipo -create "$ARM_BIN" "$X86_BIN" -output "$OUT_BIN"
chmod +x "$OUT_BIN"

rm -f "$ARM_BIN" "$X86_BIN"

echo "Built $OUT_BIN"
file "$OUT_BIN"

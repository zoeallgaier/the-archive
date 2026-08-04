#!/bin/sh
# Regenerates icons/icon-*.png from icons/icon.svg.
#
# Renders ONCE at 1024 — the SVG's native size — via headless Chrome, then
# downsamples with sips (built into macOS, Lanczos). Per-size Chrome renders
# used to be the method; headless --screenshot does not scale a same-origin
# SVG document to --window-size, it CROPS to it, capturing the top-left
# corner of the full 1024 canvas at whatever smaller size was asked for. For
# 180/192 that corner is blank margin — a "pure white" icon that shipped for
# a while — and 512 caught only a partial corner of the mark. 1024 alone was
# ever correct, because at that size cropping and scaling are the same thing.
# The glyph is two flat-filled polygons with no fine detail, so one crisp
# source rasterised down loses nothing a native re-render would have kept.
set -e
cd "$(dirname "$0")/.."
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --screenshot="icons/icon-1024.png" \
  --window-size="1024,1024" "file://$PWD/icons/icon.svg"
for S in 512 192 180; do
  sips -Z "$S" "icons/icon-1024.png" --out "icons/icon-$S.png" >/dev/null
done

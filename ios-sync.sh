#!/bin/sh
# Mirrors the web assets Capacitor bundles into the iOS app (www/), then syncs.
# Capacitor rejects "." as a webDir, so www/ exists purely as a real subdirectory
# for it to point at. Everything here is generated — edit the sources, not www/.
#
# Run after any html/css/js/seed change, before hitting Run in Xcode.
set -e
cd "$(dirname "$0")"

rm -rf www
mkdir -p www
# manifest.webmanifest is copied because index.html <link>s it. It was missed,
# so every native launch fetched it and got a 404 — harmless, and exactly the
# kind of thing that stays broken for months because nothing visibly fails.
cp index.html manifest.webmanifest www/
cp -R css js icons fonts seed www/

# sw.js is deliberately NOT copied. The native build loads every asset off the
# device already; a service worker there would be a cache in front of a
# filesystem read. index.html only registers it over http(s) anyway.

npx cap sync ios

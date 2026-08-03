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
cp index.html www/
cp -R css js icons fonts seed www/

npx cap sync ios

#!/bin/sh
# Builds "Clyra Location.app" (a background-only helper) next to this script and ad-hoc signs it.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/Clyra Location.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>ai.clyra.location-helper</string>
  <key>CFBundleName</key><string>Clyra</string>
  <key>CFBundleDisplayName</key><string>Clyra</string>
  <key>CFBundleExecutable</key><string>clyra-location</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Clyra Maps uses your location to show where you are and give accurate directions.</string>
  <key>NSLocationUsageDescription</key><string>Clyra Maps uses your location to show where you are and give accurate directions.</string>
</dict></plist>
PLIST
swiftc -O -o "$APP/Contents/MacOS/clyra-location" "$HERE/main.swift" -framework CoreLocation
codesign --force --sign - --timestamp=none "$APP"
echo "built $APP"

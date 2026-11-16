#!/bin/sh
# Builds Notch.app with the Command Line Tools (no Xcode needed) and runs the unit tests.
set -e
cd "$(dirname "$0")"
mkdir -p build
MODULE_CACHE="${NOTCH_MODULE_CACHE:-build/module-cache}"
mkdir -p "$MODULE_CACHE"
echo "== unit tests"
swiftc -module-cache-path "$MODULE_CACHE" -o build/notch-tests Sources/Alarms.swift Sources/NotchMotion.swift Sources/Timers.swift Sources/Weather.swift Sources/Chat.swift Tests/main.swift
./build/notch-tests
echo "== app"
APP="${1:-build/Notch.app}"
mkdir -p "$APP/Contents/MacOS"
swiftc -module-cache-path "$MODULE_CACHE" -O -target "$(uname -m)-apple-macos14.0" -o "$APP/Contents/MacOS/Notch" Sources/*.swift
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.notch</string>
<key>CFBundleName</key><string>Clyra’s Notch</string>
<key>CFBundleDisplayName</key><string>Clyra’s Notch</string>
<key>CFBundleExecutable</key><string>Notch</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.4</string>
<key>CFBundleVersion</key><string>13</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSLocationUsageDescription</key><string>Notch shows the weather where you are.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Notch shows the weather where you are.</string>
<key>NSAppleEventsUsageDescription</key><string>Notch shows what Spotify or Music is playing and controls playback.</string>
<key>NSBluetoothAlwaysUsageDescription</key><string>Notch shows a brief banner when a Bluetooth device connects.</string>
<key>NSAudioCaptureUsageDescription</key><string>Notch can react to the playing app’s audio when Live audio bars is enabled.</string>
<key>NSCalendarsFullAccessUsageDescription</key><string>Notch shows your next calendar event when you add the calendar widget.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>local.notch</string><key>CFBundleURLSchemes</key><array><string>notch</string></array></dict></array>
</dict></plist>
PL
cat > build/entitlements.plist <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.automation.apple-events</key><true/></dict></plist>
PL
ADAPTER_SOURCE="${NOTCH_ADAPTER_SOURCE:-/Applications/Notch.app/Contents}"
if [ ! -f "$ADAPTER_SOURCE/Resources/mediaremote-adapter.pl" ]; then
    ADAPTER_SOURCE="/Applications/boringNotch.app/Contents"
fi
if [ -f "$ADAPTER_SOURCE/Resources/mediaremote-adapter.pl" ] && [ -d "$ADAPTER_SOURCE/Frameworks/MediaRemoteAdapter.framework" ]; then
    mkdir -p "$APP/Contents/Resources" "$APP/Contents/Frameworks"
    ditto "$ADAPTER_SOURCE/Frameworks/MediaRemoteAdapter.framework" "$APP/Contents/Frameworks/MediaRemoteAdapter.framework"
    cp "$ADAPTER_SOURCE/Resources/mediaremote-adapter.pl" "$APP/Contents/Resources/"
    cp MediaRemoteAdapter-LICENSE.txt "$APP/Contents/Resources/"
    codesign --force --sign - "$APP/Contents/Frameworks/MediaRemoteAdapter.framework"
else
    echo "MediaRemoteAdapter unavailable. General system playback detection requires the framework and launcher." >&2
fi
codesign --force --sign - --entitlements build/entitlements.plist "$APP"
codesign --verify --strict "$APP"
echo built

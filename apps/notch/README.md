# Notch 1.4 source

Start at `Sources/main.swift` for the panel and its frame interpolation, `Sources/Model.swift` for navigation and activity priorities, and `Sources/Views.swift` for the shared SwiftUI screens. Bluetooth, AirDrop, audio metering, alarms, and chat providers have separate files under `Sources`. `Tests/main.swift` runs during the build.

## macOS build

Run `./build.sh build/notch-1.4/Notch.app` with Apple's Command Line Tools installed. The script targets your Mac's native architecture and copies the BSD-licensed media adapter from the installed Notch app or Boring Notch. Use `NOTCH_ADAPTER_SOURCE` to point to a compatible app's `Contents` directory if necessary. The build should print the test result and `built` before you replace your existing app. Quit the previous copy, keep a backup, copy the new bundle to Applications, and open it. In System Settings, verify it is still in General → Login Items & Extensions.

## Mac smoke tests

1. Record the top of the screen at 60 fps. Hover, release, reverse a transition, and switch Home → Chat → Home. Confirm that the silhouette stays on the top pixel row. Repeat with Reduce Motion enabled.
2. Click Weather in Settings and type a city while a different application is active. Select a result, then try typing in Chat, Quick Note, the timer label, and a provider's key field.
3. Run the stopwatch and compare elapsed seconds with an independent clock. Pause and resume. Open and release while it is running. Set a silent alarm for the next minute, and verify it expands without audio.
4. Play a track from a browser and then Spotify. Verify the center slot, timer at the right, and a second activity at the left. Scrub. Optionally enable Live audio bars and grant system audio capture; confirm the bars settle during silence or when the player is paused.
5. Connect AirPods. Verify the banner and available battery fields, then open Bluetooth, search nearby, and reconnect an already paired test device.
6. From Finder, drag two disposable files into the collapsed notch. Check that the blue target expands, both filenames appear, and the panel stays open as you move the pointer to Choose Recipient. The AirDrop page also has a Choose Files button. Cancel Apple's picker and confirm the files remain available for retry. Send to a second AirDrop-capable Apple device and confirm completion clears the queue. The transfer indicator is indeterminate because Apple's sharing API reports no byte counts.

## Scope

Notch reads media metadata that players publish to macOS. The optional audio meter reads samples from the active player's app and does not store recordings. Bluetooth battery readings are device- and OS-dependent. Pairing uses System Settings. Silent alarms require Notch to be running and are not wake timers.

Glance is a separate app. The Settings shortcut opens its own enrollment and Face Lab workflow. Glance's documented unlock uses password entry at the lock screen and cannot replace Touch ID or password authentication in other apps.

Build 13 passed 50 native checks on the Intel Mac. Expanded pages share one native window while the black silhouette animates from the top edge. The geometry suite rasterizes 1,694 samples across seven transitions at 1× and 2× and checks that the top remains fully opaque. The pre-fix recording was reviewed frame by frame.

The AirDrop card and native recipient picker were previously verified through Choose Files. An actual file drag or an explicit click can open AirDrop. Finder drag delivery and a transfer to a second device still need a live check.

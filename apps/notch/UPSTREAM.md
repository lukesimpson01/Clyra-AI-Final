# Notch design and media references

- Glance, MIT, commit `b97f521397ec1197ba17768ba797cae1e628848d`. Inspected Face Lab, enrollment and lock-screen password injection. Notch opens the standalone app for setup and testing.

- Boring Notch, GPL-3.0, commit b7611bbf32c627a3427408fc142486900d71a23f. Reviewed `boringNotch/ContentView.swift`, `boringNotch/components/Notch/NotchShape.swift`, and `boringNotch/sizing/matters.swift` for the shape and spring settings. The local panel and geometry implementation use the existing Notch SwiftUI/AppKit structure.
- NotchNook Pro workspace editor and Atoll live activities informed the widget layout and interaction design.
- The build can bundle the MediaRemoteAdapter framework and launcher from the existing Boring Notch installation. MediaRemoteAdapter is a separate BSD-3-Clause project, and its license is included in the application bundle.

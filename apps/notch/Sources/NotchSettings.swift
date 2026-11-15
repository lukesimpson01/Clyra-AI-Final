import AppKit
import SwiftUI

struct GlanceSettings: View {
    @State private var feedback = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Label("Glance Face Unlock", systemImage: "faceid")
                Spacer()
                Button("Set Up / Test") {
                    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.jonathan.glance") {
                        NSWorkspace.shared.openApplication(at: url, configuration: .init())
                        feedback = "In Glance, open Settings → About and click the app icon five times to reveal Face Lab."
                    } else if let url = URL(string: "https://github.com/jonnyoo/glance") {
                        NSWorkspace.shared.open(url)
                        feedback = "Install Glance to enroll faces and use Face Lab."
                    }
                }.buttonStyle(Pill())
            }
            if !feedback.isEmpty { Text(feedback).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

struct LiveAudioSettings: View {
    @ObservedObject var meter: AudioMeter
    @Binding var enabled: Bool
    var apply: () -> Void
    var body: some View {
        Toggle("Live audio bars", isOn: $enabled).onChange(of: enabled) { _, _ in apply() }
        if enabled && !meter.status.isEmpty { Text(meter.status).font(.caption).foregroundStyle(.secondary) }
    }
}

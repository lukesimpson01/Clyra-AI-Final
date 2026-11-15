import AppKit
import SwiftUI

final class NotchAirDrop: NSObject, ObservableObject, NSSharingServiceDelegate {
    enum Phase { case idle, choosingRecipient, sending }

    @Published private(set) var files: [URL] = []
    @Published private(set) var status = ""
    @Published private(set) var phase = Phase.idle
    @Published private var choosingFiles = false
    var isBusy: Bool { phase != .idle || choosingFiles }
    weak var sourceWindow: NSWindow?
    private var service: NSSharingService?

    @discardableResult
    func add(_ urls: [URL]) -> Bool {
        let local = urls.filter(\.isFileURL)
        guard !isBusy, !local.isEmpty else { return false }
        var known = Set(files)
        files += local.filter { known.insert($0).inserted }
        status = ""
        return true
    }

    func clear() { if !isBusy { files.removeAll(); status = "" } }

    func chooseFiles() {
        guard !isBusy else { return }
        choosingFiles = true
        let picker = NSOpenPanel()
        picker.allowsMultipleSelection = true
        picker.canChooseDirectories = true
        picker.begin { [weak self] result in
            guard let self else { return }
            self.choosingFiles = false
            if result == .OK { self.add(picker.urls) }
        }
    }

    func share() {
        guard !files.isEmpty, !isBusy else { return }
        let items = files.map { $0 as NSURL }
        guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: items) else {
            status = "AirDrop is unavailable."
            return
        }
        self.service = service
        service.delegate = self
        phase = .choosingRecipient
        status = "Choose a recipient in AirDrop"
        service.perform(withItems: items)
    }

    func sharingService(_ sharingService: NSSharingService, sourceWindowForShareItems items: [Any],
                        sharingContentScope: UnsafeMutablePointer<NSSharingService.SharingContentScope>) -> NSWindow? {
        sourceWindow
    }

    func sharingService(_ sharingService: NSSharingService, willShareItems items: [Any]) {
        guard service === sharingService else { return }
        phase = .sending
        status = "Sending with AirDrop…"
    }
    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
        guard service === sharingService else { return }
        phase = .idle
        status = "Sent with AirDrop"
        files.removeAll()
        service = nil
    }
    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        guard service === sharingService else { return }
        phase = .idle
        let failure = error as NSError
        status = failure.domain == NSCocoaErrorDomain && failure.code == NSUserCancelledError ? "AirDrop cancelled" : "AirDrop couldn’t send these files."
        service = nil
    }
}

struct NotchAirDropView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack {
            Header(model: model, title: "AirDrop")
            AirDropZone(transfer: model.airDrop, targeted: model.airdropTargeted, reduceMotion: model.reduceMotion)
        }
    }
}

private struct AirDropZone: View {
    @ObservedObject var transfer: NotchAirDrop
    let targeted: Bool
    let reduceMotion: Bool
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "doc")
                .font(.system(size: 27, weight: .medium))
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
            if !transfer.files.isEmpty {
                Text(transfer.files.map(\.lastPathComponent).joined(separator: ", "))
                    .multilineTextAlignment(.center).lineLimit(3)
                HStack {
                    Button("Choose Recipient") { transfer.share() }.buttonStyle(Pill(prominent: true)).disabled(transfer.isBusy)
                    Button("Clear") { transfer.clear() }.buttonStyle(Pill()).disabled(transfer.isBusy)
                }
            } else {
                Text("Drop files here").font(.system(size: 15, weight: .medium))
                Button("Choose Files…") { transfer.chooseFiles() }.buttonStyle(Pill()).disabled(transfer.isBusy)
            }
            if transfer.phase == .sending {
                ProgressView().progressViewStyle(.linear).tint(.blue).accessibilityLabel("AirDrop transfer in progress")
            }
            if !transfer.status.isEmpty { Text(transfer.status).foregroundStyle(.secondary) }
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black, in: RoundedRectangle(cornerRadius: 17))
        .overlay {
            RoundedRectangle(cornerRadius: 17).inset(by: 1)
                .stroke(.blue.opacity(targeted ? 1 : 0.75), style: StrokeStyle(lineWidth: targeted ? 2 : 1.5, lineCap: .round, dash: [1, 4]))
                .allowsHitTesting(false)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: targeted)
    }
}

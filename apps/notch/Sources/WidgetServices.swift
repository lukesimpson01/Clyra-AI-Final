import AppKit
import EventKit
import IOKit.ps
import Quartz

final class WidgetCalendar: ObservableObject {
    private let store = EKEventStore()
    @Published private(set) var event: EKEvent?
    @Published private(set) var authorized = false
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in self?.refresh() }
    }

    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    func request() {
        store.requestFullAccessToEvents { [weak self] _, _ in DispatchQueue.main.async { self?.refresh() } }
    }

    func refresh() {
        authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess
        guard authorized else { event = nil; return }
        let now = Date()
        let predicate = store.predicateForEvents(withStart: now, end: now.addingTimeInterval(7 * 86400), calendars: nil)
        event = store.events(matching: predicate).filter { !$0.isAllDay && $0.endDate > now }.min { $0.startDate < $1.startDate }
    }

    var meeting: URL? {
        guard let event else { return nil }
        let hosts = ["zoom.us", "meet.google.com", "teams.microsoft.com", "webex.com", "whereby.com", "meet.jit.si"]
        let text = [event.location, event.notes].compactMap { $0 }.joined(separator: "\n")
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let links = detector?.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap(\.url) ?? []
        return ([event.url].compactMap { $0 } + links).first { url in
            guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
            return hosts.contains { host == $0 || host.hasSuffix("." + $0) }
        }
    }
}

func macBatteryStatus() -> String? {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
    for source in sources {
        guard let values = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
              let charge = values[kIOPSCurrentCapacityKey] as? Int,
              let max = values[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
        let charging = values[kIOPSIsChargingKey] as? Bool == true
        let power = values[kIOPSPowerSourceStateKey] as? String == kIOPSACPowerValue
        return "\(charge * 100 / max)% · \(charging ? "Charging" : power ? "Plugged in" : "On battery")"
    }
    return nil
}

final class WidgetQuickLook: NSObject, QLPreviewPanelDataSource {
    static let shared = WidgetQuickLook()
    private var url: URL?
    func show(_ url: URL) {
        self.url = url
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }
    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int { url == nil ? 0 : 1 }
    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! { url.map { $0 as NSURL } }
}

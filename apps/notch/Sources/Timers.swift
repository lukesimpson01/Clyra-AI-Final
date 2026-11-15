import Foundation

// Timer engine. Time is measured from wall-clock end dates, never from ticks, so it stays
// correct across sleep, app relaunch and a closed panel.

struct NotchTimer: Codable, Identifiable, Equatable {
    enum Status: String, Codable { case running, paused, done }
    var id = UUID()
    var label: String
    var duration: TimeInterval
    var status: Status
    var endsAt: Date
    var remaining: TimeInterval

    func remaining(at now: Date) -> TimeInterval {
        status == .running ? max(0, endsAt.timeIntervalSince(now)) : remaining
    }
}

final class TimerEngine {
    private(set) var timers: [NotchTimer] = []
    var now: () -> Date = Date.init
    var onChange: (() -> Void)?
    var onFinish: ((NotchTimer) -> Void)?
    private let storeKey: String
    private let store: UserDefaults

    init(store: UserDefaults = .standard, key: String = "timers") {
        self.store = store
        storeKey = key
        if let data = store.data(forKey: key), let saved = try? JSONDecoder().decode([NotchTimer].self, from: data) {
            timers = saved
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(timers) { store.set(data, forKey: storeKey) }
        onChange?()
    }

    @discardableResult
    func start(seconds: TimeInterval, label: String? = nil) -> NotchTimer {
        let d = max(1, seconds.rounded())
        let t = NotchTimer(label: label?.isEmpty == false ? label! : TimerEngine.describe(d),
                           duration: d, status: .running, endsAt: now().addingTimeInterval(d), remaining: d)
        timers.append(t)
        save()
        return t
    }

    func pause(_ id: UUID) {
        guard let i = timers.firstIndex(where: { $0.id == id }), timers[i].status == .running else { return }
        timers[i].remaining = timers[i].remaining(at: now())
        timers[i].status = .paused
        save()
    }

    func resume(_ id: UUID) {
        guard let i = timers.firstIndex(where: { $0.id == id }), timers[i].status == .paused else { return }
        timers[i].endsAt = now().addingTimeInterval(timers[i].remaining)
        timers[i].status = .running
        save()
    }

    func restart(_ id: UUID) {
        guard let i = timers.firstIndex(where: { $0.id == id }) else { return }
        timers[i].remaining = timers[i].duration
        timers[i].endsAt = now().addingTimeInterval(timers[i].duration)
        timers[i].status = .running
        save()
    }

    func cancel(_ id: UUID) {
        timers.removeAll { $0.id == id }
        save()
    }

    /// Marks finished timers done and reports each one once. Call on a timer and on wake.
    func reconcile() {
        var changed = false
        for i in timers.indices where timers[i].status == .running && timers[i].remaining(at: now()) <= 0 {
            timers[i].status = .done
            timers[i].remaining = 0
            changed = true
            onFinish?(timers[i])
        }
        if changed { save() }
    }

    var running: [NotchTimer] { timers.filter { $0.status == .running } }

    /// The running timer that ends first, for the collapsed indicator.
    var soonest: NotchTimer? { running.min { $0.endsAt < $1.endsAt } }

    static func describe(_ s: TimeInterval) -> String {
        let s = Int(s)
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        if h > 0 { return m > 0 ? "\(h) hr \(m) min" : "\(h) hr" }
        if m > 0 { return sec > 0 ? "\(m) min \(sec) s" : "\(m) min" }
        return "\(sec) s"
    }

    static func clock(_ s: TimeInterval) -> String {
        let s = Int(s.rounded(.up))
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    /// "set a timer for 20 minutes", "timer 1 hour 30 min", "5 min timer" → seconds.
    static func parseRequest(_ text: String) -> (seconds: TimeInterval, label: String?)? {
        let t = text.lowercased()
        guard t.contains("timer") else { return nil }
        var total = 0.0
        let units: [(String, Double)] = [("h(?:ours?|rs?)?\\b", 3600), ("m(?:in(?:ute)?s?)?\\b", 60), ("s(?:ec(?:ond)?s?)?\\b", 1)]
        for (unit, mult) in units {
            if let re = try? NSRegularExpression(pattern: "(\\d+(?:\\.\\d+)?)\\s*" + unit) {
                for m in re.matches(in: t, range: NSRange(t.startIndex..., in: t)) {
                    if let r = Range(m.range(at: 1), in: t), let v = Double(t[r]) { total += v * mult }
                }
            }
        }
        guard total > 0 else { return nil }
        var label: String?
        if let re = try? NSRegularExpression(pattern: "\\b(?:for|called|named)\\s+(?:the\\s+)?([a-z][a-z ]{1,24}?)\\s*$"),
           let m = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)), let r = Range(m.range(at: 1), in: t) {
            let candidate = String(t[r]).trimmingCharacters(in: .whitespaces)
            if !candidate.contains("min") && !candidate.contains("hour") && !candidate.contains("sec") { label = candidate.capitalized }
        }
        return (total, label)
    }
}

final class Stopwatch {
    private(set) var startedAt: TimeInterval?
    private(set) var accumulated: TimeInterval = 0
    var now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    var isRunning: Bool { startedAt != nil }
    var elapsed: TimeInterval { accumulated + (startedAt.map { max(0, now() - $0) } ?? 0) }
    func start() { if startedAt == nil { startedAt = now() } }
    func stop() { if let s = startedAt { accumulated += max(0, now() - s); startedAt = nil } }
    func reset() { startedAt = nil; accumulated = 0 }
}

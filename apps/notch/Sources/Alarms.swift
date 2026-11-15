import Foundation

struct NotchAlarm: Codable, Identifiable, Equatable {
    var id = UUID()
    var hour: Int
    var minute: Int
    var weekdays: Set<Int>
    var enabled = true

    var label: String { String(format: "%d:%02d %@", (hour + 11) % 12 + 1, minute, hour < 12 ? "AM" : "PM") }

    func next(after date: Date, calendar: Calendar = .current) -> Date? {
        guard enabled else { return nil }
        let days: [Int?] = weekdays.isEmpty ? [nil] : weekdays.map(Optional.some)
        return days.compactMap { day in
            calendar.nextDate(after: date, matching: DateComponents(hour: hour, minute: minute, second: 0, weekday: day),
                              matchingPolicy: .nextTime, repeatedTimePolicy: .first)
        }.min()
    }
}

final class AlarmEngine {
    private(set) var alarms: [NotchAlarm]
    private(set) var upcoming: (alarm: NotchAlarm, date: Date)?
    private var timer: Timer?
    var onChange: (() -> Void)?
    var onFire: ((NotchAlarm) -> Void)?

    init() {
        alarms = UserDefaults.standard.data(forKey: "notchAlarms").flatMap { try? JSONDecoder().decode([NotchAlarm].self, from: $0) } ?? []
    }

    func add(_ alarm: NotchAlarm) { alarms.append(alarm); save() }
    func remove(_ id: UUID) { alarms.removeAll { $0.id == id }; save() }
    func toggle(_ id: UUID) {
        guard let index = alarms.firstIndex(where: { $0.id == id }) else { return }
        alarms[index].enabled.toggle()
        save()
    }

    func schedule() {
        timer?.invalidate()
        let now = Date()
        upcoming = alarms.compactMap { alarm in alarm.next(after: now).map { (alarm, $0) } }.min { $0.1 < $1.1 }
        guard let upcoming else { return }
        let timer = Timer(fire: upcoming.date, interval: 0, repeats: false) { [weak self] _ in self?.check() }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func check() {
        let now = Date()
        guard let deadline = upcoming?.date, deadline <= now else { schedule(); return }
        let due = alarms.filter { $0.next(after: deadline.addingTimeInterval(-1)) == deadline }
        for alarm in due {
            if alarm.weekdays.isEmpty, let index = alarms.firstIndex(where: { $0.id == alarm.id }) { alarms[index].enabled = false }
        }
        save()
        if now.timeIntervalSince(deadline) < 300, let alarm = due.first { onFire?(alarm) }
    }

    private func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(alarms), forKey: "notchAlarms")
        schedule()
        onChange?()
    }
}

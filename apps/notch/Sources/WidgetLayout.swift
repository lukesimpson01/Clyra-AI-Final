import Foundation

enum WidgetKind: String, Codable, CaseIterable, Identifiable {
    case timer, stopwatch, weather, music, calendar, devices, note, shelf
    var id: String { rawValue }
    var title: String {
        switch self {
        case .music: return "Now Playing"
        case .devices: return "Bluetooth & Battery"
        case .note: return "Quick Note"
        case .shelf: return "File Shelf"
        default: return rawValue.capitalized
        }
    }
    var icon: String {
        switch self {
        case .weather: return "cloud.sun"
        case .music: return "music.note"
        case .devices: return "battery.75percent"
        case .note: return "note.text"
        case .shelf: return "tray"
        default: return rawValue
        }
    }
    var preview: String {
        switch self {
        case .timer: return "Countdown and controls"
        case .stopwatch: return "Live elapsed time"
        case .weather: return "Local conditions and forecast"
        case .music: return "Track, artwork and playback"
        case .calendar: return "Next event and meeting link"
        case .devices: return "Connected devices and power"
        case .note: return "Autosaved text"
        case .shelf: return "Drop files and preview them"
        }
    }
}

struct WidgetPlacement: Codable, Identifiable {
    var kind: WidgetKind
    var wide = false
    var id: WidgetKind { kind }

    static func read(_ data: Data) -> [Self] {
        if let stored = try? JSONDecoder().decode([Self].self, from: data) {
            var seen = Set<WidgetKind>()
            return stored.filter { seen.insert($0.kind).inserted }
        }
        let defaults = UserDefaults.standard
        return [WidgetKind.timer, .stopwatch, .weather, .music].filter {
            defaults.object(forKey: "widget" + $0.rawValue.capitalized) as? Bool ?? true
        }.map { Self(kind: $0) }
    }

    static func rows(_ placements: [Self]) -> [[Self]] {
        var rows: [[Self]] = []
        for placement in placements {
            if !placement.wide, let row = rows.last, row.count == 1, !row[0].wide {
                rows[rows.count - 1].append(placement)
            } else {
                rows.append([placement])
            }
        }
        return rows
    }
}

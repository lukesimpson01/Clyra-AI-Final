import SwiftUI

struct TimeWheel: View {
    let unit: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    @State private var origin: Int?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(range, id: \.self) { number in
                    Button {
                        value = number
                    } label: {
                        Text(number == value ? "\(number) \(unit)" : "\(number)")
                            .font(.system(size: 15).monospacedDigit()).foregroundStyle(number == value ? .white : .secondary)
                            .frame(maxWidth: .infinity).frame(height: 28).contentShape(Rectangle())
                    }.buttonStyle(.plain).id(number)
                }
            }.scrollTargetLayout()
        }
        .contentMargins(.vertical, 42, for: .scrollContent)
        .scrollPosition(id: Binding<Int?>(get: { value }, set: { if origin == nil, let next = $0 { value = next } }), anchor: .center)
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
        .frame(height: 112)
        .background { RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.09)).frame(height: 28) }
        .mask(LinearGradient(colors: [.clear, .black, .black, .clear], startPoint: .top, endPoint: .bottom))
        .simultaneousGesture(DragGesture(minimumDistance: 6, coordinateSpace: .global).onChanged { drag in
            if origin == nil { origin = value }
            let steps = Int((drag.translation.height / 28).rounded())
            value = min(range.upperBound, max(range.lowerBound, (origin ?? value) - steps))
        }.onEnded { _ in origin = nil })
        .accessibilityLabel(unit)
        .accessibilityValue(String(value))
        .accessibilityAdjustableAction {
            if $0 == .increment { value = min(range.upperBound, value + 1) }
            if $0 == .decrement { value = max(range.lowerBound, value - 1) }
        }
    }
}

struct AlarmView: View {
    @ObservedObject var model: NotchModel
    @State private var hour = 7
    @State private var minute = 0
    @State private var pm = false
    @State private var nextPage = false
    @State private var days = Set<Int>()

    var body: some View {
        VStack(spacing: 10) {
            Header(model: model, title: "Alarms")
            if let alarm = model.ringingAlarm {
                Spacer()
                Label(alarm.label, systemImage: "alarm.fill").font(.system(size: 42, weight: .light).monospacedDigit()).foregroundStyle(.orange)
                Button("Dismiss") { model.dismissAlarm() }.buttonStyle(Pill(prominent: true))
                Spacer()
            } else if nextPage {
                Text("Repeat on").font(.headline)
                HStack(spacing: 5) {
                    ForEach(1...7, id: \.self) { day in
                        Button(Calendar.current.shortWeekdaySymbols[day - 1]) {
                            if days.contains(day) { days.remove(day) } else { days.insert(day) }
                        }.buttonStyle(Pill(prominent: days.contains(day)))
                    }
                }
                Text(days.isEmpty ? "Once, at the next matching time" : "Repeats on the selected days").foregroundStyle(.secondary)
                HStack {
                    Button("Back") { nextPage = false }.buttonStyle(Pill())
                    Button("Save alarm") {
                        model.alarms.add(NotchAlarm(hour: hour % 12 + (pm ? 12 : 0), minute: minute, weekdays: days))
                        nextPage = false
                        days.removeAll()
                    }.buttonStyle(Pill(prominent: true))
                }
            } else {
                HStack(spacing: 10) {
                    TimeWheel(unit: "hr", value: $hour, range: 1...12)
                    TimeWheel(unit: "min", value: $minute, range: 0...59)
                    Picker("Period", selection: $pm) { Text("AM").tag(false); Text("PM").tag(true) }
                        .labelsHidden().pickerStyle(.segmented).frame(width: 85)
                }.frame(maxWidth: 285)
                Button("Next") { nextPage = true }.buttonStyle(Pill(prominent: true))
                ScrollView {
                    ForEach(model.alarms.alarms) { alarm in
                        HStack {
                            Text(alarm.label).monospacedDigit()
                            Spacer()
                            Toggle("Enabled", isOn: Binding(get: { alarm.enabled }, set: { _ in model.alarms.toggle(alarm.id) }))
                                .labelsHidden().toggleStyle(.switch).controlSize(.mini)
                            IconButton(symbol: "xmark", size: 10, label: "Remove alarm \(alarm.label)") { model.alarms.remove(alarm.id) }
                        }
                    }
                }.scrollIndicators(.hidden)
            }
        }
    }
}

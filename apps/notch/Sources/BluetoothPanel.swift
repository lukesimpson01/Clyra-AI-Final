import AppKit
import IOBluetooth
import SwiftUI

func deviceSymbol(_ name: String) -> String {
    if name.localizedCaseInsensitiveContains("AirPods") { return "airpods" }
    if name.localizedCaseInsensitiveContains("iPhone") { return "iphone" }
    if name.localizedCaseInsensitiveContains("keyboard") { return "keyboard" }
    if name.localizedCaseInsensitiveContains("mouse") { return "computermouse" }
    return "headphones"
}

struct BluetoothBattery {
    var general: Int?
    var left: Int?
    var right: Int?
    var chargingCase: Int?
    var ring: Int? { [left, right].compactMap { $0 }.min() ?? general ?? chargingCase }

    static func read(_ values: [String: Any]) -> Self {
        func value(_ suffix: String) -> Int? {
            guard let object = values["device_batteryLevel" + suffix] else { return nil }
            let raw = String(describing: object).trimmingCharacters(in: CharacterSet(charactersIn: " %"))
            guard let n = Int(raw), (0...100).contains(n) else { return nil }
            return n
        }
        return Self(general: value(""), left: value("Left"), right: value("Right"), chargingCase: value("Case"))
    }
}

final class BluetoothPanelModel: NSObject, ObservableObject, IOBluetoothDeviceInquiryDelegate {
    struct Device: Identifiable {
        let id: String
        let name: String
        let connected: Bool
        let paired: Bool
        let native: IOBluetoothDevice
    }
    @Published private(set) var devices: [Device] = []
    @Published private(set) var battery: [String: BluetoothBattery] = [:]
    @Published private(set) var scanning = false
    @Published private(set) var status = ""
    @Published private(set) var busy = Set<String>()
    private var inquiry: IOBluetoothDeviceInquiry?
    private var discovered: [IOBluetoothDevice] = []
    private var snapshotRunning = false
    private var rerunSnapshot = false
    private let queue = DispatchQueue(label: "notch.bluetooth", qos: .utility)

    private func rebuild() {
        let paired = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []
        var seen = Set<String>()
        devices = (paired + discovered).compactMap { device in
            guard let address = device.addressString, seen.insert(address).inserted else { return nil }
            return Device(id: address, name: (scanning && !device.isPaired() ? nil : device.name) ?? address, connected: device.isConnected(),
                          paired: device.isPaired(), native: device)
        }.sorted { $0.connected != $1.connected ? $0.connected : $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func refresh() {
        rebuild()
        if snapshotRunning { rerunSnapshot = true; return }
        snapshotRunning = true
        queue.async { [weak self] in
            let process = Process()
            let output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/system_profiler")
            process.arguments = ["SPBluetoothDataType", "-json", "-timeout", "5"]
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            var readings: [String: BluetoothBattery]?
            if (try? process.run()) != nil {
                let bytes = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                if process.terminationStatus == 0, let json = try? JSONSerialization.jsonObject(with: bytes) {
                    var found: [String: BluetoothBattery] = [:]
                    Self.walk(json, into: &found)
                    readings = found
                }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                if let readings { self.battery = readings }
                self.snapshotRunning = false
                if self.rerunSnapshot { self.rerunSnapshot = false; self.refresh() }
            }
        }
    }

    private static func walk(_ node: Any, into readings: inout [String: BluetoothBattery]) {
        if let array = node as? [Any] { for item in array { walk(item, into: &readings) } }
        if let dict = node as? [String: Any] {
            for (name, item) in dict {
                if let fields = item as? [String: Any] {
                    let reading = BluetoothBattery.read(fields)
                    if reading.ring != nil {
                        readings[name] = reading
                        if let address = fields["device_address"] as? String { readings[normalized(address)] = reading }
                    }
                }
                walk(item, into: &readings)
            }
        }
    }

    private static func normalized(_ address: String) -> String {
        address.lowercased().filter { $0.isHexDigit }
    }

    func reading(for device: Device) -> BluetoothBattery? { battery[Self.normalized(device.id)] ?? battery[device.name] }

    func scan() {
        if scanning { _ = inquiry?.stop(); return }
        let scan: IOBluetoothDeviceInquiry? = IOBluetoothDeviceInquiry(delegate: self)
        scan?.inquiryLength = 7
        scan?.updateNewDeviceNames = false
        guard scan?.start() == 0 else { status = "Bluetooth search couldn’t start."; return }
        inquiry = scan
        discovered.removeAll()
        scanning = true
        status = "Looking for nearby Bluetooth devices…"
    }

    func deviceInquiryDeviceFound(_ sender: IOBluetoothDeviceInquiry!, device: IOBluetoothDevice!) {
        guard let device else { return }
        DispatchQueue.main.async { [weak self] in self?.discovered.append(device); self?.rebuild() }
    }

    func deviceInquiryComplete(_ sender: IOBluetoothDeviceInquiry!, error: IOReturn, aborted: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.inquiry = nil
            self?.scanning = false
            self?.status = error == 0 || aborted ? "" : "Bluetooth search failed (\(error))."
            self?.rebuild()
        }
    }

    func toggle(_ device: Device) {
        guard device.paired, busy.insert(device.id).inserted else { return }
        status = device.connected ? "Disconnecting…" : "Connecting…"
        queue.async { [weak self] in
            let result = device.connected ? device.native.closeConnection() : device.native.openConnection()
            DispatchQueue.main.async {
                guard let self else { return }
                self.busy.remove(device.id)
                self.status = result == 0 ? "" : "Bluetooth couldn’t change this connection (\(result))."
                self.refresh()
            }
        }
    }
}

struct BatteryRing: View {
    let percent: Int
    private var color: Color { percent <= 15 ? .red : percent <= 35 ? .yellow : .green }
    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.24), lineWidth: 2)
            Circle().trim(from: 0, to: Double(percent) / 100).stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round)).rotationEffect(.degrees(-90))
        }.frame(width: 15, height: 15).accessibilityLabel("Battery \(percent) percent")
    }
}

struct BluetoothView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(spacing: 9) {
            Header(model: model, title: "Bluetooth")
            BluetoothDeviceList(devices: model.bluetoothPanel, highlighted: model.openBluetoothDevice, model: model)
        }.onAppear { model.bluetoothPanel.refresh() }
    }
}

private struct BluetoothDeviceList: View {
    @ObservedObject var devices: BluetoothPanelModel
    let highlighted: String?
    let model: NotchModel
    @State private var query = ""
    @FocusState private var focused: Bool
    var body: some View {
        HStack {
            TextField("Filter devices", text: $query).textFieldStyle(.roundedBorder).focused($focused)
                .onChange(of: focused) { _, value in model.chatFocused = value }
            Button(devices.scanning ? "Stop search" : "Search nearby") { devices.scan() }.buttonStyle(Pill())
        }
        ScrollView {
            VStack(spacing: 7) {
                ForEach(devices.devices.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { device in
                    HStack(spacing: 10) {
                        Image(systemName: deviceSymbol(device.name)).font(.system(size: 21)).frame(width: 28)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(device.name).lineLimit(1)
                            Text(device.connected ? "Connected" : device.paired ? "Paired" : "Nearby").font(.caption).foregroundStyle(.secondary)
                            if device.connected, let battery = devices.reading(for: device) { batteryDetails(battery) }
                        }
                        Spacer()
                        if device.connected, let level = devices.reading(for: device)?.ring { BatteryRing(percent: level) }
                        if device.paired {
                            Button(device.connected ? "Disconnect" : "Connect") { devices.toggle(device) }
                                .buttonStyle(Pill()).disabled(devices.busy.contains(device.id))
                        } else {
                            Button("Pair in Settings") {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.BluetoothSettings") { NSWorkspace.shared.open(url) }
                            }.buttonStyle(Pill())
                        }
                    }.padding(8).background(.white.opacity(device.name == highlighted ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 9))
                }
            }
        }
        if !devices.status.isEmpty { Text(devices.status).font(.caption).foregroundStyle(.secondary) }
    }

    private func batteryDetails(_ battery: BluetoothBattery) -> some View {
        let components: [(String, Int?)] = [("L", battery.left), ("R", battery.right), ("Case", battery.chargingCase)]
        let known = components.compactMap { label, value in value.map { (label, $0) } }
        let readings = known.isEmpty ? battery.general.map { [("", $0)] } ?? [] : known
        return HStack(spacing: 7) {
            ForEach(readings.indices, id: \.self) { i in
                let (label, value) = readings[i]
                Label(label.isEmpty ? "\(value)%" : "\(label) \(value)%", systemImage: batteryIcon(value))
                    .foregroundStyle(value <= 15 ? Color.red : value <= 35 ? .yellow : .secondary)
            }
        }.font(.caption).lineLimit(1)
    }

    private func batteryIcon(_ value: Int) -> String {
        switch value {
        case 0...10: "battery.0percent"
        case 11...35: "battery.25percent"
        case 36...60: "battery.50percent"
        case 61...85: "battery.75percent"
        default: "battery.100percent"
        }
    }
}

import CoreAudio
import Foundation
import IOBluetooth

final class BluetoothConnections: NSObject {
    var onConnect: ((String) -> Void)?
    private var token: IOBluetoothUserNotification?
    private var connectedNames: [String] = []
    private let queue = DispatchQueue(label: "notch.bluetooth.connections", qos: .utility)

    override init() {
        super.init()
        queue.async { [weak self] in
            guard let self else { return }
            self.refresh()
            self.token = IOBluetoothDevice.register(forConnectNotifications: self, selector: #selector(connected(_:device:)))
        }
    }

    deinit { token?.unregister() }

    func names(airPods: String?) -> [String] {
        var names = connectedNames
        if let airPods, !names.contains(airPods) { names.append(airPods) }
        return Array(Set(names)).sorted()
    }

    @objc private func connected(_ notification: IOBluetoothUserNotification, device: IOBluetoothDevice) {
        let name = device.name ?? "Bluetooth device"
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if !self.connectedNames.contains(name) { self.connectedNames.append(name) }
            self.onConnect?(name)
        }
    }

    func refresh() {
        queue.async { [weak self] in
            let names = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? [])
                .filter { $0.isConnected() }.compactMap(\.name)
            DispatchQueue.main.async { [weak self] in self?.connectedNames = names }
        }
    }
}

/// Watches Core Audio's connected Bluetooth output devices without polling.
final class AirPodsMonitor {
    private let system = AudioObjectID(kAudioObjectSystemObject)
    private var listener: AudioObjectPropertyListenerBlock?
    private(set) var name: String?
    var onChange: (() -> Void)?

    init() {
        let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.refresh() }
        var address = Self.address(kAudioHardwarePropertyDevices)
        if AudioObjectAddPropertyListenerBlock(system, &address, .main, listener) == noErr {
            self.listener = listener
        }
        refresh()
    }

    deinit {
        guard let listener else { return }
        var address = Self.address(kAudioHardwarePropertyDevices)
        AudioObjectRemovePropertyListenerBlock(system, &address, .main, listener)
    }

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        .init(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }

    private func refresh() {
        var address = Self.address(kAudioHardwarePropertyDevices)
        var bytes: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &bytes) == noErr, bytes > 0 else { return }
        var devices = Array(repeating: AudioDeviceID(0), count: Int(bytes) / MemoryLayout<AudioDeviceID>.size)
        let result = devices.withUnsafeMutableBytes {
            AudioObjectGetPropertyData(system, &address, 0, nil, &bytes, $0.baseAddress!)
        }
        guard result == noErr else { return }
        let connected = devices.lazy.compactMap(Self.airPodsName).first
        guard name != connected else { return }
        name = connected
        onChange?()
    }

    private static func airPodsName(_ id: AudioDeviceID) -> String? {
        var transport = UInt32(0)
        var bytes = UInt32(MemoryLayout<UInt32>.size)
        var address = Self.address(kAudioDevicePropertyTransportType)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &bytes, &transport) == noErr,
              transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE else { return nil }
        address = .init(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &bytes) == noErr, bytes > 0 else { return nil }
        address = Self.address(kAudioObjectPropertyName)
        var rawName: Unmanaged<CFString>?
        bytes = UInt32(MemoryLayout.size(ofValue: rawName))
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &bytes, &rawName) == noErr,
              let name = rawName?.takeRetainedValue() as String?,
              name.localizedCaseInsensitiveContains("AirPods") else { return nil }
        return name
    }
}

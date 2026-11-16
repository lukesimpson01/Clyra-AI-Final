import Foundation
import IOKit.ps
import CoreWLAN
import CoreAudio

/// The system things macOS shows in its own notch area, shown here as short banners: charger plugged in or removed, low battery,
/// fully charged, Wi-Fi connecting or dropping, and volume changes. (macOS keeps other apps' notifications private, so those
/// cannot be shown.)
final class SystemActivity {
    var onEvent: ((_ title: String, _ detail: String, _ symbol: String) -> Void)?
    private var powerSource: CFRunLoopSource?
    private var timer: Timer?
    private var wasOnAC: Bool?
    private var announcedLow = false
    private var announcedCritical = false
    private var announcedFull = false
    private var wifiConnected: Bool?
    private var lastSSID: String?
    private var lastVolume: Float?
    private var volumeQuietUntil = Date().addingTimeInterval(3)

    func start() {
        let context = Unmanaged.passUnretained(self).toOpaque()
        if let source = IOPSNotificationCreateRunLoopSource({ pointer in
            guard let pointer else { return }
            Unmanaged<SystemActivity>.fromOpaque(pointer).takeUnretainedValue().powerChanged()
        }, context)?.takeRetainedValue() {
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            powerSource = source
        }
        powerChanged(initial: true)
        wifiChanged(initial: true)
        let t = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.wifiChanged(); self?.volumeChanged() }
        t.tolerance = 0.5
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    // MARK: Battery

    private func battery() -> (percent: Int, onAC: Bool, charging: Bool, full: Bool)? {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
        for source in list {
            guard let d = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
            let current = d[kIOPSCurrentCapacityKey] as? Int ?? 0
            let maxCapacity = max(1, d[kIOPSMaxCapacityKey] as? Int ?? 100)
            let onAC = (d[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
            let charging = d[kIOPSIsChargingKey] as? Bool ?? false
            let full = d[kIOPSIsChargedKey] as? Bool ?? false
            return (Int((Double(current) / Double(maxCapacity) * 100).rounded()), onAC, charging, full)
        }
        return nil
    }

    func powerChanged(initial: Bool = false) {
        guard let b = battery() else { return }
        defer { wasOnAC = b.onAC }
        if initial { announcedFull = b.full; return }
        if let was = wasOnAC, was != b.onAC {
            if b.onAC {
                onEvent?(b.charging ? "Charging" : "Plugged in", "\(b.percent)%", "bolt.fill")
            } else {
                onEvent?("On battery", "\(b.percent)%", batterySymbol(b.percent))
            }
            announcedFull = false
        }
        if !b.onAC {
            if b.percent <= 10, !announcedCritical { announcedCritical = true; announcedLow = true; onEvent?("Battery very low", "\(b.percent)%", "battery.0percent") }
            else if b.percent <= 20, !announcedLow { announcedLow = true; onEvent?("Low battery", "\(b.percent)%", "battery.25percent") }
        } else {
            announcedLow = false
            announcedCritical = false
            if (b.full || b.percent >= 100), !announcedFull { announcedFull = true; onEvent?("Fully charged", "100%", "battery.100percent") }
        }
    }

    private func batterySymbol(_ percent: Int) -> String {
        switch percent { case ..<13: return "battery.0percent"; case ..<38: return "battery.25percent"; case ..<63: return "battery.50percent"; case ..<88: return "battery.75percent"; default: return "battery.100percent" }
    }

    // MARK: Wi-Fi

    private func wifiChanged(initial: Bool = false) {
        guard let interface = CWWiFiClient.shared().interface() else { return }
        let connected = interface.powerOn() && interface.serviceActive() && (interface.ssid() != nil || interface.bssid() != nil || interface.rssiValue() != 0)
        let name = interface.ssid()
        defer { wifiConnected = connected; lastSSID = name }
        if initial { return }
        if let was = wifiConnected {
            if connected && !was { onEvent?("Wi-Fi", name.map { "Connected to \($0)" } ?? "Connected", "wifi") }
            else if !connected && was { onEvent?("Wi-Fi", interface.powerOn() ? "Disconnected" : "Turned off", "wifi.slash") }
            else if connected, let name, let last = lastSSID, name != last { onEvent?("Wi-Fi", "Connected to \(name)", "wifi") }
        }
    }

    // MARK: Volume

    private func outputVolume() -> Float? {
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr else { return nil }
        var volume = Float32(0)
        var vsize = UInt32(MemoryLayout<Float32>.size)
        var vaddress = AudioObjectPropertyAddress(mSelector: AudioObjectPropertySelector(0x766D7663), mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(device, &vaddress, 0, nil, &vsize, &volume) == noErr else { return nil }
        return volume
    }

    private func volumeChanged() {
        guard let v = outputVolume() else { return }
        defer { lastVolume = v }
        guard let last = lastVolume, abs(v - last) > 0.02, Date() > volumeQuietUntil else { return }
        let symbol = v < 0.01 ? "speaker.slash.fill" : (v < 0.34 ? "speaker.wave.1.fill" : (v < 0.67 ? "speaker.wave.2.fill" : "speaker.wave.3.fill"))
        onEvent?("Volume", "\(Int((v * 100).rounded()))%", symbol)
    }
}

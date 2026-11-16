import Foundation
import CoreAudio
import AudioToolbox
import Accelerate

/// Hears what the Mac is playing through a Core Audio process tap (macOS 14.2+), which only needs the "System Audio
/// Recording" permission, not Screen Recording. It measures loudness and five frequency bands (bass to treble) and keeps
/// nothing: no audio is saved or sent anywhere.
@available(macOS 14.2, *)
final class SystemAudioTap {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let queue = DispatchQueue(label: "notch.system-audio-tap", qos: .userInteractive)
    private let fftSize = 1024
    private var fftSetup: FFTSetup?
    private var ring: [Float] = []
    private var sampleRate: Double = 48_000
    private var lastEmit: TimeInterval = 0
    /// rms (0...1 raw), bands (0...1 each)
    var onReading: ((Float, [Float]) -> Void)?
    private(set) var running = false

    init() {
        fftSetup = vDSP_create_fftsetup(vDSP_Length(log2(Float(fftSize))), FFTRadix(kFFTRadix2))
        ring.reserveCapacity(fftSize * 2)
    }

    deinit { stop(); if let fftSetup { vDSP_destroy_fftsetup(fftSetup) } }

    /// Throws if the tap cannot be made (no permission, unsupported system).
    func start() throws {
        guard !running else { return }
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        var status = AudioHardwareCreateProcessTap(description, &tap)
        guard status == noErr else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not tap system audio."]) }
        tapID = tap

        // The default output device anchors the private aggregate device the tap is read through.
        var outputUID: String?
        var deviceID = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID) == noErr {
            var uid: Unmanaged<CFString>?
            var uidSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            var uidAddress = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            if AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, &uid) == noErr { outputUID = uid?.takeRetainedValue() as String? }
        }
        var aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Notch audio meter",
            kAudioAggregateDeviceUIDKey: "local.notch.meter.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]],
        ]
        if let outputUID {
            aggregate[kAudioAggregateDeviceMainSubDeviceKey] = outputUID
            aggregate[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: outputUID]]
        }
        var aggregateDevice = AudioObjectID(kAudioObjectUnknown)
        status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateDevice)
        guard status == noErr else { stop(); throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not open the audio meter."]) }
        aggregateID = aggregateDevice

        var format = AudioStreamBasicDescription()
        var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var formatAddress = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        if AudioObjectGetPropertyData(tapID, &formatAddress, 0, nil, &formatSize, &format) == noErr, format.mSampleRate > 0 { sampleRate = format.mSampleRate }

        status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { [weak self] _, input, _, _, _ in
            self?.consume(input)
        }
        guard status == noErr, procID != nil else { stop(); throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not read the audio meter."]) }
        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else { stop(); throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not start the audio meter."]) }
        running = true
    }

    func stop() {
        running = false
        if aggregateID != kAudioObjectUnknown {
            if let procID { AudioDeviceStop(aggregateID, procID); AudioDeviceDestroyIOProcID(aggregateID, procID) }
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
        ring.removeAll(keepingCapacity: true)
    }

    private func consume(_ input: UnsafePointer<AudioBufferList>) {
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        guard let first = buffers.first, let raw = first.mData else { return }
        let channels = max(1, Int(first.mNumberChannels))
        let frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size / channels
        let samples = raw.assumingMemoryBound(to: Float.self)
        // mono mix of whatever channels arrive
        for frame in 0..<frames {
            var sum: Float = 0
            for channel in 0..<channels { sum += samples[frame * channels + channel] }
            ring.append(sum / Float(channels))
        }
        if ring.count > fftSize * 4 { ring.removeFirst(ring.count - fftSize * 2) }
        let now = ProcessInfo.processInfo.systemUptime
        guard ring.count >= fftSize, now - lastEmit > 1.0 / 45 else { return }
        lastEmit = now
        let window = Array(ring.suffix(fftSize))
        ring.removeFirst(min(ring.count, fftSize / 2))
        analyse(window)
    }

    private func analyse(_ samples: [Float]) {
        guard let fftSetup else { return }
        var rms: Float = 0
        vDSP_rmsqv(samples, 1, &rms, vDSP_Length(samples.count))
        var windowed = [Float](repeating: 0, count: fftSize)
        var hann = [Float](repeating: 0, count: fftSize)
        vDSP_hann_window(&hann, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
        vDSP_vmul(samples, 1, hann, 1, &windowed, 1, vDSP_Length(fftSize))
        let half = fftSize / 2
        var real = [Float](repeating: 0, count: half)
        var imag = [Float](repeating: 0, count: half)
        var magnitudes = [Float](repeating: 0, count: half)
        real.withUnsafeMutableBufferPointer { r in
            imag.withUnsafeMutableBufferPointer { i in
                var split = DSPSplitComplex(realp: r.baseAddress!, imagp: i.baseAddress!)
                windowed.withUnsafeBufferPointer { w in
                    w.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) { vDSP_ctoz($0, 2, &split, 1, vDSP_Length(half)) }
                }
                vDSP_fft_zrip(fftSetup, &split, 1, vDSP_Length(log2(Float(fftSize))), FFTDirection(kFFTDirection_Forward))
                vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(half))
            }
        }
        let hz = Float(sampleRate) / Float(fftSize)
        let edges: [(Float, Float)] = [(40, 140), (140, 500), (500, 2000), (2000, 6000), (6000, 14000)]
        let bands: [Float] = edges.map { low, high in
            let lo = max(1, Int(low / hz)), hi = min(half - 1, max(lo + 1, Int(high / hz)))
            var peak: Float = 0
            var sum: Float = 0
            for bin in lo..<hi { sum += magnitudes[bin]; peak = max(peak, magnitudes[bin]) }
            // blend of the band's average and its strongest bin, in dB: a steady map from quiet to loud
            let value = 0.5 * (sum / Float(hi - lo)) + 0.5 * peak
            let db = 20 * log10(max(1e-7, value / Float(fftSize / 4)))
            return min(1, max(0, (db + 70) / 55))
        }
        let reading = onReading
        DispatchQueue.main.async { reading?(rms, bands) }
    }
}

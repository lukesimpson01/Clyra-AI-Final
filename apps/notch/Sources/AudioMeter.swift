import AppKit
import CoreMedia
import AudioToolbox
import ScreenCaptureKit
import SwiftUI

/// Measures the selected player's PCM without saving audio or capturing video frames.
final class AudioMeter: NSObject, ObservableObject, SCStreamOutput, SCStreamDelegate {
    @Published private(set) var level: Float = 0
    @Published private(set) var status = ""
    private var desired: String?
    private var stream: SCStream?
    private var request: Task<Void, Never>?
    private var generation = 0
    private let queue = DispatchQueue(label: "notch.audio-meter", qos: .utility)
    private var lastSample: TimeInterval = 0

    deinit { request?.cancel(); stream?.stopCapture { _ in } }

    // Loudness measured by Clyra (which already holds the screen-recording permission), used when the Notch has none of its own.
    private var externalAt = Date.distantPast
    /// A real reading is arriving, from this app's own capture or from Clyra's.
    var hasLiveLevel: Bool { status.isEmpty || Date().timeIntervalSince(externalAt) < 0.8 }

    func receiveExternal(rms: Double) {
        externalAt = Date()
        let normalized = Float(min(1, max(0, (20 * log10(max(0.0001, rms)) + 55) / 55)))
        let next = max(normalized, level * 0.74)
        let visible: Float = next < 0.01 ? 0 : next
        if visible != level { level = visible }
    }

    func update(bundle: String?, enabled: Bool) {
        let target = enabled ? bundle : nil
        guard desired != target else { return }
        desired = target
        generation += 1
        let generation = generation
        request?.cancel()
        let previous = stream
        stream = nil
        level = 0
        status = ""
        request = Task { @MainActor [weak self] in
            if let previous { try? await previous.stopCapture() }
            guard let self, let target, !Task.isCancelled else { return }
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard self.generation == generation, !Task.isCancelled else { return }
                guard let display = content.displays.first, let player = content.applications.first(where: { $0.bundleIdentifier == target }) else {
                    self.status = "Audio capture is unavailable for this player."
                    return
                }
                let filter = SCContentFilter(display: display, including: [player], exceptingWindows: [])
                let config = SCStreamConfiguration()
                // The stream only has an audio consumer. Keep any backing video work small.
                config.width = 64
                config.height = 64
                config.minimumFrameInterval = CMTime(value: 1, timescale: 2)
                config.capturesAudio = true
                config.excludesCurrentProcessAudio = true
                config.sampleRate = 48_000
                config.channelCount = 1
                let candidate = SCStream(filter: filter, configuration: config, delegate: self)
                try candidate.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
                try await candidate.startCapture()
                guard self.generation == generation, !Task.isCancelled else { try? await candidate.stopCapture(); return }
                self.stream = candidate
            } catch {
                guard self.generation == generation else { return }
                self.status = "Allow Screen & System Audio Recording for live bars."
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.stream === stream else { return }
            self.stream = nil
            self.level = 0
            self.status = "Audio capture stopped."
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastSample > 1.0 / 25 else { return }
        lastSample = now
        guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(format),
              description.pointee.mBitsPerChannel == 32,
              description.pointee.mFormatFlags & kAudioFormatFlagIsFloat != 0,
              let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        let count = CMBlockBufferGetDataLength(block) / MemoryLayout<Float>.size
        guard count > 0, count < 192_000 else { return }
        var values = Array(repeating: Float.zero, count: count)
        let copied = values.withUnsafeMutableBytes { bytes in
            CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes.count, destination: bytes.baseAddress!)
        }
        guard copied == noErr else { return }
        var energy: Float = 0
        var samples: Float = 0
        for index in stride(from: 0, to: values.count, by: 4) {
            let x = values[index]
            if x.isFinite { energy += x * x; samples += 1 }
        }
        let rms = sqrt(energy / max(1, samples))
        let normalized = min(1, max(0, (20 * log10(max(0.0001, rms)) + 55) / 55))
        DispatchQueue.main.async { [weak self] in
            guard let self, self.stream === stream else { return }
            let level = max(normalized, self.level * 0.74)
            let visibleLevel: Float = level < 0.01 ? 0 : level
            if visibleLevel != self.level { self.level = visibleLevel }
        }
    }
}

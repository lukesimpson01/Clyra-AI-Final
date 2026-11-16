import AVFoundation
import SwiftUI

/// The notch's own camera preview for voice calls. It asks macOS for camera access as "Clyra’s Notch" the first time.
final class NotchCamera: ObservableObject {
    @Published private(set) var wanted = false
    @Published private(set) var running = false
    @Published private(set) var denied = false
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "notch.camera")

    func toggle() { wanted ? stop() : start() }

    func start() {
        guard !wanted else { return }
        wanted = true
        denied = false
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: begin()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async { granted ? self?.begin() : self?.fail() }
            }
        default: fail()
        }
    }

    private func fail() { denied = true; running = false }

    private func begin() {
        guard wanted else { return }
        queue.async { [weak self] in
            guard let self else { return }
            guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device) else {
                DispatchQueue.main.async { self.fail() }
                return
            }
            self.session.beginConfiguration()
            self.session.sessionPreset = .medium
            for old in self.session.inputs { self.session.removeInput(old) }
            if self.session.canAddInput(input) { self.session.addInput(input) }
            self.session.commitConfiguration()
            self.session.startRunning()
            DispatchQueue.main.async { self.running = self.session.isRunning && self.wanted }
        }
    }

    func stop() {
        wanted = false
        running = false
        queue.async { [weak self] in
            guard let self else { return }
            self.session.stopRunning()
            for old in self.session.inputs { self.session.removeInput(old) }
        }
    }
}

struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.connection?.automaticallyAdjustsVideoMirroring = false
        layer.connection?.isVideoMirrored = true
        view.layer = layer
        return view
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

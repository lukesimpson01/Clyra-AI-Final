import SwiftUI
import Network

// Clyra Flow inside the notch. When Clyra's Flow indicator is set to "Notch", Clyra sends its dictation state and the
// microphone level here over a local UDP socket, and the notch expands slightly to show it. Stop and cancel go back
// the same way. Nothing here records audio.

/// The voice meter: the same recipe as the Flow pill in Clyra, so both read identically.
///  1. the mic reading becomes decibels, so quiet and loud voices move the bars in proportion;
///  2. a noise floor is learned while nobody speaks, and everything under it is held at a calm idle;
///  3. a running peak scales the voice to full height, so a quiet mic and a loud one look alike;
///  4. an envelope follower: fast attack so the first syllable lands at once, slow release so bars never flicker;
///  5. the envelope travels outward from the centre in a short history, so the wave ripples with speech;
///  6. every bar rides a critically damped spring, which is what makes it feel physical;
///  7. in silence the bars breathe slowly, so the strip never looks frozen.
final class WaveformEngine {
    let bars = 27
    private(set) var pos: [Double]
    private var vel: [Double]
    private var history = [Double](repeating: 0, count: 20)
    private var floorDb = -52.0, peakDb = -24.0
    private var env = 0.0
    private var raw = 0.0, rawAt = Date.distantPast
    private var lastShift = Date.distantPast
    private var last = Date.distantPast
    private var t = 0.0
    var level: Double { env }

    init() {
        pos = [Double](repeating: 0, count: bars)
        vel = [Double](repeating: 0, count: bars)
    }

    /// `rms` is the microphone's root-mean-square in 0...1 (full scale), ~60 times a second.
    func push(rms: Double) { raw = max(0, min(1, rms)); rawAt = Date() }

    func reset() {
        env = 0
        pos = [Double](repeating: 0, count: bars)
        vel = [Double](repeating: 0, count: bars)
        history = [Double](repeating: 0, count: history.count)
        last = .distantPast
    }

    func step(_ now: Date) {
        let dt = min(0.05, max(0.001, last == .distantPast ? 1.0 / 60 : now.timeIntervalSince(last)))
        last = now
        t += dt
        let level = now.timeIntervalSince(rawAt) < 0.26 ? raw : 0
        let db = 20 * log10(max(level, 1e-4))
        floorDb += (db - floorDb) * (db < floorDb ? min(1, dt / 0.25) : min(1, dt / 6))
        floorDb = max(-64, min(-36, floorDb))
        let gate = floorDb + 5
        peakDb = max(db, peakDb - 5 * dt, gate + 16)
        let norm = pow(max(0, min(1, (db - gate) / (peakDb - gate))), 0.8)
        env += (norm - env) * (1 - exp(-dt / (norm > env ? 0.028 : 0.17)))
        if now.timeIntervalSince(lastShift) >= 0.026 {
            for i in stride(from: history.count - 1, to: 0, by: -1) { history[i] = history[i - 1] }
            lastShift = now
        }
        history[0] = env
        let c = Double(bars - 1) / 2
        let quiet = env < 0.025
        for i in 0..<bars {
            let d = abs(Double(i) - c)
            let taper = 1 - (d / c) * 0.38
            let at = d * 0.6
            let lo = Int(at), f = at - Double(lo)
            let hist = history[lo] * (1 - f) + history[min(history.count - 1, lo + 1)] * f
            var target = hist * taper * (1 + 0.1 * sin(t * 5.2 + Double(i) * 1.7) * hist)
            if quiet { target = max(target, taper * (0.07 + 0.05 * (0.5 + 0.5 * sin(t * 1.7 - d * 0.6)))) }
            var x = pos[i], v = vel[i]
            for _ in 0..<3 {
                let h = dt / 3
                let a = -520 * (x - target) - 44 * v
                v += a * h
                x += v * h
            }
            pos[i] = max(0, min(1.15, x))
            vel[i] = v
        }
    }
}

/// Bars drawn straight from the engine at display rate.
struct WaveformView: View {
    let engine: WaveformEngine
    var height: CGFloat = 24
    var body: some View {
        TimelineView(.animation) { frame in
            Canvas { context, size in
                engine.step(frame.date)
                let n = engine.bars
                let barW: CGFloat = 2.6, gap: CGFloat = 2.8
                let total = CGFloat(n) * barW + CGFloat(n - 1) * gap
                let x0 = (size.width - total) / 2, mid = size.height / 2, maxH = size.height * 0.92
                for i in 0..<n {
                    let p = CGFloat(min(1, engine.pos[i]))
                    let h = 3 + p * (maxH - 3)
                    let rect = CGRect(x: x0 + CGFloat(i) * (barW + gap), y: mid - h / 2, width: barW, height: h)
                    let shading = GraphicsContext.Shading.linearGradient(
                        Gradient(colors: [Color(red: 0.81, green: 0.88, blue: 1), Color(red: 0.44, green: 0.61, blue: 1)]),
                        startPoint: CGPoint(x: 0, y: rect.minY), endPoint: CGPoint(x: 0, y: rect.maxY))
                    context.opacity = 0.4 + Double(p) * 0.6
                    context.fill(Path(roundedRect: rect, cornerRadius: barW / 2), with: shading)
                }
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// Receives Flow's state and level from Clyra on a local socket, and sends stop/cancel back.
final class FlowBridge: ObservableObject {
    static let receivePort: NWEndpoint.Port = 31416
    static let sendPort: NWEndpoint.Port = 31417

    @Published private(set) var phase = "idle"
    @Published private(set) var text = ""
    @Published private(set) var detail = ""
    let engine = WaveformEngine()
    var onChange: ((Bool) -> Void)?   // (active changed)

    private var listener: NWListener?
    private var sender: NWConnection?
    private var lastPacket = Date.distantPast

    /// Flow is showing here only while Clyra says so, and drops out by itself if Clyra goes quiet.
    var active: Bool { phase != "idle" && Date().timeIntervalSince(lastPacket) < 20 }

    init() {
        do {
            let parameters = NWParameters.udp
            parameters.allowLocalEndpointReuse = true
            let l = try NWListener(using: parameters, on: Self.receivePort)
            l.newConnectionHandler = { [weak self] connection in
                connection.start(queue: .main)
                self?.receive(on: connection)
            }
            l.start(queue: .main)
            listener = l
        } catch {
            listener = nil
        }
        sender = NWConnection(host: "127.0.0.1", port: Self.sendPort, using: .udp)
        sender?.start(queue: .main)
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            if let data, let self { self.handle(data) }
            if error == nil { self?.receive(on: connection) }
        }
    }

    private func handle(_ data: Data) {
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = o["t"] as? String else { return }
        lastPacket = Date()
        switch type {
        case "level":
            let rms = (o["rms"] as? NSNumber)?.doubleValue ?? (o["level"] as? NSNumber)?.doubleValue ?? 0
            engine.push(rms: rms)
        case "state":
            let next = o["phase"] as? String ?? "idle"
            let was = active
            if next == "listening" && phase != "listening" { engine.reset() }
            phase = next
            text = String((o["partial"] as? String ?? o["preview"] as? String ?? "").suffix(160))
            detail = o["detail"] as? String ?? ""
            if was != active { onChange?(active) } else { objectWillChange.send() }
        default: break
        }
    }

    func send(action: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["action": action]) else { return }
        sender?.send(content: data, completion: .contentProcessed { _ in })
    }
}

/// What the notch shows while Flow is running: cancel, the voice (or your words), and stop. Same layout as the Flow pill.
struct FlowStrip: View {
    @ObservedObject var flow: FlowBridge
    var reduceMotion = false

    private var listening: Bool { flow.phase == "listening" }
    private var thinking: Bool { ["processing", "optimising", "refining", "revealing"].contains(flow.phase) }
    private var finished: Bool { flow.phase == "done" }
    private var failed: Bool { flow.phase == "error" }

    var body: some View {
        HStack(spacing: 8) {
            Button { flow.send(action: "cancel") } label: {
                Image(systemName: "xmark").font(.system(size: 9.5, weight: .bold)).foregroundStyle(.white.opacity(0.75))
                    .frame(width: 24, height: 24).background(Circle().fill(Color.white.opacity(0.1))).contentShape(Circle())
            }
            .buttonStyle(.plain)
            .opacity(flow.phase == "arming" || finished ? 0.35 : 1)
            ZStack {
                if listening && flow.text.isEmpty {
                    WaveformView(engine: flow.engine, height: 22).transition(.opacity)
                } else if listening || (!thinking && !finished && !failed && !flow.text.isEmpty) {
                    Text(flow.text).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white)
                        .lineLimit(1).truncationMode(.head).frame(maxWidth: .infinity, alignment: .trailing).transition(.opacity)
                } else if thinking {
                    ShimmerText(text: flow.detail.isEmpty ? "Thinking" : flow.detail, reduceMotion: reduceMotion, size: 12.5).transition(.opacity)
                } else if finished {
                    Text(flow.detail.isEmpty ? "Inserted" : flow.detail).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white).lineLimit(1).transition(.opacity)
                } else if failed {
                    Text(flow.detail.isEmpty ? "Couldn’t dictate" : flow.detail).font(.system(size: 12, weight: .medium)).foregroundStyle(Color(red: 1, green: 0.56, blue: 0.52)).lineLimit(1).transition(.opacity)
                } else {
                    WaveformView(engine: flow.engine, height: 22).opacity(0.6).transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: flow.phase)
            ZStack {
                if finished {
                    Image(systemName: "checkmark").font(.system(size: 10.5, weight: .bold)).foregroundStyle(.black)
                        .frame(width: 24, height: 24).background(Circle().fill(Color(red: 0.2, green: 0.78, blue: 0.35))).transition(.scale.combined(with: .opacity))
                } else if thinking {
                    ProgressView().controlSize(.small).scaleEffect(0.7).frame(width: 24, height: 24).transition(.opacity)
                } else {
                    Button { flow.send(action: "stop") } label: {
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous).fill(.white).frame(width: 8.5, height: 8.5)
                            .frame(width: 24, height: 24)
                            .background(Circle().fill(LinearGradient(colors: [Color(red: 0.25, green: 0.5, blue: 1), Color(red: 0.07, green: 0.3, blue: 0.92)], startPoint: .top, endPoint: .bottom)))
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .transition(.opacity)
                }
            }
            .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.75), value: flow.phase)
        }
        .padding(.horizontal, 8)
    }
}

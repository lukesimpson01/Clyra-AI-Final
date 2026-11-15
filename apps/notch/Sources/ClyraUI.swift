import SwiftUI
import AppKit

// Clyra's own chat pieces, redrawn for a black notch. Same structure and behaviour as the chat in Clyra
// (src/components/chat): tool rows, favicons, result cards, sources, plan, composer. Only the theme differs.

// MARK: Blob

/// The welcome avatar: a blue ball with two tall eyes that blink now and then.
struct ClyraBlob: View {
    var size: CGFloat = 58
    var reduceMotion = false
    @State private var blink = false
    @State private var breathe = false

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [Color(red: 0.48, green: 0.65, blue: 1.0), Color(red: 0.18, green: 0.4, blue: 0.96), Color(red: 0.10, green: 0.25, blue: 0.82)],
                                     center: UnitPoint(x: 0.35, y: 0.25), startRadius: 0, endRadius: size * 0.85))
            Circle().strokeBorder(LinearGradient(colors: [.white.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom), lineWidth: 1)
            HStack(spacing: size * 0.17) {
                Capsule().fill(.white).frame(width: size * 0.115, height: size * 0.27).scaleEffect(y: blink ? 0.1 : 1)
                Capsule().fill(.white).frame(width: size * 0.115, height: size * 0.27).scaleEffect(y: blink ? 0.1 : 1)
            }
            .offset(y: -size * 0.02)
        }
        .frame(width: size, height: size)
        .shadow(color: Color(red: 0.2, green: 0.4, blue: 1.0).opacity(0.55), radius: size * 0.32, y: size * 0.06)
        .scaleEffect(breathe ? 1.025 : 1)
        .task {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.8).repeatForever(autoreverses: true)) { breathe = true }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Double.random(in: 2.6...5.0) * 1_000_000_000))
                withAnimation(.easeIn(duration: 0.07)) { blink = true }
                try? await Task.sleep(nanoseconds: 110_000_000)
                withAnimation(.easeOut(duration: 0.12)) { blink = false }
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: Composer

/// Clyra's composer, on one line for the notch: add, message, effort, voice, send. A faint fill and a light outline.
struct ClyraComposer: View {
    @ObservedObject var model: NotchModel
    var compact = false
    @FocusState private var focused: Bool
    @State private var showEffort = false

    var body: some View {
        let height: CGFloat = compact ? 42 : 48
        HStack(spacing: 2) {
            ComposerButton(symbol: "plus", label: "Add files in Clyra") { model.openClyra() }
            TextField("Message Clyra", text: $model.chatDraft)
                .textFieldStyle(.plain)
                .font(.system(size: compact ? 13.5 : 14.5))
                .focused($focused)
                .padding(.horizontal, 4)
                .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?(); focused = true })
                .onSubmit { model.submitChat() }
            Button { showEffort.toggle() } label: {
                HStack(spacing: 4) {
                    Text(model.chat.effortTitle).font(.system(size: 12.5, weight: .medium))
                    Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
                        .rotationEffect(.degrees(showEffort ? 180 : 0))
                }
                .foregroundStyle(.white.opacity(0.92))
                .padding(.horizontal, 8).frame(height: 26)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            ComposerButton(symbol: "mic", label: "Dictate in Clyra") { model.openClyra() }
            SendButton(model: model)
        }
        .padding(.leading, 6).padding(.trailing, 5)
        .frame(height: height)
        .background(RoundedRectangle(cornerRadius: height / 2, style: .continuous).fill(Color.white.opacity(focused ? 0.1 : 0.075)))
        .overlay(RoundedRectangle(cornerRadius: height / 2, style: .continuous).strokeBorder(Color.white.opacity(focused ? 0.4 : 0.2), lineWidth: 1))
        .overlay(alignment: .bottomLeading) {
            EffortPopover(model: model, open: showEffort, close: { showEffort = false })
                .offset(x: 28, y: -(height + 10))
        }
        .zIndex(showEffort ? 10 : 0)
        .onReceive(NotificationCenter.default.publisher(for: .notchDebugEffort)) { _ in showEffort.toggle() }
        .animation(model.reduceMotion ? nil : .easeOut(duration: 0.18), value: focused)
        .onChange(of: focused) { _, f in model.chatFocused = f }
    }
}

/// Clyra's reasoning-effort popover, ported from the chat (EffortSlider): a track with a thumb that follows the pointer,
/// rubber-bands past the ends, springs to the nearest stop, and previews the level's name while dragging. The top level
/// becomes layered electric blue with a travelling light and twinkling points, and arriving at it plays a short charge-up.
struct EffortPopover: View {
    @ObservedObject var model: NotchModel
    let open: Bool
    let close: () -> Void

    private let width: CGFloat = 248, pad: CGFloat = 14, trackH: CGFloat = 26, thumb: CGFloat = 22
    private var inset: CGFloat { (trackH - thumb) / 2 }
    private var travel: CGFloat { width - pad * 2 - thumb - inset * 2 }
    private var levels: [(key: String, title: String, model: String)] { ChatClient.efforts }
    private var hints: [String] { ["Answers directly", "Plans, then answers", "Drafts, then checks"] }
    private var step: CGFloat { travel / CGFloat(max(1, levels.count - 1)) }
    private var index: Int { levels.firstIndex { $0.key == model.chat.effort } ?? levels.count - 1 }
    private let accent = Color(red: 0.0, green: 0.32, blue: 0.98)

    @State private var x: CGFloat = 0
    @State private var pressed = false
    @State private var preview: Int?
    @State private var session: (grab: CGFloat, moved: Bool, downX: CGFloat)?
    @State private var direction: CGFloat = 1
    @State private var lastShown = 0
    @State private var introStart: Date?
    @State private var wasMax = false
    @State private var resetTurn = false

    private var shown: Int { preview ?? index }
    private var isMax: Bool { shown == levels.count - 1 }

    private func settle(_ to: Int) {
        withAnimation(model.reduceMotion ? nil : .spring(response: 0.22, dampingFraction: 1.0)) { x = CGFloat(to) * step }
    }
    private func nearest(_ v: CGFloat) -> Int { Int((min(travel, max(0, v)) / max(1, step)).rounded()) }
    private func band(_ v: CGFloat) -> CGFloat { v < 0 ? -sqrt(-v) * 2 : (v > travel ? travel + sqrt(v - travel) * 2 : v) }
    private func commit(_ i: Int) -> Int {
        let next = min(levels.count - 1, max(0, i))
        if levels[next].key != model.chat.effort { model.chat.effort = levels[next].key }
        return next
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                ZStack(alignment: .leading) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(levels[shown].title).font(.system(size: 14.5, weight: .semibold)).tracking(-0.2)
                        Text(hints[min(shown, hints.count - 1)]).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    }
                    .id(shown)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(x: direction * 8)), removal: .opacity))
                }
                .frame(height: 20).clipped()
                Spacer(minLength: 0)
                Button {
                    resetTurn.toggle()
                    settle(commit(levels.count - 1))
                } label: {
                    Image(systemName: "arrow.counterclockwise").font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                        .frame(width: 22, height: 22)
                        .rotationEffect(.degrees(resetTurn ? -360 : 0))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Reset to default")
            }
            .frame(height: 22)
            track.padding(.top, 12)
            HStack(spacing: 0) {
                ForEach(Array(levels.enumerated()), id: \.element.key) { i, level in
                    let on = i == shown
                    Text(level.title)
                        .font(.system(size: 10.5, weight: on ? .semibold : .regular))
                        .foregroundStyle(on ? Color(red: 0.45, green: 0.66, blue: 1.0) : Color.white.opacity(0.45))
                        .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : (i == levels.count - 1 ? .trailing : .center))
                        .contentShape(Rectangle())
                        .onTapGesture { settle(commit(i)) }
                }
            }
            .frame(width: travel + thumb, height: 16, alignment: .leading)
            .padding(.top, 8).padding(.leading, inset)
        }
        .padding(.top, pad).padding(.horizontal, pad).padding(.bottom, 12)
        .frame(width: width)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(white: 0.075)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        .overlay { introGlow }
        .shadow(color: .black.opacity(0.55), radius: 16, y: 8)
        .opacity(open ? 1 : 0)
        .scaleEffect(open ? 1 : 0.98, anchor: UnitPoint(x: 0.16, y: 1))
        .offset(y: open ? 0 : 4)
        .allowsHitTesting(open)
        .animation(model.reduceMotion ? nil : (open ? .easeOut(duration: 0.2) : .easeIn(duration: 0.14)), value: open)
        .onAppear { x = CGFloat(index) * step; lastShown = shown; wasMax = isMax }
        .onChange(of: index) { _, new in if session == nil { settle(new) } }
        .onChange(of: open) { _, now in
            if !now { session = nil; pressed = false; preview = nil; x = CGFloat(index) * step }
        }
        .onChange(of: shown) { old, new in direction = new >= old ? 1 : -1; lastShown = new }
        .onChange(of: isMax) { _, now in
            if now && !wasMax && open && !model.reduceMotion { introStart = Date() }
            if !now { introStart = nil }
            wasMax = now
        }
    }

    // MARK: track

    private var track: some View {
        let fillW = max(0, x) + thumb + inset * 2
        return ZStack(alignment: .leading) {
            Capsule().fill(Color.white.opacity(0.1))
            ZStack(alignment: .leading) {
                Capsule().fill(accent).frame(width: fillW)
                MaxFill(on: isMax, trackWidth: width - pad * 2, reduceMotion: model.reduceMotion).frame(width: fillW).clipShape(Capsule())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if isMax { LitTrack(trackWidth: width - pad * 2, still: model.reduceMotion, intro: introStart != nil) }
            ForEach(0..<levels.count, id: \.self) { i in
                Circle().fill(i <= shown ? Color.white.opacity(0.7) : Color.white.opacity(0.2))
                    .frame(width: 4, height: 4)
                    .offset(x: inset + CGFloat(i) * step + thumb / 2 - 2)
                    .animation(.easeOut(duration: 0.2), value: shown)
            }
            if let start = introStart { IntroFlash(start: start, trackWidth: width - pad * 2) }
            Circle().fill(.white)
                .frame(width: thumb, height: thumb)
                .shadow(color: .black.opacity(0.35), radius: 2.5, y: 1)
                .scaleEffect(pressed ? 1.08 : 1)
                .overlay { if let start = introStart { ThumbCharge(start: start) } }
                .offset(x: inset + x)
                .animation(.easeOut(duration: 0.16), value: pressed)
            if let start = introStart { IntroBurst(start: start).frame(width: 0, height: 0).offset(x: inset + x + thumb / 2) }
        }
        .frame(width: width - pad * 2, height: trackH)
        .clipShape(Capsule())
        .contentShape(Capsule())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { drag in
                let at = drag.location.x - inset - thumb / 2
                if session == nil {
                    let onThumb = abs(at - x) <= thumb / 2 + 4
                    session = (grab: onThumb ? at - x : 0, moved: false, downX: drag.location.x)
                    pressed = true
                    if !onThumb { let to = nearest(at); preview = to; settle(to) }
                }
                guard var s = session else { return }
                if !s.moved && abs(drag.location.x - s.downX) < 3 { return }
                s.moved = true
                session = s
                var t = Transaction(); t.disablesAnimations = true
                withTransaction(t) { x = band(at - s.grab) }
                let to = nearest(x)
                if preview != to { preview = to }
            }
            .onEnded { drag in
                guard let s = session else { return }
                session = nil
                pressed = false
                let at = drag.location.x - inset - thumb / 2
                let to = s.moved ? nearest(x) : nearest(at - s.grab)
                preview = nil
                settle(commit(to))
            })
    }

    /// The popover takes a blue glow and lets go as the top level is reached.
    @ViewBuilder private var introGlow: some View {
        if let start = introStart {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { frame in
                let t = frame.date.timeIntervalSince(start) / 1.3
                let o: Double = t < 0.38 ? 0 : (t < 0.54 ? (t - 0.38) / 0.16 : max(0, 1 - (t - 0.54) / 0.46))
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color(red: 0.12, green: 0.43, blue: 1.0).opacity(0.5 * o), lineWidth: 1)
                    .shadow(color: Color(red: 0.12, green: 0.43, blue: 1.0).opacity(0.5 * o), radius: 18)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// The top level's fill: layered electric blues that fade in over the plain blue.
struct MaxFill: View {
    let on: Bool
    let trackWidth: CGFloat
    var reduceMotion = false
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.05, green: 0.25, blue: 0.68), Color(red: 0.08, green: 0.33, blue: 0.91), Color(red: 0.12, green: 0.44, blue: 1.0), Color(red: 0.24, green: 0.52, blue: 1.0)], startPoint: .leading, endPoint: .trailing)
            RadialGradient(colors: [Color(red: 0.47, green: 0.71, blue: 1.0).opacity(0.55), .clear], center: UnitPoint(x: 0.22, y: 0.2), startRadius: 0, endRadius: 70)
        }
        .frame(width: trackWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(on ? 1 : 0)
        .animation(reduceMotion ? nil : .timingCurve(0.3, 0, 0.2, 1, duration: 0.6), value: on)
    }
}

private let effortParticles: [(x: CGFloat, y: CGFloat, s: CGFloat, d: Double, t: Double)] = [
    (6, 30, 1.6, -0.4, 3.1), (11, 68, 1.2, -1.9, 4.3), (17, 44, 1.4, -2.6, 3.7), (24, 24, 1.1, -0.9, 4.9), (29, 72, 1.7, -3.3, 3.4),
    (36, 38, 1.2, -1.3, 4.1), (43, 62, 1.5, -2.2, 3.9), (49, 22, 1.1, -3.8, 4.6), (55, 50, 1.6, -0.2, 3.3), (61, 74, 1.2, -2.9, 4.4),
    (67, 32, 1.4, -1.6, 3.6), (73, 58, 1.1, -3.1, 5.0), (79, 26, 1.7, -0.7, 3.2), (84, 66, 1.3, -2.4, 4.2), (89, 42, 1.2, -1.1, 3.8),
]

/// A soft light that crosses the whole track and returns, forever, with tiny lights twinkling inside the blue.
struct LitTrack: View {
    let trackWidth: CGFloat
    var still = false
    var intro = false
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still)) { frame in
            let t = frame.date.timeIntervalSinceReferenceDate
            let phase = still ? 0.5 : 0.5 - 0.5 * cos(2 * Double.pi * t / 6.6)
            let shineW: CGFloat = 132
            ZStack(alignment: .leading) {
                RadialGradient(colors: [Color(red: 0.73, green: 0.87, blue: 1).opacity(0.95), Color(red: 0.47, green: 0.71, blue: 1).opacity(0.62), Color(red: 0.47, green: 0.71, blue: 1).opacity(0.22), .clear],
                               center: .center, startRadius: 0, endRadius: shineW * 0.5)
                    .frame(width: shineW, height: 26 * 1.4)
                    .offset(x: -shineW / 2 + (trackWidth) * CGFloat(phase))
                ForEach(0..<effortParticles.count, id: \.self) { n in
                    let p = effortParticles[n]
                    let o = 0.28 + 0.57 * (0.5 + 0.5 * sin(2 * Double.pi * (t + p.d) / p.t))
                    Circle().fill(.white).frame(width: p.s, height: p.s)
                        .shadow(color: Color(red: 0.73, green: 0.87, blue: 1).opacity(0.9), radius: 1.5)
                        .opacity(still ? 0.4 : o)
                        .offset(x: trackWidth * p.x / 100, y: 0)
                        .position(x: trackWidth * p.x / 100, y: 26 * p.y / 100)
                }
            }
            .frame(width: trackWidth, height: 26, alignment: .leading)
            .opacity(intro ? min(1, max(0, (t - (frame.date.timeIntervalSinceReferenceDate)) + 1)) : 1)
        }
        .allowsHitTesting(false)
    }
}

/// The release: one bright band crosses the track.
struct IntroFlash: View {
    let start: Date
    let trackWidth: CGFloat
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { frame in
            let t = (frame.date.timeIntervalSince(start) - 0.62) / 0.55
            if t > 0 && t < 1 {
                let e = t * t * (3 - 2 * t)
                let o = t < 0.12 ? t / 0.12 : (t > 0.85 ? max(0, (1 - t) / 0.15) : 1)
                LinearGradient(colors: [.clear, Color(red: 0.73, green: 0.87, blue: 1).opacity(0.5), .white.opacity(0.98), Color(red: 0.73, green: 0.87, blue: 1).opacity(0.5), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 120, height: 36)
                    .offset(x: -120 + (trackWidth + 140) * CGFloat(e))
                    .opacity(o)
            }
        }
        .allowsHitTesting(false)
    }
}

/// The charge-up at the thumb: a pulsing core, two rings, and sparks pulled in.
struct IntroBurst: View {
    let start: Date
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { frame in
            let t = frame.date.timeIntervalSince(start)
            if t < 1.5 {
                ZStack {
                    ForEach(0..<8, id: \.self) { n in
                        let a = Double(n) / 8 * 2 * Double.pi + Double(n % 2) * 0.35
                        let r = 46 + Double((n * 37) % 38)
                        let delay = Double(n % 5) * 0.045
                        let p = min(1, max(0, (t - delay) / 0.62))
                        Circle().fill(.white).frame(width: 4, height: 4)
                            .offset(x: cos(a) * r * (1 - p), y: sin(a) * r * 0.45 * (1 - p))
                            .opacity(p > 0 && p < 1 ? min(1, p / 0.3) * (1 - p) : 0)
                    }
                    ring(t: t, delay: 0, width: 1.5)
                    ring(t: t, delay: 0.74, width: 1)
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func ring(t: Double, delay: Double, width: CGFloat) -> some View {
        let p = (t - delay) / 0.72
        return Circle().strokeBorder(Color(red: 0.73, green: 0.87, blue: 1).opacity(0.95), lineWidth: width)
            .frame(width: 22, height: 22)
            .scaleEffect(0.5 + 4.9 * min(1, max(0, p)))
            .opacity(p > 0 && p < 1 ? 0.9 * (1 - p) : 0)
    }
}

struct ThumbCharge: View {
    let start: Date
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { frame in
            let t = frame.date.timeIntervalSince(start) / 1.3
            if t >= 0 && t < 1 {
                let o = t < 0.18 ? t / 0.18 * 0.7 : (t < 0.3 ? 0.3 : (t < 0.46 ? 0.85 : max(0, 0.85 * (1 - (t - 0.46) / 0.54))))
                Circle().fill(RadialGradient(colors: [Color(red: 0.47, green: 0.71, blue: 1).opacity(0.95), .clear], center: .center, startRadius: 0, endRadius: 20))
                    .frame(width: 40, height: 40).opacity(o)
            }
        }
        .allowsHitTesting(false)
    }
}

struct ComposerButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13, weight: .regular))
                .foregroundStyle(.white.opacity(hover ? 0.95 : 0.65))
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color.white.opacity(hover ? 0.1 : 0)))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}

/// Clyra's blue round button: a waveform when there is nothing to send, an arrow when there is, a stop square while it works.
struct SendButton: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        let streaming = model.chat.isStreaming
        let empty = model.chatDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        Button {
            if streaming { model.chat.stop() } else if empty { model.openClyra() } else { model.submitChat() }
        } label: {
            Image(systemName: streaming ? "stop.fill" : (empty ? "waveform" : "arrow.up"))
                .font(.system(size: streaming ? 10 : 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Circle().fill(LinearGradient(colors: [Color(red: 0.25, green: 0.5, blue: 1.0), Color(red: 0.07, green: 0.3, blue: 0.92)], startPoint: .top, endPoint: .bottom)))
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(streaming ? "Stop" : (empty ? "Voice" : "Send"))
    }
}

// MARK: Favicons and sources

struct Favicon: View {
    let host: String
    var size: CGFloat = 18
    var body: some View {
        let label = host.replacingOccurrences(of: "www.", with: "", options: [.anchored, .caseInsensitive])
        let url = URL(string: "https://www.google.com/s2/favicons?domain_url=\(("https://" + label).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")&sz=64")
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            default:
                ZStack {
                    Color.white.opacity(0.14)
                    Text(String(label.prefix(1)).uppercased()).font(.system(size: size * 0.5, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                }
            }
        }
        .frame(width: size, height: size)
        .background(Color.white.opacity(0.9))
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75))
    }
}

func uniqueHosts(_ sources: [SourceRef]) -> [SourceRef] {
    var seen = Set<String>()
    return sources.filter { seen.insert($0.host.replacingOccurrences(of: "www.", with: "")).inserted }
}

/// The sites a search fetched, as small round favicons beside the status line. New ones glide in from the left,
/// staggered 125 ms apart; icons already on screen never replay.
struct SourceStrip: View {
    let sources: [SourceRef]
    var reduceMotion = false
    @State private var revealed: Int

    init(sources: [SourceRef], reduceMotion: Bool = false) {
        self.sources = uniqueHosts(sources)
        self.reduceMotion = reduceMotion
        _revealed = State(initialValue: min(8, uniqueHosts(sources).count))
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(sources.prefix(min(8, revealed)))) { source in
                Favicon(host: source.host, size: 18)
                    .help(source.host)
                    .onTapGesture { if let url = URL(string: source.url) { NSWorkspace.shared.open(url) } }
                    .transition(reduceMotion ? .identity : .asymmetric(insertion: .opacity.combined(with: .offset(x: -14)), removal: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.78), value: revealed)
        .task(id: sources.count) {
            while revealed < min(8, sources.count) {
                try? await Task.sleep(nanoseconds: 125_000_000)
                revealed += 1
            }
        }
    }
}

// MARK: Thinking / shimmer

/// Text with a light that travels across it.
struct ShimmerText: View {
    let text: String
    var reduceMotion = false
    var size: CGFloat = 12.5
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduceMotion)) { frame in
            let t = reduceMotion ? 0.5 : frame.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.7) / 1.7
            Text(text)
                .font(.system(size: size, weight: .medium))
                .foregroundStyle(LinearGradient(stops: [
                    .init(color: .white.opacity(0.42), location: max(0, t - 0.25)),
                    .init(color: .white, location: t),
                    .init(color: .white.opacity(0.42), location: min(1, t + 0.25)),
                ], startPoint: .leading, endPoint: .trailing))
        }
    }
}

/// Clyra's status line: a breathing orb, "Thinking" with a shimmer, and three pulsing dots.
struct ThinkingLine: View {
    var reduceMotion = false
    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(RadialGradient(colors: [Color(red: 0.55, green: 0.7, blue: 1.0), Color(red: 0.15, green: 0.38, blue: 0.95)], center: .topLeading, startRadius: 0, endRadius: 12))
                .frame(width: 13, height: 13)
                .phaseAnimator([1.0, 0.78], trigger: reduceMotion) { view, scale in view.scaleEffect(reduceMotion ? 1 : scale) } animation: { _ in .easeInOut(duration: 0.9) }
            ShimmerText(text: "Thinking", reduceMotion: reduceMotion)
            if !reduceMotion {
                TimelineView(.animation(minimumInterval: 1.0 / 8)) { frame in
                    let phase = Int(frame.date.timeIntervalSinceReferenceDate * 2.5) % 4
                    HStack(spacing: 2.5) {
                        ForEach(0..<3, id: \.self) { i in Circle().fill(Color.white.opacity(i < phase ? 0.8 : 0.2)).frame(width: 3, height: 3) }
                    }
                }
            }
        }
    }
}

// MARK: Steps

struct StepLine: View {
    let step: StepItem
    var reduceMotion = false
    var openNote: ((String) -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: ToolStyle.symbol(step.tool)).font(.system(size: 12, weight: .regular))
                .foregroundStyle(.white.opacity(0.55)).frame(width: 16)
            if step.state == "running" {
                ShimmerText(text: ToolStyle.label(step), reduceMotion: reduceMotion, size: 12.5)
            } else {
                Text(ToolStyle.label(step)).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(step.state == "failed" ? 0.5 : 0.7))
            }
            if step.tool == "web_search", !step.sources.isEmpty {
                SourceStrip(sources: step.sources, reduceMotion: reduceMotion)
            } else if step.tool != "web_search", let meta = step.state == "failed" ? step.error : step.detail {
                Text(meta).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.4)).lineLimit(1)
            }
            if step.tool == "web_search", step.state == "failed", let error = step.error {
                Text(error).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.4)).lineLimit(1)
            }
            if let id = step.documentID, let openNote {
                Button("Open note") { openNote(id) }
                    .buttonStyle(.plain).font(.system(size: 11, weight: .medium)).foregroundStyle(ClyraTint.blueSoft)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 22)
    }
}

/// While the reply is being worked on every step shows. Afterwards they fold into "Completed N tool steps".
struct StepList: View {
    let steps: [StepItem]
    let live: Bool
    var reduceMotion = false
    var openNote: ((String) -> Void)?
    @State private var expanded = false

    var body: some View {
        let finished = steps.filter { $0.state != "running" }.count
        let showRows = live || expanded
        VStack(alignment: .leading, spacing: 3) {
            if !live {
                Button { withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.85)) { expanded.toggle() } } label: {
                    HStack(spacing: 7) {
                        Image(systemName: ToolStyle.symbol(steps.last?.tool ?? "")).font(.system(size: 12))
                        Text("\(steps.contains { $0.state == "failed" } ? "Tool activity" : "Completed") \(finished) tool \(finished == 1 ? "step" : "steps")")
                            .font(.system(size: 12.5))
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                    .foregroundStyle(.white.opacity(0.55))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if showRows {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(steps) { StepLine(step: $0, reduceMotion: reduceMotion, openNote: openNote) }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: Result cards

/// Real provider results (images, GitHub repositories) from the run's tool steps, as in Clyra's chat.
struct ResearchResults: View {
    let steps: [StepItem]

    var body: some View {
        let done = steps.filter { $0.state == "done" }
        var seenImages = Set<String>(), seenRepos = Set<String>()
        let images = done.flatMap(\.images).filter { seenImages.insert($0.sourceURL).inserted }.prefix(16)
        let repos = done.flatMap(\.repos).filter { seenRepos.insert($0.fullName.lowercased()).inserted }.prefix(12)
        if !images.isEmpty || !repos.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                if !images.isEmpty { ImageGrid(images: Array(images)) }
                if !repos.isEmpty { RepoList(repos: Array(repos)) }
            }
        }
    }
}

struct SectionHeading: View {
    let symbol: String
    let title: String
    let count: Int
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
            Text(title).font(.system(size: 12.5, weight: .semibold))
            Text("\(count)").font(.system(size: 10.5, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                .padding(.horizontal, 6).padding(.vertical, 1.5).background(Capsule().fill(Color.white.opacity(0.1)))
        }
    }
}

struct ImageGrid: View {
    let images: [ResearchImage]
    @State private var all = false

    private func tile(_ image: ResearchImage, _ side: CGFloat) -> some View {
        Button { if let url = URL(string: image.sourceURL) { NSWorkspace.shared.open(url) } } label: {
            AsyncImage(url: URL(string: image.thumbnailURL)) { phase in
                if case .success(let img) = phase { img.resizable().scaledToFill() } else { Color.white.opacity(0.08) }
            }
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(image.title)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionHeading(symbol: "photo.on.rectangle", title: "Images", count: images.count)
            if all {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 74), spacing: 5)], spacing: 5) {
                    ForEach(images) { tile($0, 74) }
                }
            } else {
                HStack(alignment: .top, spacing: 5) {
                    if let hero = images.first { tile(hero, 153) }
                    VStack(spacing: 5) {
                        HStack(spacing: 5) { ForEach(Array(images.dropFirst().prefix(2))) { tile($0, 74) } }
                        HStack(spacing: 5) { ForEach(Array(images.dropFirst(3).prefix(2))) { tile($0, 74) } }
                    }
                }
            }
            if images.count > 5 {
                Button { withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { all.toggle() } } label: {
                    HStack(spacing: 4) { Text(all ? "Show fewer" : "View all images"); Image(systemName: "chevron.down").rotationEffect(.degrees(all ? 180 : 0)) }
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.55))
                }.buttonStyle(.plain)
            }
        }
    }
}

struct RepoList: View {
    let repos: [RepoCard]
    private func stars(_ n: Int) -> String { n >= 1000 ? String(format: "%.1fk", Double(n) / 1000) : String(n) }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionHeading(symbol: "chevron.left.forwardslash.chevron.right", title: "GitHub repositories", count: repos.count)
            VStack(spacing: 5) {
                ForEach(repos) { repo in
                    Button { if let url = URL(string: repo.url) { NSWorkspace.shared.open(url) } } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                AsyncImage(url: repo.avatar.flatMap(URL.init(string:))) { phase in
                                    if case .success(let img) = phase { img.resizable().scaledToFill() } else { Color.white.opacity(0.1) }
                                }
                                .frame(width: 20, height: 20).clipShape(Circle())
                                Text(repo.fullName).font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
                                Spacer(minLength: 0)
                                Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(.white.opacity(0.4))
                            }
                            if let about = repo.about, !about.isEmpty {
                                Text(about).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.6)).lineLimit(2).multilineTextAlignment(.leading)
                            }
                            HStack(spacing: 10) {
                                Label(stars(repo.stars), systemImage: "star").labelStyle(.titleAndIcon)
                                if let language = repo.language { Text(language) }
                                Text(repo.licence ?? "Licence not verified")
                            }
                            .font(.system(size: 10.5)).foregroundStyle(.white.opacity(0.45))
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.05)))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white.opacity(0.09), lineWidth: 1))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// "Sources" under a finished answer: the first favicons, the count and a chevron. Opening it spreads the real sources out.
struct SourcesInline: View {
    let sources: [SourceRef]
    @State private var open = false

    var body: some View {
        let list = uniqueHosts(sources)
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Button { withAnimation(.spring(response: 0.38, dampingFraction: 0.85)) { open.toggle() } } label: {
                    HStack(spacing: 7) {
                        HStack(spacing: -5) { ForEach(Array(list.prefix(3))) { Favicon(host: $0.host, size: 16) } }
                        Text("Sources").font(.system(size: 12, weight: .medium))
                        Text("\(sources.count)").font(.system(size: 11).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                        Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).rotationEffect(.degrees(open ? 90 : 0)).foregroundStyle(.white.opacity(0.5))
                    }
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(Capsule().fill(Color.white.opacity(0.07)))
                    .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                if open {
                    HStack(spacing: 5) {
                        ForEach(list.prefix(10)) { source in
                            Favicon(host: source.host, size: 24).help(source.title ?? source.host)
                                .onTapGesture { if let url = URL(string: source.url) { NSWorkspace.shared.open(url) } }
                        }
                    }
                    .transition(.opacity.combined(with: .offset(x: -8)))
                }
            }
        }
    }
}

// MARK: Plan

/// The agent's plan, as in Clyra's chat: a compact pill (a ring that fills as work completes, the current task, N/M, a chevron).
/// Pointing at it peeks it open, clicking pins it open, and when the last task completes it folds itself away.
struct PlanPill: View {
    let todos: [TodoItem]
    var reduceMotion = false
    @State private var pinned = false
    @State private var peek = false
    @State private var settled = false

    private var done: Int { todos.filter { $0.status == "completed" }.count }
    private var allDone: Bool { !todos.isEmpty && done == todos.count }
    private var current: TodoItem? { todos.first { $0.status == "in_progress" } ?? todos.first { $0.status == "pending" } }

    var body: some View {
        let open = pinned || (peek && !settled) || (allDone && !settled)
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.85)) { pinned.toggle() } } label: {
                HStack(spacing: 9) {
                    ZStack {
                        Circle().stroke(Color.white.opacity(0.14), lineWidth: 2)
                        Circle().trim(from: 0, to: CGFloat(done) / CGFloat(max(1, todos.count)))
                            .stroke(allDone ? Color.white.opacity(0.9) : ClyraTint.blueSoft, style: StrokeStyle(lineWidth: 2, lineCap: .round)).rotationEffect(.degrees(-90))
                        Image(systemName: "checklist").font(.system(size: 9)).foregroundStyle(.white.opacity(0.75))
                    }
                    .frame(width: 22, height: 22)
                    Text(allDone ? "All tasks done" : (current?.content ?? "To-dos")).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
                        .contentTransition(.opacity)
                    Spacer(minLength: 6)
                    Text("\(done)/\(todos.count)").font(.system(size: 11.5, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                        .contentTransition(.numericText())
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 10).frame(height: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 0) { ForEach(todos) { PlanRow(item: $0, reduceMotion: reduceMotion) } }
                    .padding(.horizontal, 12).padding(.bottom, 8)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(RoundedRectangle(cornerRadius: open ? 18 : 18, style: .continuous).fill(Color.white.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        .frame(maxWidth: 380)
        .frame(maxWidth: .infinity)
        .onHover { inside in if inside { peek = true } else { peek = false } }
        .animation(reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.85), value: open)
        .animation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.85), value: done)
        .onChange(of: allDone) { _, now in
            if now { DispatchQueue.main.asyncAfter(deadline: .now() + 0.88) { settled = true } } else { settled = false }
        }
    }
}

struct PlanRow: View {
    let item: TodoItem
    var reduceMotion = false
    var body: some View {
        let state = item.status
        HStack(alignment: .top, spacing: 8) {
            ZStack {
                Circle().strokeBorder(state == "pending" ? Color.white.opacity(0.28) : ClyraTint.blueSoft, lineWidth: 1.3)
                if state == "completed" {
                    Circle().fill(ClyraTint.blueSoft)
                    Image(systemName: "checkmark").font(.system(size: 7.5, weight: .heavy)).foregroundStyle(.black)
                        .transition(.scale.combined(with: .opacity))
                } else if state == "in_progress" {
                    Circle().fill(ClyraTint.blueSoft).frame(width: 5, height: 5)
                }
            }
            .frame(width: 14, height: 14).padding(.top, 1)
            Text(item.content)
                .font(.system(size: 12, weight: state == "in_progress" ? .medium : .regular))
                .foregroundStyle(state == "completed" ? Color.white.opacity(0.4) : (state == "in_progress" ? .white : Color.white.opacity(0.7)))
                .strikethrough(state == "completed", color: .white.opacity(0.3))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.8), value: state)
    }
}

// MARK: Markdown

/// Headings, lists, quotes and code blocks as Clyra renders them; inline styling (bold, italic, links, code) via Markdown.
struct MarkdownView: View {
    let text: String

    private enum Block { case heading(Int, String), paragraph(String), bullets([String]), numbers([String]), code(String), quote(String) }

    private var blocks: [Block] {
        var out: [Block] = []
        var para: [String] = []
        var bullets: [String] = [], numbers: [String] = [], code: [String] = [], quote: [String] = []
        var inCode = false
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))); para = [] }
            if !bullets.isEmpty { out.append(.bullets(bullets)); bullets = [] }
            if !numbers.isEmpty { out.append(.numbers(numbers)); numbers = [] }
            if !quote.isEmpty { out.append(.quote(quote.joined(separator: "\n"))); quote = [] }
        }
        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("```") {
                if inCode { out.append(.code(code.joined(separator: "\n"))); code = []; inCode = false } else { flush(); inCode = true }
                continue
            }
            if inCode { code.append(line); continue }
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { flush(); continue }
            if let h = t.range(of: #"^#{1,4} "#, options: .regularExpression) {
                flush()
                out.append(.heading(t[h].count - 1, String(t[h.upperBound...])))
            } else if t.hasPrefix("- ") || t.hasPrefix("* ") || t.hasPrefix("• ") {
                if !para.isEmpty || !numbers.isEmpty || !quote.isEmpty { flush() }
                bullets.append(String(t.dropFirst(2)))
            } else if let n = t.range(of: #"^\d+[.)] "#, options: .regularExpression) {
                if !para.isEmpty || !bullets.isEmpty || !quote.isEmpty { flush() }
                numbers.append(String(t[n.upperBound...]))
            } else if t.hasPrefix("> ") {
                if !para.isEmpty || !bullets.isEmpty || !numbers.isEmpty { flush() }
                quote.append(String(t.dropFirst(2)))
            } else {
                if !bullets.isEmpty || !numbers.isEmpty || !quote.isEmpty { flush() }
                para.append(t)
            }
        }
        if inCode { out.append(.code(code.joined(separator: "\n"))) }
        flush()
        return out
    }

    private func inline(_ s: String) -> Text {
        if let attributed = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) { return Text(attributed) }
        return Text(s)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let level, let s):
                    inline(s).font(.system(size: level == 1 ? 17 : level == 2 ? 15.5 : 14, weight: .semibold)).padding(.top, 2)
                case .paragraph(let s):
                    inline(s).font(.system(size: 13.5)).lineSpacing(3)
                case .bullets(let items):
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .top, spacing: 8) {
                                Circle().fill(Color.white.opacity(0.5)).frame(width: 4, height: 4).padding(.top, 8)
                                inline(item).font(.system(size: 13.5)).lineSpacing(3)
                            }
                        }
                    }
                case .numbers(let items):
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(index + 1).").font(.system(size: 13.5).monospacedDigit()).foregroundStyle(.white.opacity(0.5)).frame(minWidth: 18, alignment: .trailing)
                                inline(item).font(.system(size: 13.5)).lineSpacing(3)
                            }
                        }
                    }
                case .quote(let s):
                    HStack(spacing: 9) {
                        Capsule().fill(Color.white.opacity(0.25)).frame(width: 2.5)
                        inline(s).font(.system(size: 13.5)).foregroundStyle(.white.opacity(0.7)).lineSpacing(3)
                    }
                case .code(let s):
                    ScrollView(.horizontal) {
                        Text(s).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.9)).textSelection(.enabled).padding(11)
                    }
                    .scrollIndicators(.never)
                    .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white.opacity(0.06)))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(Color.white.opacity(0.09), lineWidth: 1))
                }
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Message

struct ChatBubble: View {
    @ObservedObject var model: NotchModel
    let msg: ChatMessage
    let isLast: Bool
    @State private var copied = false

    private var reduce: Bool { model.reduceMotion }

    var body: some View {
        if msg.isUser {
            Text(msg.text)
                .font(.system(size: 13.5))
                .textSelection(.enabled)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(0.11)))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.leading, 60)
        } else {
            let steps = msg.steps
            VStack(alignment: .leading, spacing: 9) {
                if !steps.isEmpty {
                    StepList(steps: steps, live: msg.streaming, reduceMotion: reduce) { id in model.openClyra(path: "notes#\(id)") }
                }
                if msg.streaming && msg.text.isEmpty && steps.allSatisfy({ $0.state != "running" }) {
                    ThinkingLine(reduceMotion: reduce)
                }
                if !msg.text.isEmpty {
                    MarkdownView(text: msg.text)
                        .foregroundStyle(msg.failed ? Color.orange : .white)
                }
                if !msg.streaming {
                    ResearchResults(steps: msg.allSteps)
                    SourcesInline(sources: msg.citations)
                }
                if msg.stopped { Text("Stopped").font(.system(size: 11)).foregroundStyle(.white.opacity(0.45)) }
                if !msg.streaming && !msg.text.isEmpty {
                    HStack(spacing: 2) {
                        ComposerButton(symbol: copied ? "checkmark" : "doc.on.doc", label: "Copy") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(msg.text, forType: .string)
                            copied = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false }
                        }
                        if isLast { ComposerButton(symbol: "arrow.counterclockwise", label: "Try again") { model.chat.regenerate() } }
                    }
                    .padding(.leading, -6)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension Notification.Name { static let notchDebugEffort = Notification.Name("notchDebugEffort") }

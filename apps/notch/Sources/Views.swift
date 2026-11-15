import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Geometry

enum Metrics {
    static let notchWidth: CGFloat = 186        // M2 MacBook Air notch proportions
    // Boring Notch, boringNotch/sizing/matters.swift and ContentView.swift.
    static let collapsedRadius: CGFloat = 14
    static let expandedRadius: CGFloat = 24
    static let ear: CGFloat = 6
    static let expandedEar: CGFloat = 19
    static let panelWidth: CGFloat = 640
    /// Everything inside an open notch is designed at full size and drawn at this fraction, so it stays compact
    /// while keeping every size, gap and position in proportion.
    static let scale: CGFloat = 0.76
    /// The part of the design height that the real menu-bar inset replaces.
    static let designTop: CGFloat = 26
    static let sidebarWidth: CGFloat = 220
    static let maximumPanelHeight: CGFloat = 420
    static let wing: CGFloat = 62
    static let hoverDelay: TimeInterval = 0.10
    static let releaseDelay: TimeInterval = 0.08

    /// Width the page is designed at; the chat gains the sidebar's width when it is open.
    static func designWidth(_ model: NotchModel) -> CGFloat {
        model.view == .chat && model.sidebarOpen ? panelWidth + sidebarWidth : panelWidth
    }

    /// One width for every expanded page, so switching tabs never makes the notch lurch sideways.
    static func width(_ model: NotchModel) -> CGFloat {
        model.expanded ? designWidth(model) * scale : collapsedWidth(model)
    }

    /// Real height of the open notch: the design content scaled, under the real menu-bar inset.
    static func height(_ model: NotchModel, menuBar: CGFloat) -> CGFloat {
        model.expanded ? (panelHeight(model) - designTop) * scale + menuBar + 2 : compactHeight(menuBar, model)
    }

    /// Narrow pages centre in the shared width instead of stretching across it.
    static func contentWidth(_ view: NotchView) -> CGFloat? {
        switch view {
        case .home, .apps: return 540
        case .media: return 430
        case .timer, .stopwatch, .alarm, .bluetooth, .airdrop: return 500
        case .more, .note: return 560
        default: return nil
        }
    }

    static func compactHeight(_ menuBar: CGFloat, _ model: NotchModel) -> CGFloat {
        if model.flowActive { return max(menuBar + 22, 46) }
        return model.hasActivity || model.banner != nil || model.working != nil || model.doneMessage != nil ? max(menuBar, 31) : menuBar
    }

    static func collapsedWidth(_ model: NotchModel) -> CGFloat {
        if model.flowActive { return 336 }
        if model.banner != nil { return 338 }
        if model.working != nil || model.doneMessage != nil { return 392 }
        if model.hasPlayingMedia { return model.secondaryActivities.isEmpty ? 382 : 522 }
        return notchWidth + 2 * ear + (model.hasActivity ? 2 * wing : 0)
    }

    static func panelHeight(_ m: NotchModel) -> CGFloat {
        switch m.view {
        case .home: return 306
        case .apps: return 172
        case .timer: return m.activeTimer != nil && !m.showTimerSetup ? 255 : 365
        case .chat: return m.sidebarOpen ? maximumPanelHeight : 400
        case .weather: return 340
        case .more: return 232
        case .media: return 210
        case .alarm, .bluetooth, .airdrop: return 320
        case .browser: return 390
        case .widgets: return m.widgetsEditing ? maximumPanelHeight : min(maximumPanelHeight, CGFloat(max(1, m.widgetRows)) * 110 + 116)
        case .stopwatch: return 255
        case .note: return 250
        case .settings: return maximumPanelHeight
        }
    }
}

/// The notch outline: flush with the top edge, concave ears into the menu bar, rounded bottom.
struct NotchShape: Shape {
    var bottomRadius: CGFloat
    var ear: CGFloat = Metrics.ear
    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { .init(ear, bottomRadius) }
        set { (ear, bottomRadius) = (newValue.first, newValue.second) }
    }

    func path(in r: CGRect) -> Path {
        Path(NotchMotion.silhouette(in: r, ear: ear, radius: bottomRadius))
    }
}

// MARK: Root

struct NotchRoot: View {
    @ObservedObject var model: NotchModel
    let menuBarHeight: CGFloat
    var drawsSilhouette = true
    var onClickCollapsed: () -> Void

    var body: some View {
        let h = Metrics.height(model, menuBar: menuBarHeight)
        let ear = model.expanded ? Metrics.expandedEar : Metrics.ear
        let shape = NotchShape(bottomRadius: model.expanded ? Metrics.expandedRadius : Metrics.collapsedRadius, ear: ear)
            ZStack(alignment: .top) {
                if drawsSilhouette { Color.black }
                if model.expanded {
                    GeometryReader { geo in
                        let s = Metrics.scale
                        let contentH = max(0, geo.size.height - menuBarHeight - 2)
                        PanelContent(model: model)
                            .padding(.horizontal, Metrics.expandedEar + 12)
                            .padding(.bottom, 12)
                            .frame(width: geo.size.width / s, height: contentH / s, alignment: .top)
                            .scaleEffect(s, anchor: .topLeading)
                            .frame(width: geo.size.width, height: contentH, alignment: .topLeading)
                            .offset(y: menuBarHeight + 2)
                    }
                    .transition(.opacity)
                } else {
                    CollapsedContent(model: model, height: h)
                        .padding(.horizontal, Metrics.ear)
                        .transition(.opacity)
                }
                if let banner = model.banner, model.expanded, model.view != .airdrop {
                    ConnectionBanner(model: model, banner: banner)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black)
                    .padding(.top, menuBarHeight)
                    .allowsHitTesting(banner.deviceName != nil)
                    .onHover { inside in
                        if inside, banner.deviceName != nil {
                            model.show(.bluetooth)
                            model.clearConnectionBanner()
                        }
                    }
                    .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipShape(shape)
            .overlay(alignment: .top) {
                if drawsSilhouette { Color.black.frame(height: 1).padding(.horizontal, ear).allowsHitTesting(false) }
            }
            .contentShape(Rectangle())
            .onTapGesture { if !model.expanded { onClickCollapsed() } }
        .animation(model.reduceMotion ? nil : .spring(response: NotchMotion.openResponse, dampingFraction: NotchMotion.openDamping), value: model.view)
        .animation(model.reduceMotion ? nil : .easeInOut(duration: 0.14), value: model.banner)
        .animation(model.reduceMotion ? nil : .spring(response: model.expanded ? NotchMotion.openResponse : NotchMotion.closeResponse,
                                                      dampingFraction: model.expanded ? NotchMotion.openDamping : NotchMotion.closeDamping), value: model.expanded)
        .environment(\.colorScheme, .dark)
    }
}

/// Playback occupies the middle of the software notch with other activities beside it.
struct CollapsedContent: View {
    @ObservedObject var model: NotchModel
    let height: CGFloat

    var body: some View {
        ZStack {
            if model.flowActive {
                FlowStrip(flow: model.flow, reduceMotion: model.reduceMotion)
            } else if let banner = model.banner {
                ConnectionBanner(model: model, banner: banner)
            } else if let note = model.doneMessage {
                // The AI's own closing line, in white, while the notch glows once to say it is finished.
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 12.5)).foregroundStyle(Color(red: 0.35, green: 0.84, blue: 0.5))
                    Text(note).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                }
                .frame(maxWidth: 360)
                .transition(.opacity)
            } else if let work = model.working {
                // Clyra is mid-reply: the same tool line the chat shows, so the notch says what it is doing even closed.
                HStack(spacing: 8) {
                    Image(systemName: work.symbol).font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                    ShimmerText(text: work.label, reduceMotion: model.reduceMotion, size: 12.5)
                    if !work.sources.isEmpty { SourceStrip(sources: work.sources, reduceMotion: model.reduceMotion) }
                }
                .frame(maxWidth: 360)
            } else if let track = model.media.state, model.hasPlayingMedia {
                HStack(spacing: 8) {
                    PlayerIcon(track: track, size: 18)
                    Text(track.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    PlaybackBars(reduceMotion: model.reduceMotion, meter: model.audioMeter)
                }.frame(maxWidth: 280)
                HStack {
                    if let left = model.secondaryActivities.dropFirst().first { indicator(left) }
                    Spacer()
                    if let right = model.secondaryActivities.first { indicator(right) }
                }.font(.system(size: 10, weight: .medium))
            } else {
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    ForEach(model.secondaryActivities.filter { $0 != .alarm }, id: \.rawValue) { indicator($0) }
                    Spacer(minLength: 0)
                    if model.secondaryActivities.contains(.alarm) { indicator(.alarm) }
                }
            }
        }
        .font(.system(size: 15, weight: .medium).monospacedDigit())
        .lineLimit(1)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity)
        .frame(height: height)
    }

    @ViewBuilder private func indicator(_ kind: NotchView) -> some View {
        switch kind {
        case .timer:
            if let timer = model.timers.soonest { Label(TimerEngine.clock(timer.remaining(at: model.now)), systemImage: "timer").foregroundStyle(.orange) }
        case .stopwatch:
            HStack(spacing: 4) { Image(systemName: "stopwatch"); StopwatchReadout(model: model, size: model.hasPlayingMedia ? 10 : 15) }.foregroundStyle(.green)
        case .alarm:
            if let alarm = model.alarms.upcoming?.alarm { Label(alarm.label, systemImage: "alarm").foregroundStyle(.orange) }
        default: EmptyView()
        }
    }
}

struct ConnectionBanner: View {
    @ObservedObject var devices: BluetoothPanelModel
    let banner: NotchBanner
    init(model: NotchModel, banner: NotchBanner) { self.devices = model.bluetoothPanel; self.banner = banner }
    var body: some View {
        HStack(spacing: 8) {
            Label(banner.title, systemImage: banner.symbol).font(.system(size: 14, weight: .semibold))
            Text(banner.detail).font(.system(size: 12)).foregroundStyle(.secondary)
            if let name = banner.deviceName, let level = devices.battery[name]?.ring { BatteryRing(percent: level) }
        }.lineLimit(1)
    }
}

struct PlayerIcon: View {
    let track: MediaState
    let size: CGFloat
    var body: some View {
        Group {
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: track.bundleID) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: url.path)).resizable()
            } else {
                Image(systemName: "music.note").resizable().scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(track.source)
    }
}

struct PlaybackBars: View {
    let reduceMotion: Bool
    @ObservedObject var meter: AudioMeter
    var body: some View {
            HStack(spacing: 2) {
                ForEach(0..<4) { index in
                    let weights = [0.62, 1.0, 0.82, 0.48]
                    let level = reduceMotion ? 0.25 : Double(meter.level) * weights[index]
                    Capsule().frame(width: 2, height: 4 + level * 10)
                }
            }
            .foregroundStyle(.white)
            .frame(width: 15, height: 15)
            .animation(reduceMotion ? nil : .linear(duration: 0.045), value: meter.level)
        .accessibilityHidden(true)
    }
}

struct Artwork: View {
    let image: NSImage?
    let size: CGFloat
    let radius: CGFloat
    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    Color.white.opacity(0.08)
                    Image(systemName: "music.note").font(.system(size: size * 0.4)).foregroundStyle(.secondary)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

// MARK: Panel

struct PanelContent: View {
    @ObservedObject var model: NotchModel
    private var tabbed: Bool { model.view == .home || model.view == .apps || model.view == .widgets }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // One tab bar for the top-level pages, outside the page swap, so its highlight slides between tabs.
            if tabbed { TabHeader(model: model).transition(.opacity) }
            ZStack(alignment: .top) {
                switch model.view {
                case .home: WelcomeView(model: model).transition(.opacity)
                case .apps: AppsView(model: model).transition(.opacity)
                case .timer: TimerView(model: model).transition(.opacity)
                case .chat: ChatView(model: model).transition(.opacity)
                case .weather: WeatherView(model: model).transition(.opacity)
                case .more: MoreView(model: model).transition(.opacity)
                case .stopwatch: StopwatchView(model: model).transition(.opacity)
                case .note: NoteView(model: model).transition(.opacity)
                case .settings: SettingsView(model: model).transition(.opacity)
                case .media: MediaView(model: model).transition(.opacity)
                case .browser: BrowserView(model: model).transition(.opacity)
                case .widgets: WidgetsView(model: model).transition(.opacity)
                case .alarm: AlarmView(model: model).transition(.opacity)
                case .bluetooth: BluetoothView(model: model).transition(.opacity)
                case .airdrop: NotchAirDropView(model: model).transition(.opacity)
                }
            }
            .frame(maxWidth: Metrics.contentWidth(model.view) ?? .infinity, maxHeight: .infinity, alignment: .top)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .font(.system(size: 13))
        .foregroundStyle(.white)
    }
}

/// Home · Apps · Widgets, with the time and weather at the other end.
struct TabHeader: View {
    @ObservedObject var model: NotchModel
    @Namespace private var highlight
    private let tabs: [(view: NotchView, title: String, symbol: String)] = [
        (.home, "Home", "sparkle"), (.apps, "Apps", "circle.grid.2x2"), (.widgets, "Widgets", "square.grid.2x2"),
    ]

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 2) {
                ForEach(tabs, id: \.view) { tab in
                    let on = model.view == tab.view
                    Button { model.show(tab.view) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: tab.symbol).font(.system(size: 10, weight: .semibold))
                            Text(tab.title).font(.system(size: 11, weight: .medium))
                        }
                        .foregroundStyle(on ? Color.white : Color.white.opacity(0.5))
                        .padding(.horizontal, 10).frame(height: 24)
                        .background {
                            if on { Capsule().fill(Color.white.opacity(0.15)).matchedGeometryEffect(id: "tab", in: highlight) }
                        }
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tab.title)
                }
            }
            .padding(2)
            .background(Capsule().fill(Color.white.opacity(0.06)))
            .animation(model.reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.78), value: model.view)
            Spacer()
            Text(model.now.formatted(.dateTime.hour().minute()))
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
            if let r = model.weather.report {
                Button { model.show(.weather) } label: {
                    HStack(spacing: 4) {
                        Image(systemName: WeatherCode.symbol(r.code, day: r.isDay)).symbolRenderingMode(.multicolor)
                        Text("\(Int(r.temp.rounded()))°").monospacedDigit()
                    }
                    .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.plain)
                .help("\(r.place) · \(WeatherCode.text(r.code))")
            }
        }
        .frame(height: 28)
    }
}

struct IconButton: View {
    let symbol: String
    var size: CGFloat = 14
    var label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .medium))
                .frame(width: size + 16, height: size + 14)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(hover ? 0.12 : 0)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(label)
        .accessibilityLabel(label)
    }
}

struct Header: View {
    @ObservedObject var model: NotchModel
    var title: String?
    var body: some View {
        HStack(spacing: 6) {
            if let title {
                IconButton(symbol: "chevron.left", size: 11, label: "Back") { model.goBack() }
                    .padding(.leading, -8)
                Text(title).font(.system(size: 13, weight: .semibold))
            } else {
                Text(model.now.formatted(.dateTime.hour().minute()))
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                Text(model.now.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            IconButton(symbol: "square.grid.2x2", size: 11, label: "Widgets") { model.show(.widgets) }
            if let r = model.weather.report {
                Button { model.show(.weather) } label: {
                    HStack(spacing: 4) {
                        Image(systemName: WeatherCode.symbol(r.code, day: r.isDay)).symbolRenderingMode(.multicolor)
                        Text("\(Int(r.temp.rounded()))°").monospacedDigit()
                    }
                    .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.plain)
                .help("\(r.place) · \(WeatherCode.text(r.code))")
            }
        }
        .frame(height: 22)
    }
}

struct AppsView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 4) {
                QuickAction(symbol: "timer", label: "Timer") { model.show(.timer) }
                QuickAction(symbol: "bubble.left", label: "Chat") { model.show(.chat) }
                QuickAction(symbol: model.weather.report.map { WeatherCode.symbol($0.code, day: $0.isDay) } ?? "cloud.sun", label: "Weather") { model.show(.weather) }
                QuickAction(symbol: "ellipsis", label: "More") { model.show(.more) }
            }
            ClyraComposer(model: model, compact: true)
        }
    }
}

enum ClyraTint {
    static let blue = Color(red: 0.0, green: 0.32, blue: 0.98)
    static let blueSoft = Color(red: 0.36, green: 0.57, blue: 1.0)
}

struct ClyraMark: View {
    var size: CGFloat = 18
    var body: some View {
        Text("C")
            .font(.system(size: size * 0.58, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                .fill(LinearGradient(colors: [ClyraTint.blueSoft, ClyraTint.blue], startPoint: .top, endPoint: .bottom)))
            .shadow(color: ClyraTint.blue.opacity(0.5), radius: 6)
    }
}

/// Clyra's chat welcome, drawn for the notch: the blue ball, the same question, the same composer and shortcuts.
struct WelcomeView: View {
    @ObservedObject var model: NotchModel
    @State private var shown = false
    private func rise(_ delay: Double) -> some ViewModifier { Rise(shown: shown, delay: delay, reduce: model.reduceMotion) }
    private let shortcuts: [(symbol: String, title: String, prefix: String)] = [
        ("checkmark", "Continue", ""), ("chevron.left.forwardslash.chevron.right", "Build", "Build "), ("globe", "Research", "Research "), ("pencil", "Write", "Write "),
    ]

    var body: some View {
        VStack(spacing: 10) {
            ClyraBlob(size: 56, reduceMotion: model.reduceMotion).modifier(rise(0))
            VStack(spacing: 4) {
                (Text(model.chat.profileName.isEmpty ? "Where should we start?" : "Where should we start, ")
                    + Text(model.chat.profileName).foregroundColor(ClyraTint.blueSoft)
                    + Text(model.chat.profileName.isEmpty ? "" : "?"))
                    .font(.system(size: 23, weight: .bold)).tracking(-0.7)
                (Text("Type ") + Text("/").foregroundColor(ClyraTint.blueSoft).bold() + Text(" to bring in Drive, Gmail or the live web — or just ask."))
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
            }
            .modifier(rise(0.05))
            ClyraComposer(model: model).modifier(rise(0.1))
            HStack(spacing: 4) {
                ForEach(shortcuts, id: \.title) { item in
                    ShortcutChip(symbol: item.symbol, title: item.title) {
                        if item.title == "Continue" {
                            if let latest = model.chat.recent.first { model.chat.open(latest) }
                            model.show(.chat)
                        } else {
                            model.chatDraft = item.prefix
                            model.onKeyboardFocus?()
                        }
                    }
                }
            }
            .modifier(rise(0.15))
        }
        .frame(maxWidth: .infinity)
        .background(alignment: .top) {
            // Soft blue light behind the ball, like the glow on Clyra's own welcome. Static, so it costs nothing to run.
            RadialGradient(colors: [ClyraTint.blue.opacity(0.26), .clear], center: .center, startRadius: 0, endRadius: 140)
                .frame(width: 300, height: 300).offset(y: -92)
                .allowsHitTesting(false)
        }
        .onAppear { shown = true }
        .onDisappear { shown = false }
    }
}

struct ShortcutChip: View {
    let symbol: String
    let title: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 11, weight: .regular))
                Text(title).font(.system(size: 12.5, weight: .medium))
            }
            .foregroundStyle(.white.opacity(hover ? 1 : 0.78))
            .padding(.horizontal, 12).frame(height: 28)
            .background(Capsule().fill(Color.white.opacity(hover ? 0.1 : 0)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.15), value: hover)
    }
}

struct Rise: ViewModifier {
    let shown: Bool
    let delay: Double
    let reduce: Bool
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduce ? 0 : 8)
            .animation(reduce ? nil : .spring(response: 0.5, dampingFraction: 0.82).delay(delay), value: shown)
    }
}

struct QuickAction: View {
    let symbol: String
    let label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: symbol).font(.system(size: 15, weight: .regular)).frame(height: 18)
                Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(hover ? 0.1 : 0.05)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct NowPlaying: View {
    @ObservedObject var model: NotchModel
    let state: MediaState
    var body: some View {
        HStack(spacing: 10) {
            Artwork(image: model.media.artwork, size: 52, radius: 8)
                .onTapGesture { model.show(.media) }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(state.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    if state.status == .paused {
                        Text("Paused").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                    }
                }
                Text(state.artist).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                if let d = state.duration, d > 0, let p = state.position(at: model.now) {
                    HStack(spacing: 6) {
                        Text(TimerEngine.clock(p)).monospacedDigit()
                        GeometryReader { g in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.15))
                                Capsule().fill(Color.white.opacity(0.85)).frame(width: max(0, g.size.width * CGFloat(p / d)))
                            }
                        }
                        .frame(height: 3)
                        Text(TimerEngine.clock(d)).monospacedDigit()
                    }
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                    .animation(.linear(duration: 1), value: p)
                }
                HStack(spacing: 4) {
                    Image(systemName: state.source == "Spotify" ? "dot.radiowaves.left.and.right" : "music.note")
                        .font(.system(size: 9))
                    Text(state.source).font(.system(size: 10))
                }
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            HStack(spacing: 0) {
                IconButton(symbol: "backward.fill", size: 13, label: "Previous") { model.media.command("previous") }
                IconButton(symbol: state.status == .playing ? "pause.fill" : "play.fill", size: 17, label: state.status == .playing ? "Pause" : "Play") { model.media.command("toggle") }
                IconButton(symbol: "forward.fill", size: 13, label: "Next") { model.media.command("next") }
            }
        }
    }
}

// MARK: Timer

struct TimerView: View {
    @ObservedObject var model: NotchModel
    @State private var h = 0
    @State private var m = 5
    @State private var s = 0
    @State private var label = ""
    private var adding: Bool { model.showTimerSetup }
    private var active: NotchTimer? { model.activeTimer }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Header(model: model, title: "Timers")
                if active != nil {
                    IconButton(symbol: adding ? "xmark" : "plus", label: adding ? "Close new timer" : "New timer") {
                        model.showTimerSetup.toggle()
                        model.onLayoutChange?()
                    }
                }
            }
            if let active, !adding {
                VStack(spacing: 8) {
                Text(TimerEngine.clock(active.remaining(at: model.now)))
                    .font(.system(size: 52, weight: .light).monospacedDigit())
                    .foregroundStyle(.orange)
                Text(active.label).foregroundStyle(.secondary)
                HStack(spacing: 22) {
                    let running = active.status == .running
                    IconButton(symbol: "arrow.counterclockwise", label: "Restart timer") { model.timers.restart(active.id) }
                    Button {
                        if running { model.timers.pause(active.id) } else { model.timers.resume(active.id) }
                    } label: {
                        Image(systemName: running ? "pause.fill" : "play.fill")
                            .frame(width: 44, height: 44).background(.orange.opacity(0.23), in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel(running ? "Pause timer" : "Resume timer")
                    IconButton(symbol: "xmark", label: "Cancel timer") { model.timers.cancel(active.id) }
                }
                let others = model.timers.timers.filter { $0.status != .done && $0.id != active.id }
                if !others.isEmpty {
                    Menu("Other active timers") {
                        ForEach(others) { timer in
                            Button("\(timer.label) · \(TimerEngine.clock(timer.remaining(at: model.now)))") {
                                model.selectedTimerID = timer.id
                            }
                        }
                    }.menuStyle(.borderlessButton).fixedSize()
                }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                setup
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var setup: some View {
        VStack(spacing: 12) {
            DurationWheels(hours: $h, minutes: $m, seconds: $s)
            HStack(spacing: 6) {
                ForEach([5, 10, 15, 25, 60], id: \.self) { mins in
                    Button("\(mins) min") { start(TimeInterval(mins * 60)) }
                        .buttonStyle(Pill())
                }
            }
            TextField("Label (optional)", text: $label)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 230)
                .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?() })
            Button { start(TimeInterval(h * 3600 + m * 60 + s)) } label: {
                Label("Start", systemImage: "play.fill").foregroundStyle(.green)
            }.buttonStyle(Pill()).disabled(h + m + s == 0)
        }
    }

    func start(_ secs: TimeInterval) {
        model.requestNotificationPermission()
        model.selectedTimerID = model.timers.start(seconds: secs, label: label).id
        label = ""
        model.showTimerSetup = false
        model.onLayoutChange?()
    }
}

struct DurationWheels: View {
    @Binding var hours: Int
    @Binding var minutes: Int
    @Binding var seconds: Int

    var body: some View {
        HStack(spacing: 8) {
            TimeWheel(unit: "hours", value: $hours, range: 0...23)
            TimeWheel(unit: "min", value: $minutes, range: 0...59)
            TimeWheel(unit: "sec", value: $seconds, range: 0...59)
        }
        .frame(maxWidth: 335)
        .frame(maxWidth: .infinity)
    }
}

struct TimerRow: View {
    @ObservedObject var model: NotchModel
    let t: NotchTimer
    var featured = false
    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(t.status == .done ? "Done" : TimerEngine.clock(t.remaining(at: model.now)))
                    .font(.system(size: featured ? 38 : 17, weight: featured ? .light : .medium).monospacedDigit())
                    .foregroundStyle(t.status == .running ? Color.orange : (t.status == .done ? .green : .white))
                Text(t.label).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if t.status == .running {
                IconButton(symbol: "pause.fill", size: 12, label: "Pause") { model.timers.pause(t.id) }
            } else if t.status == .paused {
                IconButton(symbol: "play.fill", size: 12, label: "Resume") { model.timers.resume(t.id) }
            }
            IconButton(symbol: "arrow.counterclockwise", size: 12, label: "Restart") { model.timers.restart(t.id) }
            IconButton(symbol: "xmark", size: 11, label: "Cancel") { model.timers.cancel(t.id) }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.05)))
    }
}

struct Pill: ButtonStyle {
    var prominent = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 10).frame(height: 26)
            .background(Capsule().fill(prominent ? Color.accentColor.opacity(configuration.isPressed ? 0.7 : 1) : Color.white.opacity(configuration.isPressed ? 0.18 : 0.09)))
            .contentShape(Capsule())
    }
}

// MARK: Chat

struct ChatView: View {
    @ObservedObject var model: NotchModel
    @AppStorage("notchShowPlan") private var showPlan = true
    @AppStorage("notchAutoScroll") private var autoScroll = true

    var body: some View {
        let todos = showPlan ? model.chat.planTodos : []
        let messages = model.chat.chat.messages
        HStack(alignment: .top, spacing: 0) {
            if model.sidebarOpen {
                ChatSidebar(model: model)
                    .transition(.asymmetric(insertion: .move(edge: .leading).combined(with: .opacity), removal: .move(edge: .leading).combined(with: .opacity)))
                Rectangle().fill(Color.white.opacity(0.08)).frame(width: 1).padding(.horizontal, 12)
                    .transition(.opacity)
            }
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 4) {
                        if !model.sidebarOpen {
                            IconButton(symbol: "sidebar.left", size: 12, label: "Show chats") { model.toggleSidebar() }
                        }
                        Text(model.chat.chat.title == "New Chat" ? "Clyra" : model.chat.chat.title)
                            .font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        Spacer(minLength: 6)
                        IconButton(symbol: "square.and.pencil", size: 12, label: "New Chat") { model.chat.newConversation() }
                        IconButton(symbol: "arrow.up.forward.app", size: 12, label: "Open in Clyra") { model.openClyra() }
                        IconButton(symbol: "xmark", size: 10, label: "Back") { model.show(.home) }
                    }
                    .frame(height: 24)
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                if messages.isEmpty {
                                    Text("Ask Clyra anything. This is the same conversation as in Clyra, so you can pick it up on either screen.")
                                        .font(.system(size: 12)).foregroundStyle(.secondary)
                                }
                                ForEach(Array(messages.enumerated()), id: \.element.id) { index, msg in
                                    ChatBubble(model: model, msg: msg, isLast: index == messages.count - 1)
                                }
                                Color.clear.frame(height: 1).id("end")
                            }
                            .padding(.trailing, 2)
                        }
                        .scrollIndicators(.never)
                        .onChange(of: messages.last?.text) { _, _ in if autoScroll { proxy.scrollTo("end", anchor: .bottom) } }
                        .onChange(of: messages.last?.steps.count) { _, _ in if autoScroll { proxy.scrollTo("end", anchor: .bottom) } }
                        .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                    }
                    // The plan sits above the composer as Clyra's chat does, only while it is needed.
                    if !todos.isEmpty {
                        PlanPill(todos: todos, reduceMotion: model.reduceMotion)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    ClyraComposer(model: model, compact: true)
                }
            }
        }
        .animation(model.reduceMotion ? nil : .spring(response: 0.45, dampingFraction: 0.82), value: todos.isEmpty)
        .animation(model.reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.82), value: model.sidebarOpen)
    }
}

// MARK: Weather

struct WeatherView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Header(model: model, title: "Weather")
                IconButton(symbol: "arrow.clockwise", size: 11, label: "Refresh") { model.weather.refresh(force: true) }
            }
            CitySearch(model: model)
            if let r = model.weather.report {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.place).font(.system(size: 13, weight: .semibold))
                        Text("\(Int(r.temp.rounded()))°").font(.system(size: 34, weight: .light).monospacedDigit())
                        Text(WeatherCode.text(r.code)).font(.system(size: 12))
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 3) {
                        Image(systemName: WeatherCode.symbol(r.code, day: r.isDay)).symbolRenderingMode(.multicolor).font(.system(size: 28))
                        Text("Feels like \(Int(r.feelsLike.rounded()))°")
                        Text("H:\(Int(r.todayMax.rounded()))°  L:\(Int(r.todayMin.rounded()))°")
                    }
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                ScrollView(.horizontal) {
                    HStack(spacing: 14) {
                        ForEach(r.hours, id: \.time) { h in
                            VStack(spacing: 4) {
                                Text(h.time.formatted(.dateTime.hour())).font(.system(size: 11)).foregroundStyle(.secondary)
                                Image(systemName: WeatherCode.symbol(h.code)).symbolRenderingMode(.multicolor).font(.system(size: 13))
                                Text("\(Int(h.temp.rounded()))°").font(.system(size: 12).monospacedDigit())
                                Text(h.rain > 0 ? "\(h.rain)%" : " ").font(.system(size: 10)).foregroundStyle(.cyan)
                            }
                        }
                    }
                }
                .scrollIndicators(.never)
                ScrollView {
                    VStack(spacing: 3) {
                    ForEach(r.days.dropFirst().prefix(4), id: \.date) { d in
                        HStack {
                            Text(d.date.formatted(.dateTime.weekday(.abbreviated))).frame(width: 40, alignment: .leading)
                            Image(systemName: WeatherCode.symbol(d.code)).symbolRenderingMode(.multicolor).frame(width: 22)
                            Text(d.rain > 0 ? "\(d.rain)%" : "").font(.system(size: 10)).foregroundStyle(.cyan).frame(width: 30)
                            Spacer()
                            Text("\(Int(d.min.rounded()))°").foregroundStyle(.secondary).monospacedDigit()
                            Text("\(Int(d.max.rounded()))°").monospacedDigit().frame(width: 30, alignment: .trailing)
                        }
                        .font(.system(size: 12))
                    }
                }
                }.scrollIndicators(.hidden)
                HStack {
                    Text("Open-Meteo · updated \(r.fetchedAt.formatted(.relative(presentation: .named)))")
                    Spacer()
                    if let e = model.weather.lastError { Text(e).foregroundStyle(.orange) }
                }
                .font(.system(size: 10)).foregroundStyle(.secondary)
            } else {
                Text(model.weather.lastError ?? "Loading weather…").font(.system(size: 12)).foregroundStyle(.secondary)
                Button("Set City…") { model.show(.settings) }.buttonStyle(Pill())
            }
        }
    }
}

struct CitySearch: View {
    @ObservedObject var model: NotchModel
    var focusOnAppear = false
    @FocusState private var focused: Bool
    @State private var query = ""
    @State private var results: [WeatherCity] = []
    @State private var status = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search cities", text: $query)
                    .textFieldStyle(.plain).focused($focused)
                    .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?(); focused = true })
                    .onSubmit { if let first = results.first { select(first) } }
                IconButton(symbol: "location", size: 10, label: "Use current location") {
                    query = ""
                    focused = false
                    model.weather.useCurrentLocation()
                }
            }.padding(.horizontal, 8).frame(height: 29).background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            if !query.isEmpty {
                ForEach(results.prefix(4)) { city in
                    Button { select(city) } label: {
                        Text(city.label).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 3)
                    }.buttonStyle(.plain)
                }
                if results.isEmpty && !status.isEmpty {
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .onAppear {
            if focusOnAppear {
                model.onKeyboardFocus?()
                DispatchQueue.main.async { focused = true }
            }
        }
        .onChange(of: focused) { _, value in model.chatFocused = value }
        .onDisappear { if focused { model.chatFocused = false } }
        .task(id: query) {
            results = []
            status = ""
            let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
            guard term.count >= 2 else { return }
            status = "Searching…"
            do {
                try await Task.sleep(for: .milliseconds(250))
                let found = try await model.weather.suggestions(term)
                guard !Task.isCancelled else { return }
                results = found
                status = found.isEmpty ? "No matching cities" : ""
            } catch {
                if !Task.isCancelled { status = "City search unavailable. Try again when online." }
            }
        }
    }

    private func select(_ city: WeatherCity) {
        model.weather.choose(city)
        focused = false
        query = ""
    }
}

/// A second, compact page for the utilities people actually leave running.
struct WidgetsView: View {
    @ObservedObject var model: NotchModel
    @AppStorage("widgetPlacements") private var saved = Data()
    @AppStorage("widgetQuickNote") private var note = ""
    @AppStorage("widgetShelf") private var shelfData = Data()
    @AppStorage("widgetTimerPreset") private var preset = 5
    @AppStorage("widgetWeatherForecast") private var forecast = true
    @StateObject private var calendar = WidgetCalendar()
    @State private var gallery = false
    @State private var dragging: WidgetKind?
    @State private var weatherSearch = false
    @FocusState private var noteFocused: Bool
    private var placements: [WidgetPlacement] { WidgetPlacement.read(saved) }
    private var rows: [[WidgetPlacement]] { WidgetPlacement.rows(placements) }
    private var files: [URL] { (try? JSONDecoder().decode([URL].self, from: shelfData)) ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Spacer()
                if model.widgetsEditing {
                    Button(gallery ? "Layout" : "Add widgets") { gallery.toggle() }.buttonStyle(Pill())
                }
                Button(model.widgetsEditing ? "Done" : "Edit Widgets") {
                    model.widgetsEditing.toggle()
                    gallery = false
                    model.onLayoutChange?()
                }.buttonStyle(Pill())
            }
            ScrollView {
                if model.widgetsEditing && gallery {
                    VStack(spacing: 6) {
                        ForEach(WidgetKind.allCases) { kind in
                            HStack {
                                Image(systemName: kind.icon).frame(width: 22)
                                VStack(alignment: .leading) {
                                    Text(kind.title)
                                    Text(kind.preview).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(placements.contains { $0.kind == kind } ? "Added" : "Add") {
                                    save(placements + [WidgetPlacement(kind: kind, wide: kind == .shelf)])
                                }.buttonStyle(Pill()).disabled(placements.contains { $0.kind == kind })
                            }.padding(8).background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 9))
                        }
                    }
                } else {
                    VStack(spacing: 8) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            HStack(alignment: .top, spacing: 8) {
                                ForEach(row) { item in
                                    VStack(spacing: 4) {
                                        if model.widgetsEditing { editControls(item) }
                                        widget(item)
                                    }.frame(maxWidth: .infinity)
                                }
                                if row.count == 1 && row.first?.wide == false { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                            }
                        }
                        if placements.isEmpty { Button("Add widgets") { model.widgetsEditing = true; gallery = true; model.onLayoutChange?() }.buttonStyle(Pill()) }
                    }
                }
            }
            .scrollIndicators(.automatic)
        }
        .onAppear {
            resize()
            if placements.contains(where: { $0.kind == .calendar }) { calendar.refresh() }
        }
        .onChange(of: noteFocused) { _, value in model.chatFocused = value }
    }

    private func save(_ items: [WidgetPlacement]) {
        if let data = try? JSONEncoder().encode(items) { saved = data }
        resize()
        if items.contains(where: { $0.kind == .calendar }) { calendar.refresh() }
    }

    private func resize() {
        model.widgetRows = rows.count
        model.onLayoutChange?()
    }

    private func move(_ kind: WidgetKind, to index: Int) {
        var items = placements
        guard let from = items.firstIndex(where: { $0.kind == kind }), items.indices.contains(index), from != index else { return }
        items.insert(items.remove(at: from), at: index)
        save(items)
    }

    private func editControls(_ item: WidgetPlacement) -> some View {
        HStack(spacing: 2) {
            Image(systemName: "line.3.horizontal").help("Drag to reorder")
                .onDrag { dragging = item.kind; return NSItemProvider(object: item.kind.rawValue as NSString) }
            Text(item.kind.title).font(.caption).lineLimit(1)
            Spacer(minLength: 0)
            Menu {
                Button(item.wide ? "Small" : "Wide") {
                    save(placements.map { $0.id == item.id ? WidgetPlacement(kind: item.kind, wide: !item.wide) : $0 })
                }
                Button("Move earlier") { if let index = placements.firstIndex(where: { $0.id == item.id }) { move(item.kind, to: index - 1) } }
                Button("Move later") { if let index = placements.firstIndex(where: { $0.id == item.id }) { move(item.kind, to: index + 1) } }
                if item.kind == .timer {
                    Picker("Quick start", selection: $preset) {
                        ForEach([1, 5, 10, 15, 25, 60], id: \.self) { Text("\($0) min").tag($0) }
                    }
                }
                if item.kind == .weather { Toggle("Show forecast", isOn: $forecast) }
                Button("Remove widget") { save(placements.filter { $0.id != item.id }) }
            } label: { Image(systemName: "ellipsis.circle") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().accessibilityLabel("Configure \(item.kind.title)")
        }
        .padding(7)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
        .dropDestination(for: String.self) { values, _ in
            guard let source = values.first.flatMap(WidgetKind.init(rawValue:)), dragging == source,
                  let target = placements.firstIndex(where: { $0.id == item.id }) else { return false }
            move(source, to: target)
            dragging = nil
            return true
        }
    }

    @ViewBuilder private func widget(_ item: WidgetPlacement) -> some View {
        switch item.kind {
        case .timer: timerCard
        case .stopwatch: stopwatchCard
        case .weather: weatherCard(wide: item.wide)
        case .music: musicCard(wide: item.wide)
        case .calendar: calendarCard
        case .devices: devicesCard
        case .note: noteCard
        case .shelf: shelfCard
        }
    }

    private var timerCard: some View {
        card("Timer", "timer") {
            if let timer = model.activeTimer {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(TimerEngine.clock(timer.remaining(at: model.now))).font(.system(size: 22).monospacedDigit())
                        Text(timer.label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    let running = timer.status == .running
                    IconButton(symbol: running ? "pause.fill" : "play.fill", label: running ? "Pause timer" : "Resume timer") {
                        if running { model.timers.pause(timer.id) } else { model.timers.resume(timer.id) }
                    }
                    IconButton(symbol: "xmark", size: 10, label: "Cancel timer") { model.timers.cancel(timer.id) }
                    IconButton(symbol: "plus", size: 10, label: "New timer") { model.openTimerSetup() }
                }
            } else {
                HStack {
                Button("Start \(preset) min") {
                    model.requestNotificationPermission()
                    model.timers.start(seconds: TimeInterval(preset * 60))
                }.buttonStyle(Pill())
                IconButton(symbol: "plus", size: 10, label: "Custom timer") { model.openTimerSetup() }
                }
            }
        }
    }

    private var stopwatchCard: some View {
        card("Stopwatch", "stopwatch") {
            HStack {
                StopwatchReadout(model: model, size: 22, precise: true)
                Spacer()
                let running = model.stopwatch.isRunning
                IconButton(symbol: running ? "stop.fill" : "play.fill", label: running ? "Stop stopwatch" : "Start stopwatch") {
                    if running { model.stopwatch.stop() } else { model.stopwatch.start() }
                    model.activityChanged()
                }
                IconButton(symbol: "arrow.counterclockwise", label: "Reset stopwatch") {
                    model.stopwatch.reset()
                    model.activityChanged()
                }
            }
        }
    }

    private func weatherCard(wide: Bool) -> some View {
        card("Weather", "cloud.sun") {
            if let report = model.weather.report {
                HStack {
                    Text("\(Int(report.temp.rounded()))°").font(.system(size: 24))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(report.place).lineLimit(1)
                        Text(WeatherCode.text(report.code)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    IconButton(symbol: "magnifyingglass", size: 10, label: "Search weather city") { weatherSearch.toggle() }
                }
                Text("H \(Int(report.todayMax.rounded()))°  L \(Int(report.todayMin.rounded()))°").font(.caption).foregroundStyle(.secondary)
                if model.weather.lastError != nil { Text("Cached forecast").font(.caption2).foregroundStyle(.orange) }
                if wide && forecast && !weatherSearch {
                    HStack(spacing: 12) {
                        ForEach(report.hours.prefix(4), id: \.time) { hour in
                            Label("\(hour.time.formatted(.dateTime.hour())) · \(Int(hour.temp.rounded()))°", systemImage: WeatherCode.symbol(hour.code))
                                .font(.caption2)
                        }
                    }
                }
            } else {
                Button("Choose location") { weatherSearch.toggle() }.buttonStyle(Pill())
            }
            if weatherSearch { CitySearch(model: model) }
        }
    }

    private func musicCard(wide: Bool) -> some View {
        card("Music", "music.note") {
            if let track = model.media.state {
                if wide { MediaView(model: model, inline: true) } else {
                HStack(spacing: 5) {
                    Artwork(image: model.media.artwork, size: 30, radius: 5)
                        .overlay(alignment: .bottomTrailing) { PlayerIcon(track: track, size: 12) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title).lineLimit(1)
                        Text(track.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if !model.media.prohibitsSkip {
                        IconButton(symbol: "backward.fill", size: 9, label: "Previous track") { model.media.command("previous") }
                    }
                    IconButton(symbol: track.status == .playing ? "pause.fill" : "play.fill", label: "Play or pause music") { model.media.command("toggle") }
                    if !model.media.prohibitsSkip {
                        IconButton(symbol: "forward.fill", size: 9, label: "Next track") { model.media.command("next") }
                    }
                }
                }
            } else {
                Text("Not Playing").foregroundStyle(.secondary)
            }
        }
    }

    private var calendarCard: some View {
        card("Calendar", "calendar") {
            if let event = calendar.event, event.endDate > model.now {
                Text(event.title ?? "Calendar event").lineLimit(1)
                Text(event.startDate > model.now ? event.startDate.formatted(.relative(presentation: .numeric)) : "In progress")
                    .font(.caption).foregroundStyle(.secondary)
                if let meeting = calendar.meeting { Button("Join meeting") { NSWorkspace.shared.open(meeting) }.buttonStyle(Pill()) }
            } else if calendar.authorized {
                Text("No upcoming events").foregroundStyle(.secondary)
            } else {
                Button("Allow Calendar access") { calendar.request() }.buttonStyle(Pill())
            }
        }
        .task(id: Int(model.now.timeIntervalSince1970 / 60)) { calendar.refresh() }
    }

    private var devicesCard: some View {
        card("Bluetooth & Battery", "battery.75percent") {
            Text(model.connectedBluetooth.joined(separator: ", ").isEmpty ? "No connected Bluetooth devices" : model.connectedBluetooth.joined(separator: ", "))
                .lineLimit(2)
            if let power = macBatteryStatus() { Text(power).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private var noteCard: some View {
        card("Quick Note", "note.text") {
            TextField("Write a note…", text: $note, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.plain).focused($noteFocused)
                .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?(); noteFocused = true })
        }
    }

    private var shelfCard: some View {
        card("File Shelf", "tray") {
            if files.isEmpty { Text("Drop files here").foregroundStyle(.secondary) }
            ForEach(files, id: \.self) { url in
                HStack {
                    Label(url.lastPathComponent, systemImage: "doc").lineLimit(1).draggable(url)
                    Spacer()
                    IconButton(symbol: "eye", size: 10, label: "Quick Look \(url.lastPathComponent)") { WidgetQuickLook.shared.show(url) }
                    IconButton(symbol: "xmark", size: 10, label: "Remove from shelf") {
                        shelfData = (try? JSONEncoder().encode(files.filter { $0 != url })) ?? Data()
                    }
                }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            let additions = urls.filter { $0.isFileURL && !files.contains($0) }
            guard !additions.isEmpty else { return false }
            shelfData = (try? JSONEncoder().encode(Array(NSOrderedSet(array: files + additions)).compactMap { $0 as? URL })) ?? Data()
            return true
        }
    }

    private func card<Content: View>(_ title: String, _ symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(title, systemImage: symbol).font(.caption).foregroundStyle(.secondary)
            content()
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 86, alignment: .topLeading)
        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: More

struct MoreView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(model: model, title: "More")
            HStack(spacing: 4) {
                QuickAction(symbol: "stopwatch", label: "Stopwatch") { model.show(.stopwatch) }
                QuickAction(symbol: "alarm", label: "Alarms") { model.show(.alarm) }
                QuickAction(symbol: "headphones", label: "Bluetooth") { model.bluetoothPanel.refresh(); model.show(.bluetooth) }
                QuickAction(symbol: "airdrop", label: "AirDrop") { model.show(.airdrop) }
                QuickAction(symbol: "note.text", label: "Note") { model.show(.note) }
                QuickAction(symbol: "gearshape", label: "Settings") { model.show(.settings) }
            }
            Text("Recent Chats").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if model.chat.recent.isEmpty {
                        Text("No conversations yet.").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    ForEach(model.chat.recent) { c in
                        RecentRow(title: c.title, date: c.updated) { model.chat.open(c); model.show(.chat) }
                    }
                }
            }
            .scrollIndicators(.never)
        }
    }
}

struct RecentRow: View {
    let title: String
    let date: Date
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: "bubble.left").font(.system(size: 10)).foregroundStyle(.secondary)
                Text(title).lineLimit(1)
                Spacer()
                Text(date.formatted(.relative(presentation: .named))).font(.system(size: 10)).foregroundStyle(.secondary)
            }
            .font(.system(size: 12))
            .padding(.horizontal, 6).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.white.opacity(hover ? 0.08 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct StopwatchView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(spacing: 10) {
            Header(model: model, title: "Stopwatch")
            VStack(spacing: 8) {
                StopwatchReadout(model: model, size: 52, precise: true)
                Text("Elapsed time").foregroundStyle(.secondary)
                HStack(spacing: 22) {
                    IconButton(symbol: "arrow.counterclockwise", label: "Reset stopwatch") {
                        model.stopwatch.reset()
                        model.activityChanged()
                    }
                    Button {
                        model.stopwatch.isRunning ? model.stopwatch.stop() : model.stopwatch.start()
                        model.activityChanged()
                    } label: {
                        Image(systemName: model.stopwatch.isRunning ? "pause.fill" : "play.fill")
                            .frame(width: 44, height: 44).background(.green.opacity(0.22), in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel(model.stopwatch.isRunning ? "Pause stopwatch" : "Start stopwatch")
                    IconButton(symbol: "xmark", label: "Exit stopwatch") { model.goBack() }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

}

struct StopwatchReadout: View {
    @ObservedObject var model: NotchModel
    let size: CGFloat
    var precise = false
    var body: some View {
        TimelineView(.animation(minimumInterval: precise ? 1.0 / 60 : 1.0 / 12, paused: !model.stopwatch.isRunning || model.reduceMotion)) { _ in
            let elapsed = model.stopwatch.elapsed
            let whole = Int(elapsed)
            let millis = Int(elapsed * 1000) % 1000
            Text(String(format: precise ? "%02d:%02d.%03d" : "%02d:%02d.%01d", whole / 60, whole % 60, precise ? millis : millis / 100))
                .font(.system(size: size, weight: .medium).monospacedDigit())
        }
    }
}

/// A compact bridge to real Spotify: its own search and playlist UI remains the source of truth.
struct MediaView: View {
    @ObservedObject var model: NotchModel
    var inline = false
    @State private var draftPosition: Double?

    var body: some View {
        VStack(spacing: 9) {
            if !inline {
                HStack {
                    IconButton(symbol: "chevron.left", size: 11, label: "Back") { model.goBack() }
                    Spacer()
                    IconButton(symbol: "square.grid.2x2", size: 11, label: "Widgets") { model.show(.widgets) }
                }.frame(height: 16)
            }
            if let track = model.media.state {
                HStack(spacing: 12) {
                    Artwork(image: model.media.artwork, size: 52, radius: 10)
                    VStack(alignment: .leading, spacing: 4) {
                        TrackTitle(title: track.title, reduceMotion: model.reduceMotion)
                        Text(track.artist).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if track.status == .playing { PlaybackBars(reduceMotion: model.reduceMotion, meter: model.audioMeter) }
                }
                if let duration = track.duration, duration.isFinite, duration > 0, track.position != nil {
                    scrubber(track, duration: duration)
                }
                HStack(spacing: 16) {
                    if !model.media.prohibitsSkip {
                        IconButton(symbol: "backward.fill", size: 22, label: "Previous track") { model.media.command("previous") }
                    }
                    IconButton(symbol: track.status == .playing ? "pause.fill" : "play.fill", size: 25,
                               label: track.status == .playing ? "Pause" : "Play") { model.media.command("toggle") }
                    if !model.media.prohibitsSkip {
                        IconButton(symbol: "forward.fill", size: 22, label: "Next track") { model.media.command("next") }
                    }
                    IconButton(symbol: "laptopcomputer", size: 17, label: "Open player") { model.media.openSource() }
                }
            } else {
                Text("Nothing playing").foregroundStyle(.secondary)
            }
        }.onChange(of: model.media.state?.title) { _, _ in draftPosition = nil }
    }

    private func scrubber(_ track: MediaState, duration: Double) -> some View {
        TimelineView(.animation(minimumInterval: 0.05, paused: track.status != .playing || model.reduceMotion)) { frame in
            let position = min(duration, max(0, draftPosition ?? track.position(at: model.reduceMotion ? model.now : frame.date) ?? 0))
            HStack(spacing: 7) {
                Text(TimerEngine.clock(floor(position))).frame(minWidth: 27)
                GeometryReader { geo in
                    let width = max(1, geo.size.width)
                    Capsule().fill(.white.opacity(0.16)).frame(height: 5)
                        .overlay(alignment: .leading) {
                            Capsule().fill(Color(red: 0.42, green: 0.61, blue: 0.67))
                                .frame(width: width * position / duration, height: 5)
                        }
                        .frame(height: 14)
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                            draftPosition = min(1, max(0, drag.location.x / width)) * duration
                        }.onEnded { drag in
                            model.media.seek(min(1, max(0, drag.location.x / width)) * duration, in: track)
                            draftPosition = nil
                        })
                        .accessibilityLabel("Playback position")
                        .accessibilityValue(TimerEngine.clock(position))
                        .accessibilityAdjustableAction {
                            if $0 == .increment { model.media.seek(position + 5, in: track) }
                            if $0 == .decrement { model.media.seek(position - 5, in: track) }
                        }
                }.frame(height: 14)
                Text("-" + TimerEngine.clock(duration - position)).frame(minWidth: 30)
            }.font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
        }
    }
}

struct TrackTitle: View {
    let title: String
    let reduceMotion: Bool
    @State private var hovered = false
    @State private var started = Date()
    private let font = NSFont.systemFont(ofSize: 14, weight: .semibold)

    var body: some View {
        GeometryReader { geo in
            let travel: CGFloat = max(0, (title as NSString).size(withAttributes: [.font: font]).width - geo.size.width + 3)
            if hovered && travel > 0 && !reduceMotion {
                scrollingTitle(travel: travel)
            } else {
                Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
            }
        }.frame(height: 18).clipped()
            .onHover { hovered = $0; started = Date() }
            .onChange(of: title) { _, _ in started = Date() }
            .accessibilityLabel(title)
    }

    private func scrollingTitle(travel: CGFloat) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { frame in
            Text(title).font(.system(size: 14, weight: .semibold)).fixedSize()
                .offset(x: -scrollOffset(at: frame.date, travel: travel))
        }
    }

    private func scrollOffset(at date: Date, travel: CGFloat) -> CGFloat {
        let speed: Double = 30
        let journey = Double(travel) / speed
        let elapsed = max(0, date.timeIntervalSince(started))
        let position = elapsed.truncatingRemainder(dividingBy: 2 * journey + 1.6)
        let outbound = position - 0.6
        let inbound = 2 * journey + 1 - position
        return min(travel, CGFloat(max(0, min(outbound, inbound)) * speed))
    }
}

struct BrowserView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Header(model: model, title: "Search")
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search Google", text: $model.browserQuery).textFieldStyle(.plain).onSubmit { openGoogle() }
                    .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?() })
                IconButton(symbol: "safari", size: 12, label: "Open Google") { openGoogle() }
            }.padding(.horizontal, 9).frame(height: 30).background(RoundedRectangle(cornerRadius: 9).fill(Color.white.opacity(0.07)))
            Spacer()
            ContentUnavailableView("Google search", systemImage: "globe", description: Text("Results open in your default browser so the notch stays light and never runs a hidden web renderer."))
            Spacer()
        }
    }
    private func openGoogle() {
        let q = model.browserQuery.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        NSWorkspace.shared.open(URL(string: "https://www.google.com/search?q=" + q)!)
    }
}

struct NoteView: View {
    @ObservedObject var model: NotchModel
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(model: model, title: "Quick Note")
            TextEditor(text: $model.noteDraft)
                .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?() })
                .font(.system(size: 13))
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.white.opacity(0.07)))
            HStack {
                if let s = model.noteStatus { Text(s).font(.system(size: 11)).foregroundStyle(.secondary) }
                Spacer()
                Button("Save to Clyra Notes") { model.saveNote() }
                    .buttonStyle(Pill(prominent: true))
                    .disabled(model.noteDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }
}

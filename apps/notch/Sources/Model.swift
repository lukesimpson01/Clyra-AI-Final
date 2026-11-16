import AppKit
import SwiftUI
import UserNotifications
import Combine

enum NotchView: String { case voice, reply, computer, home, apps, timer, chat, weather, more, stopwatch, note, settings, media, browser, widgets, alarm, bluetooth, airdrop }

struct NotchBanner: Equatable {
    let title: String
    let detail: String
    let symbol: String
    var deviceName: String? = nil
}

final class NotchModel: ObservableObject {
    @Published var expanded = false
    @Published var view: NotchView = .home
    @Published var now = Date()
    @Published var chatDraft = ""
    @Published var noteDraft = ""
    @Published var noteStatus: String?
    @Published var chatFocused = false
    @Published var widgetsEditing = false
    @Published var showTimerSetup = false
    @Published var selectedTimerID: UUID?
    @Published var widgetRows = 2
    /// Briefly true while the panel changes width, so content never shows half-moved: it fades out, relayouts, fades back.
    @Published var contentHidden = false
    @Published var sidebarOpen = UserDefaults.standard.bool(forKey: "notchSidebar")
    private var widgetsReturn: NotchView = .home
    var onKeyboardFocus: (() -> Void)?
    var onReveal: (() -> Void)?
    private var hasPendingDrop: Bool { view == .airdrop && (airdropTargeted || airDrop.isBusy || !airDrop.files.isEmpty) }
    /// Only a real draft holds the panel open: an empty, focused field must not keep it from closing.
    var keepsPanelOpen: Bool {
        (chatFocused && !chatDraft.isEmpty) || (view == .note && !noteDraft.isEmpty) || keepsPanelOpenOnOutsideClick
    }
    var keepsPanelOpenOnOutsideClick: Bool { widgetsEditing || ringingAlarm != nil || hasPendingDrop }
    @Published var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    @Published var browserQuery = ""
    @Published private(set) var banner: NotchBanner?
    @Published private(set) var ringingAlarm: NotchAlarm?
    @Published var airdropTargeted = false
    let alarms = AlarmEngine()
    let airDrop = NotchAirDrop()
    let audioMeter = AudioMeter()
    func updateAudioMeter() {
        let bundle = hasPlayingMedia ? media.state?.bundleID : nil
        audioMeter.update(bundle: bundle, enabled: (UserDefaults.standard.object(forKey: "notchLiveAudioBars") as? Bool ?? true) && !reduceMotion)
    }
    let bluetoothPanel = BluetoothPanelModel()

    let timers = TimerEngine()
    var activeTimer: NotchTimer? {
        timers.timers.first { $0.id == selectedTimerID && $0.status != .done }
            ?? timers.soonest ?? timers.timers.last { $0.status == .paused }
    }
    let weather = WeatherService()
    lazy var media = MediaHub(link: flow)
    let chat = ChatClient()
    let flow = FlowBridge()
    let computer = ComputerSession()
    let voice = VoiceCall()
    private var voiceBag: AnyCancellable?
    /// Clyra's Flow dictation is being shown in the notch.
    var flowActive: Bool { flow.active }
    var onFlowStart: (() -> Void)?
    var onDone: (() -> Void)?
    /// The AI's own closing line for the collapsed notch, shown for a few seconds after a reply finishes.
    var doneMessage: String? { chat.doneMessage }
    let stopwatch = Stopwatch()
    let airPods = AirPodsMonitor()
    var connectedBluetooth: [String] { bluetooth.names(airPods: airPods.name) }
    private let bluetooth = BluetoothConnections()
    private var bannerExpiry: DispatchWorkItem?
    private var recentConnections: [String: Date] = [:]

    var hasPlayingMedia: Bool { media.state?.status == .playing }
    /// A track is loaded and playing or paused: the collapsed notch keeps showing it, with the wave at rest while paused.
    var hasMedia: Bool { media.state != nil && (media.state?.status == .playing || media.state?.status == .paused) }
    var secondaryActivities: [NotchView] {
        var result: [NotchView] = []
        if timers.soonest != nil { result.append(.timer) }
        if stopwatch.isRunning { result.append(.stopwatch) }
        if alarms.upcoming != nil { result.append(.alarm) }
        return result
    }
    var hasActivity: Bool { computer.isActive || hasMedia || !secondaryActivities.isEmpty }
    var activityView: NotchView? {
        if ringingAlarm != nil { return .alarm }
        if flowActive || voice.live { return .voice }
        if computer.isActive { return .computer }
        // A reply that has just finished: pointing at the notch shows that answer, with a way into the whole chat.
        if doneMessage != nil { return .reply }
        if hasMedia { return .media }
        if timers.soonest != nil { return .timer }
        if stopwatch.isRunning { return .stopwatch }
        return nil
    }

    /// Asked by the window controller to resize the panel to the current content.
    var onLayoutChange: (() -> Void)?
    private var clock: Timer?

    init() {
        flow.onChange = { [weak self] active in
            guard let self else { return }
            if active { self.onFlowStart?() }
            self.activityChanged()
        }
        chat.onDone = { [weak self] _ in self?.onDone?() }
        computer.sender = { [weak self] message in self?.flow.sendOp(message) }
        flow.onComputer = { [weak self] payload in self?.computer.apply(payload) }
        flow.onNotchOp = { [weak self] payload in self?.handleNotchOp(payload) }
        voice.attach(self)
        voiceBag = voice.objectWillChange.sink { [weak self] _ in DispatchQueue.main.async { self?.objectWillChange.send() } }
        flow.onVoiceCall = { [weak self] payload in self?.voice.handle(payload) }
        flow.onAppCall = { [weak self] payload in self?.voice.handleApp(payload) }
        computer.onChange = { [weak self] in
            guard let self else { return }
            self.lastWorking = self.working != nil
            self.onWorkChange?(self.beamActive)
            // Opening on the running task is the one rule for every activity; a finished or stopped run lets the notch go quiet.
            if self.computer.isActive, !self.expanded { self.followActivity = false }
            if self.expanded, self.followActivity, let next = self.activityView, self.view != next { self.view = next }
            self.activityChanged()
        }
        alarms.onChange = { [weak self] in self?.activityChanged() }
        alarms.onFire = { [weak self] alarm in
            guard let self else { return }
            self.ringingAlarm = alarm
            self.show(.alarm)
            self.onReveal?()
        }
        alarms.schedule()
        NotificationCenter.default.addObserver(forName: .NSSystemClockDidChange, object: nil, queue: .main) { [weak self] _ in self?.alarms.schedule() }
        timers.onChange = { [weak self] in self?.activityChanged() }
        timers.onFinish = { [weak self] t in self?.timerFinished(t) }
        weather.onChange = { [weak self] in self?.changed() }
        media.meter = audioMeter
        media.onChange = { [weak self] in
            guard let self else { return }
            if self.followActivity, self.expanded, self.ringingAlarm == nil, !self.chatFocused {
                // follow media that starts playing; never bounce the page back when it pauses or a poll drops out
                if let nextView = self.activityView, self.view != nextView { self.view = nextView }
            }
            self.activityChanged()
            self.updateAudioMeter()
        }
        airPods.onChange = { [weak self] in
            guard let self else { return }
            if let name = self.airPods.name { self.deviceConnected(name) }
            self.activityChanged()
        }
        bluetooth.onConnect = { [weak self] name in self?.deviceConnected(name) }
        chat.onChange = { [weak self] in
            guard let self else { return }
            // A to-do list opens a column beside the chat, so the panel changes width with it.
            if let draft = self.chat.pendingDraft { self.chat.pendingDraft = nil; self.chatDraft = draft }
            let wide = self.chatWide
            let busy = self.working != nil
            let done = self.doneMessage != nil
            // The collapsed width follows what it shows, so it must also change when the done message expires.
            self.changed(layout: wide != self.lastChatWide || busy != self.lastWorking || done != self.lastDone)
            self.lastDone = done
            self.lastChatWide = wide
            if busy != self.lastWorking { self.lastWorking = busy; self.onWorkChange?(self.beamActive) }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.timers.reconcile()
            self?.alarms.check()
            self?.weather.refresh()
            self?.media.refreshFromApps()
            self?.updateClock()
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            self?.updateAudioMeter()
        }
        timers.reconcile()
        weather.refresh()
        updateAudioMeter()
        updateClock()
    }

    private func changed(layout: Bool = false) {
        objectWillChange.send()
        updateClock()
        if layout { onLayoutChange?() }
    }

    /// One-second updates only while something on screen needs them: the open panel, a running
    /// timer or stopwatch, or playing media in the collapsed notch. Otherwise nothing redraws.
    func updateClock() {
        let needs = expanded || !timers.running.isEmpty || stopwatch.isRunning
        if needs && clock == nil {
            let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.now = Date()
                self.timers.reconcile()
            }
            t.tolerance = 0.2
            RunLoop.main.add(t, forMode: .common)
            clock = t
            now = Date()
        } else if !needs, let c = clock {
            c.invalidate()
            clock = nil
        }
    }

    private var followActivity = false
    private var lastChatWide = false
    private var lastWorking = false
    private var lastDone = false
    var onWorkChange: ((Bool) -> Void)?
    var chatWide: Bool { !chat.planTodos.isEmpty }
    /// Clyra is working on a reply (here or in Clyra): the collapsed notch shows the tool in use and glows.
    var working: (symbol: String, label: String, sources: [SourceRef])? {
        if computer.isActive { let c = computer.collapsedLabel; return (c.symbol, c.label, []) }
        if let work = chat.work { return work }
        // On a call between turns: say so, centred like any other activity.
        if voice.appActive && !flowActive { return ("phone.fill", voice.appMuted ? "Muted" : "Voice call", []) }
        if voice.active && !flowActive {
            if voice.speaking { return ("speaker.wave.2.fill", voice.snippet, []) }
            return voice.thinking || chat.isStreaming ? ("ellipsis", "Thinking", []) : ("phone.fill", "Voice call", [])
        }
        return nil
    }
    /// The light runs around the notch only while the AI is actually driving; paused or waiting for the person it goes dark.
    var beamActive: Bool { computer.isActive ? computer.status == "running" : chat.work != nil }

    private func deviceConnected(_ name: String) {
        let now = Date()
        recentConnections = recentConnections.filter { now.timeIntervalSince($0.value) < 3 }
        guard recentConnections[name] == nil else { return }
        recentConnections[name] = now
        lastBluetoothDevice = name
        bluetoothPanel.refresh()
        presentBanner(.init(title: name, detail: "Connected", symbol: deviceSymbol(name), deviceName: name))
    }

    private func presentBanner(_ value: NotchBanner) {
        bannerExpiry?.cancel()
        banner = value
        onLayoutChange?()
        let expiry = DispatchWorkItem { [weak self] in
            self?.banner = nil
            self?.onLayoutChange?()
        }
        bannerExpiry = expiry
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: expiry)
    }

    func setExpanded(_ on: Bool) {
        guard expanded != on else { return }
        followActivity = on && view != .widgets
        if on, airdropTargeted { view = .airdrop }
        else if on, ringingAlarm != nil { view = .alarm }
        else if on, banner?.deviceName != nil {
            view = .bluetooth
            followActivity = false
            clearConnectionBanner()
        }
        // Dictating or on a voice call: opening shows what is being heard and said.
        else if on, flowActive || voice.live {
            view = .voice
            followActivity = true
        }
        else if on, chat.work != nil {
            chat.adoptWorking()
            view = .chat
        }
        // Something is happening (music, a timer, the stopwatch): opening shows it, even if the last page was Chat or Widgets.
        // A half-written message is the one thing that keeps the chat open.
        else if on, let activity = activityView, !(view == .chat && !chatDraft.isEmpty) {
            view = activity
            followActivity = true
        }
        else if on, view != .chat, view != .widgets {
            view = .home
        }
        if view == .airdrop || view == .bluetooth || view == .chat { followActivity = false }
        if on && view == .timer {
            selectedTimerID = timers.soonest?.id
            showTimerSetup = false
        }
        expanded = on
        if on {
            now = Date()
            // Spotify can start after Notch, or its distributed notification can be missed.
            // Reconcile all supported players whenever the panel opens.
            media.refreshFromApps()
        } else {
            chatFocused = false
            widgetsEditing = false
            if view != .chat && view != .widgets { view = .home }
        }
        updateClock()
        onLayoutChange?()
    }

    /// Call whenever a collapsed-state activity starts or stops. This changes the native
    /// window width as well as SwiftUI state, so the compact indicator cannot be clipped.
    func activityChanged() {
        now = Date()
        objectWillChange.send()
        updateClock()
        onLayoutChange?()
    }

    func show(_ v: NotchView) {
        followActivity = false
        if view != v { chatFocused = false }
        if v == .widgets && view != .widgets { widgetsReturn = view }
        if v != .widgets { widgetsEditing = false }
        // One animation context for the page swap, so tabs always glide instead of snapping or half-changing.
        if view != v { withAnimation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.86)) { view = v } }
        if v == .weather { weather.refresh() }
        onLayoutChange?()
    }

    func toggleSidebar() {
        guard !contentHidden else { return }
        contentHidden = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.11) { [weak self] in
            guard let self else { return }
            self.sidebarOpen.toggle()
            UserDefaults.standard.set(self.sidebarOpen, forKey: "notchSidebar")
            self.onLayoutChange?()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { self.contentHidden = false }
        }
    }

    func goBack() { show(view == .widgets ? widgetsReturn : .home) }

    func dismissAlarm() { ringingAlarm = nil; show(activityView ?? .home) }

    func clearConnectionBanner() {
        guard banner?.deviceName != nil else { return }
        bannerExpiry?.cancel()
        banner = nil
        onLayoutChange?()
    }

    var openBluetoothDevice: String? {
        if let name = banner?.deviceName { return name }
        return lastBluetoothDevice
    }
    private(set) var lastBluetoothDevice: String?

    func revealAirDrop() {
        if view != .airdrop { show(.airdrop) }
        onReveal?()
    }

    func openTimerSetup() {
        showTimerSetup = true
        show(.timer)
    }

    // MARK: Chat and local actions

    /// A timer, alarm or stopwatch asked for in Clyra's own chat: done here, the same as when asked in the notch.
    func handleNotchOp(_ o: [String: Any]) {
        let action = o["action"] as? String ?? "start"
        switch o["kind"] as? String ?? "" {
        case "timer":
            let seconds = (o["seconds"] as? NSNumber)?.doubleValue ?? 0
            guard seconds > 0 else { return }
            let label = (o["label"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            selectedTimerID = timers.start(seconds: seconds, label: label).id
            requestNotificationPermission()
            show(.timer)
        case "stopwatch":
            if action == "stop" { stopwatch.stop() } else { stopwatch.start() }
            show(.stopwatch)
        case "alarm":
            guard let hour = (o["hour"] as? NSNumber)?.intValue, let minute = (o["minute"] as? NSNumber)?.intValue, (0..<24).contains(hour), (0..<60).contains(minute) else { return }
            alarms.add(NotchAlarm(hour: hour, minute: minute, weekdays: []))
            show(.alarm)
        default: break
        }
    }

    /// "Ask anything" → timers and weather the notch can do itself; everything else goes to Clyra.
    func submitChat() {
        var text = chatDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if text.lowercased() == "/permissions" {
            chatDraft = ""
            chat.appendLocal(user: text, reply: "Checking what Clyra can access. Each page that still needs a switch opens in System Settings, one at a time.")
            flow.sendOp(["op": "permissions"])
            return
        }
        // "/search …" is answered here as a web search; every other command runs inside Clyra, so hand it over.
        if let space = text.firstIndex(of: " "), text.hasPrefix("/") {
            let command = String(text[..<space])
            let rest = String(text[text.index(after: space)...]).trimmingCharacters(in: .whitespaces)
            if command == "/computer" {
                guard !rest.isEmpty else { return }
                chatDraft = ""
                // The message lands in the chat first, then the task begins.
                chat.appendLocal(user: text, reply: "On it. I'll plan this first, then take control of your computer. You'll see each step here and in the control bar.")
                show(.chat)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in self?.computer.start(rest) }
                return
            }
            if command == "/search" || command == "/deep-research" { text = rest.isEmpty ? text : (command == "/search" ? "Search the web for " : "Research in depth: ") + rest }
            else if SlashCommand.all.contains(where: { $0.prefix == command }) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                chatDraft = ""
                openClyra()
                return
            }
        }
        chatDraft = ""
        if let say = timeIntent(text) {
            chat.appendLocal(user: text, reply: say)
            return
        }
        // Asked to operate an app or the machine in plain words: that is computer use, the same as typing /computer.
        if NotchModel.wantsComputerUse(text) {
            chat.appendLocal(user: text, reply: "On it. I'll plan this first, then take control of your computer. You'll see each step here and in the control bar.")
            show(.chat)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in self?.computer.start(text) }
            return
        }
        let lower = text.lowercased()
        if lower.contains("weather") && lower.split(separator: " ").count <= 6 {
            weather.refresh(force: true)
            if let r = weather.report {
                chat.appendLocal(user: text, reply: "\(r.place): \(Int(r.temp.rounded()))°, \(WeatherCode.text(r.code)). Feels like \(Int(r.feelsLike.rounded()))°, high \(Int(r.todayMax.rounded()))° low \(Int(r.todayMin.rounded()))°.")
            }
            show(.weather)
            return
        }
        chat.send(text)
        show(.chat)
    }

    static func wantsComputerUse(_ text: String) -> Bool {
        let t = text.lowercased()
        let patterns = [
            #"\b(use|using|with|via|through|open)\s+(the\s+)?(clyra\s+)?computer[ -]use\b"#,
            #"\b(take over|control|operate)\s+(my|the)\s+(computer|mac|pc|laptop|desktop|screen)\b"#,
            #"\b(open|launch|quit|close|switch to|click|double[- ]click|type|press|scroll)\b[^.?!]{0,40}\b(google chrome|chrome|safari|firefox|arc|finder|spotify|notes|calculator|terminal|mail|messages|calendar|system settings|settings|preferences|photos|music|slack|discord|whatsapp|vs ?code|the app|an app|my (?:mac|computer|desktop|screen))\b"#,
        ]
        return patterns.contains { t.range(of: $0, options: .regularExpression) != nil }
    }

    /// Timers, the stopwatch and alarms, asked for in words (typed or spoken): set here. Returns what to say, or nil if it was something else.
    func timeIntent(_ text: String) -> String? {
        let t = text.lowercased()
        if let req = TimerEngine.parseRequest(text) {
            selectedTimerID = timers.start(seconds: req.seconds, label: req.label).id
            requestNotificationPermission()
            show(.timer)
            return "Timer set for \(TimerEngine.clock(req.seconds))."
        }
        if t.contains("stopwatch") {
            if t.range(of: #"\b(stop|pause|end)\b"#, options: .regularExpression) != nil { stopwatch.stop(); show(.stopwatch); return "Stopwatch stopped." }
            stopwatch.start(); show(.stopwatch); return "Stopwatch started."
        }
        if t.contains("alarm"), let re = try? NSRegularExpression(pattern: #"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?"#),
           let m = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)), let hr = Range(m.range(at: 1), in: t), var hour = Int(t[hr]) {
            var minute = 0
            if let mr = Range(m.range(at: 2), in: t) { minute = Int(t[mr]) ?? 0 }
            let marker = Range(m.range(at: 3), in: t).map { String(t[$0]).replacingOccurrences(of: ".", with: "") } ?? ""
            if marker == "pm", hour < 12 { hour += 12 } else if marker == "am", hour == 12 { hour = 0 }
            guard hour < 24, minute < 60 else { return nil }
            alarms.add(NotchAlarm(hour: hour, minute: minute, weekdays: []))
            show(.alarm)
            return "Alarm set for \(String(format: "%d:%02d", (hour + 11) % 12 + 1, minute)) \(hour < 12 ? "AM" : "PM")."
        }
        return nil
    }

    /// A turn spoken on a voice call: nothing is shown as sent. Returns a line to speak when it was handled here.
    func submitVoice(_ text: String) -> String? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if NotchModel.wantsComputerUse(text) { computer.start(text); return nil }
        if let say = timeIntent(text) { return say }
        chat.send(text, hidden: true)
        return nil
    }

    func openClyra(path: String = "") {
        NSWorkspace.shared.open(path.isEmpty ? ChatClient.baseURL : ChatClient.baseURL.appendingPathComponent(path))
    }

    // MARK: Quick note → Clyra Notes

    func saveNote() {
        let text = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let title = String(text.split(separator: "\n").first ?? "Quick Note").prefix(60)
        var req = URLRequest(url: ChatClient.baseURL.appendingPathComponent("api/notes/pages"))
        req.httpMethod = "POST"
        ChatClient.authorize(&req)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["title": String(title), "markdown": text])
        noteStatus = "Saving…"
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            DispatchQueue.main.async {
                guard let self else { return }
                if err == nil, let code = (resp as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) {
                    self.noteDraft = ""
                    self.noteStatus = "Saved to Clyra Notes"
                } else {
                    self.noteStatus = "Clyra isn't running, so the note wasn't saved."
                }
            }
        }.resume()
    }

    // MARK: Timer completion

    func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func timerFinished(_ t: NotchTimer) {
        presentBanner(.init(title: "Timer Done", detail: t.label, symbol: "bell.badge.fill"))
        NSSound(named: "Glass")?.play()
        let content = UNMutableNotificationContent()
        content.title = "Timer Done"
        content.body = t.label
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: t.id.uuidString, content: content, trigger: nil))
    }
}

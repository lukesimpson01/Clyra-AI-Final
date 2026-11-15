import AppKit
import SwiftUI
import UserNotifications

enum NotchView: String { case home, apps, timer, chat, weather, more, stopwatch, note, settings, media, browser, widgets, alarm, bluetooth, airdrop }

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
        audioMeter.update(bundle: bundle, enabled: UserDefaults.standard.bool(forKey: "notchLiveAudioBars") && !reduceMotion)
    }
    let bluetoothPanel = BluetoothPanelModel()

    let timers = TimerEngine()
    var activeTimer: NotchTimer? {
        timers.timers.first { $0.id == selectedTimerID && $0.status != .done }
            ?? timers.soonest ?? timers.timers.last { $0.status == .paused }
    }
    let weather = WeatherService()
    let media = MediaMonitor()
    let chat = ChatClient()
    let flow = FlowBridge()
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
    var secondaryActivities: [NotchView] {
        var result: [NotchView] = []
        if timers.soonest != nil { result.append(.timer) }
        if stopwatch.isRunning { result.append(.stopwatch) }
        if alarms.upcoming != nil { result.append(.alarm) }
        return result
    }
    var hasActivity: Bool { hasPlayingMedia || !secondaryActivities.isEmpty }
    var activityView: NotchView? {
        if ringingAlarm != nil { return .alarm }
        if hasPlayingMedia { return .media }
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
        media.onChange = { [weak self] in
            guard let self else { return }
            if self.followActivity, self.expanded, self.ringingAlarm == nil, !self.chatFocused {
                let nextView = self.activityView ?? .home
                if self.view != nextView { self.view = nextView }
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
            let wide = self.chatWide
            let busy = self.working != nil
            let done = self.doneMessage != nil
            // The collapsed width follows what it shows, so it must also change when the done message expires.
            self.changed(layout: wide != self.lastChatWide || busy != self.lastWorking || done != self.lastDone)
            self.lastDone = done
            self.lastChatWide = wide
            if busy != self.lastWorking { self.lastWorking = busy; self.onWorkChange?(busy) }
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
    var working: (symbol: String, label: String, sources: [SourceRef])? { chat.work }

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
        else if on, chat.work != nil {
            chat.adoptWorking()
            view = .chat
        }
        else if on, view != .chat, view != .widgets {
            view = activityView ?? .home
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
        sidebarOpen.toggle()
        UserDefaults.standard.set(sidebarOpen, forKey: "notchSidebar")
        onLayoutChange?()
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

    /// "Ask anything" → timers and weather the notch can do itself; everything else goes to Clyra.
    func submitChat() {
        let text = chatDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        chatDraft = ""
        if let req = TimerEngine.parseRequest(text) {
            let t = timers.start(seconds: req.seconds, label: req.label)
            requestNotificationPermission()
            chat.appendLocal(user: text, reply: "Timer set: \(t.label), ends at \(t.endsAt.formatted(date: .omitted, time: .shortened)).")
            show(.timer)
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

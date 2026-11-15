import AppKit
import SwiftUI
import Carbon.HIToolbox
import ServiceManagement
import QuartzCore

enum LoginItem {
    static var enabled: Bool { SMAppService.mainApp.status == .enabled }
    static func set(_ on: Bool) {
        if on { try? SMAppService.mainApp.register() } else { try? SMAppService.mainApp.unregister() }
    }
}

// Use the app's own bundle identity when managing its macOS login registration.
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--login-item" {
    do {
        let service = SMAppService.mainApp
        switch CommandLine.arguments[2] {
        case "enable": if service.status != .enabled { try service.register() }
        case "disable": if service.status == .enabled { try service.unregister() }
        case "status": break
        default: exit(64)
        }
        switch service.status {
        case .enabled: print("Notch opens at login")
        case .requiresApproval: print("Notch requires approval in System Settings → Login Items"); exit(2)
        default: print("Notch does not open at login")
        }
        exit(0)
    } catch {
        FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
        exit(1)
    }
}

/// Hover only orders the panel forward. Explicit clicks and text fields can claim keyboard focus.
final class NotchPanel: NSPanel {
    var onEscape: (() -> Void)?
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .mainMenu + 3
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        isMovable = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false
        animationBehavior = .none
    }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    var editingText: Bool { firstResponder is NSTextView || firstResponder is NSTextField }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
    func takeKeyboardFocus() {
        if !NSApp.isActive { NSApp.activate(ignoringOtherApps: true) }
        if !isKeyWindow { makeKey() }
    }
    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown && !isKeyWindow { takeKeyboardFocus() }
        super.sendEvent(event)
    }
    override func cancelOperation(_ sender: Any?) { onEscape?() }
}

final class NotchHostingView: NSHostingView<NotchRoot> {
    var onPointerInside: ((Bool) -> Void)?
    weak var fileDropTarget: NotchCanvas?
    private var pointerTracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let pointerTracking { removeTrackingArea(pointerTracking) }
        let area = NSTrackingArea(rect: .zero, options: [.inVisibleRect, .activeAlways, .mouseEnteredAndExited, .enabledDuringMouseDrag], owner: self, userInfo: nil)
        addTrackingArea(area)
        pointerTracking = area
    }

    /// The first click on an inactive panel must reach the button under it, not just activate the app.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseEntered(with event: NSEvent) { onPointerInside?(true) }
    override func mouseExited(with event: NSEvent) { onPointerInside?(false) }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { fileDropTarget?.draggingEntered(sender) ?? [] }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { fileDropTarget?.draggingUpdated(sender) ?? [] }
    override func draggingExited(_ sender: NSDraggingInfo?) { fileDropTarget?.draggingExited(sender) }
    override func draggingEnded(_ sender: NSDraggingInfo) { fileDropTarget?.draggingEnded(sender) }
    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { fileDropTarget?.prepareForDragOperation(sender) == true }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool { fileDropTarget?.performDragOperation(sender) == true }
}

/// Flipped container so the content clip shares the canvas's top-left origin.
final class ClipView: NSView {
    override var isFlipped: Bool { true }
}

/// Keeps the black silhouette in the same top-aligned canvas throughout a resize. The SwiftUI content sits
/// at its final size inside `clip`, and the same animated path masks it, so a transition is a GPU path
/// change rather than a SwiftUI relayout per frame.
final class NotchCanvas: NSView {
    private let silhouette = CAShapeLayer()
    private let mask = CAShapeLayer()
    private let beamBase = CAShapeLayer()
    private var beamLayers: [CAShapeLayer] = []
    private let beamLengths: [CGFloat] = [170, 112, 72, 42, 20]
    private var beamLink: CADisplayLink?
    private var beamHead: CGFloat = 0
    private var beamPerimeter: CGFloat = 0
    private var beamPath: CGPath?
    /// Points per second, the same on straights and corners: the light runs along the edge, not around a centre.
    private let beamSpeed: CGFloat = 120
    private var beamDone = false
    let clip = ClipView()
    private(set) var shapeRect = CGRect.zero
    /// The content's final frame: clicks land there even while the shape is still growing toward it.
    var hitRect = CGRect.zero
    private var beamOn = false
    var onFileDrag: (() -> Bool)?
    var onFileDragExit: (() -> Void)?
    var onFileDrop: (([URL]) -> Bool)?
    private var dragSequence: Int?
    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        silhouette.fillColor = NSColor.black.cgColor
        layer?.addSublayer(silhouette)
        mask.fillColor = NSColor.black.cgColor
        beamBase.fillColor = nil
        beamBase.strokeColor = NSColor(calibratedRed: 0.36, green: 0.57, blue: 1, alpha: 0.22).cgColor
        beamBase.lineWidth = 1.5
        beamBase.opacity = 0
        layer?.addSublayer(beamBase)
        let alphas: [CGFloat] = [0.10, 0.12, 0.16, 0.24, 0.42]
        for alpha in alphas {
            let l = CAShapeLayer()
            l.fillColor = nil
            l.strokeColor = NSColor(calibratedRed: 0.72, green: 0.82, blue: 1, alpha: alpha).cgColor
            l.lineWidth = 2.4
            l.lineCap = .round
            l.opacity = 0
            layer?.addSublayer(l)
            beamLayers.append(l)
        }
        clip.wantsLayer = true
        clip.layer?.mask = mask
        addSubview(clip)
    }

    required init?(coder: NSCoder) { fatalError("NotchCanvas is created in code") }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        silhouette.frame = bounds
        mask.frame = bounds
        beamBase.frame = bounds
        beamLayers.forEach { $0.frame = bounds }
        clip.frame = bounds
        CATransaction.commit()
    }

    /// Transparent window area never takes clicks meant for whatever is underneath.
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard shapeRect.union(hitRect).insetBy(dx: -2, dy: -2).contains(convert(point, from: superview)) else { return nil }
        return super.hitTest(point)
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        draggingUpdated(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard sender.draggingSourceOperationMask.contains(.copy),
              sender.draggingPasteboard.availableType(from: [.fileURL]) != nil else { return [] }
        if dragSequence != sender.draggingSequenceNumber {
            finishDrag()
            dragSequence = sender.draggingSequenceNumber
        }
        let pointer = convert(sender.draggingLocation, from: nil)
        guard shapeRect.insetBy(dx: -1, dy: -1).contains(pointer), onFileDrag?() == true else {
            onFileDragExit?()
            return []
        }
        return .copy
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        if sender == nil || sender?.draggingSequenceNumber == dragSequence { finishDrag() }
    }
    override func draggingEnded(_ sender: NSDraggingInfo) { draggingExited(sender) }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        draggingUpdated(sender).contains(.copy)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        defer { finishDrag() }
        guard draggingUpdated(sender).contains(.copy) else { return false }
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        let pasteboard = sender.draggingPasteboard
        let items = pasteboard.readObjects(forClasses: [NSURL.self], options: options) ?? []
        var urls = items.compactMap { ($0 as? NSURL).map { $0 as URL } }.filter(\.isFileURL)
        if urls.isEmpty {
            urls = (pasteboard.pasteboardItems ?? []).compactMap { $0.string(forType: .fileURL).flatMap(URL.init(string:)) }
                .filter(\.isFileURL)
        }
        return !urls.isEmpty && onFileDrop?(urls) == true
    }

    func finishDrag() {
        guard dragSequence != nil else { return }
        dragSequence = nil
        onFileDragExit?()
    }

    func drawSilhouette(rect: CGRect, scale: CGFloat, reveal: CGFloat) {
        shapeRect = rect
        let ear = Metrics.ear + (Metrics.expandedEar - Metrics.ear) * reveal
        let radius = Metrics.collapsedRadius + (Metrics.expandedRadius - Metrics.collapsedRadius) * reveal
        let path = NotchMotion.silhouette(in: rect, ear: ear, radius: radius, topBleed: 2 / scale)
        silhouette.path = path
        mask.path = path
        if beamOn {
            // The light runs along the visible edge only (the closing line above the screen is left out).
            let open = NotchMotion.silhouette(in: rect, ear: ear, radius: radius, topBleed: 2 / scale, closed: false)
            beamPath = open
            beamPerimeter = NotchMotion.length(of: open)
            beamBase.path = open
            beamLayers.forEach { $0.path = open }
            applyBeam()
        }
    }

    private func applyBeam() {
        let period = max(1, beamPerimeter + 90)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (layer, length) in zip(beamLayers, beamLengths) {
            layer.lineDashPattern = [NSNumber(value: Double(length)), NSNumber(value: Double(max(1, period - length)))]
            layer.lineDashPhase = length - beamHead
        }
        CATransaction.commit()
    }

    @objc private func beamTick(_ link: CADisplayLink) {
        let dt = CGFloat(link.targetTimestamp - link.timestamp)
        beamHead += (beamDone ? 560 : beamSpeed) * min(dt, 1.0 / 20)
        let period = max(1, beamPerimeter + 90)
        if beamHead > period {
            if beamDone { endDone(); return }
            beamHead -= period
        }
        applyBeam()
    }

    private func tint(done: Bool) {
        let alphas: [CGFloat] = [0.10, 0.12, 0.16, 0.24, 0.42]
        for (layer, alpha) in zip(beamLayers, alphas) {
            layer.strokeColor = (done ? NSColor(calibratedRed: 0.8, green: 1, blue: 0.88, alpha: min(1, alpha * 1.7))
                                      : NSColor(calibratedRed: 0.72, green: 0.82, blue: 1, alpha: alpha)).cgColor
        }
        beamBase.strokeColor = (done ? NSColor(calibratedRed: 0.45, green: 0.95, blue: 0.62, alpha: 0.34)
                                     : NSColor(calibratedRed: 0.36, green: 0.57, blue: 1, alpha: 0.22)).cgColor
    }

    /// The reply is finished: one fast, bright lap in white-green, then the edge settles.
    func playDone(reduceMotion: Bool) {
        beamLink?.invalidate()
        beamLink = nil
        beamDone = true
        beamOn = true
        tint(done: true)
        beamHead = 0
        drawSilhouette(rect: shapeRect, scale: window?.backingScaleFactor ?? 2, reveal: shapeRect.height > 60 ? 1 : 0)
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.15)
        beamBase.opacity = 1
        beamLayers.forEach { $0.opacity = reduceMotion ? 0 : 1 }
        CATransaction.commit()
        if reduceMotion {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in self?.endDone() }
        } else {
            let link = displayLink(target: self, selector: #selector(beamTick(_:)))
            link.add(to: .main, forMode: .common)
            beamLink = link
        }
    }

    private func endDone() {
        beamLink?.invalidate()
        beamLink = nil
        beamDone = false
        beamOn = false
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.5)
        beamBase.opacity = 0
        beamLayers.forEach { $0.opacity = 0 }
        CATransaction.commit()
        tint(done: false)
    }

    /// While Clyra works, a soft light runs around the notch's edge, open or closed, at one steady speed.
    func setBeam(_ on: Bool, reduceMotion: Bool) {
        guard !beamDone, on != beamOn else { return }
        beamOn = on
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.4)
        beamBase.opacity = on ? 1 : 0
        beamLayers.forEach { $0.opacity = on && !reduceMotion ? 1 : 0 }
        CATransaction.commit()
        beamLink?.invalidate()
        beamLink = nil
        guard on else { return }
        drawSilhouette(rect: shapeRect, scale: window?.backingScaleFactor ?? 2, reveal: shapeRect.height > 60 ? 1 : 0)
        if !reduceMotion {
            let link = displayLink(target: self, selector: #selector(beamTick(_:)))
            link.add(to: .main, forMode: .common)
            beamLink = link
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSDraggingDestination {
    let model = NotchModel()
    let panel = NotchPanel()
    var hoverWork: DispatchWorkItem?
    var closeWork: DispatchWorkItem?
    private let canvas = NotchCanvas(frame: .zero)
    private var host: NotchHostingView?
    private var widthSpring = Spring(0)
    private var heightSpring = Spring(0)
    private var revealSpring = Spring(0, stiffness: 380, damping: 32)
    private var displayLink: CADisplayLink?
    private var hostSize = CGSize.zero
    private var hostSettle: DispatchWorkItem?
    private var laidOut = false
    private var peeking = false
    private var watchTimer: Timer?
    // Hover safety: `armed` = the pointer has been inside the panel since it last changed shape;
    // `farRule` = once the pointer has visited, wandering well away closes the panel even if it never re-entered.
    private var armed = false
    private var farRule = false
    private var outsideTicks = 0
    private var lastInteraction = Date.distantPast
    /// True while one of the panel's own menus (More, Weather location…) is open: the pointer is then over the menu, not
    /// the panel, and that must never read as "left the notch".
    private var menuTracking = false
    private var menuEndedAt = Date.distantPast
    private var pageBeforeFilePreview: NotchView?
    var outsideClick: Any?
    var hotkeyRef: EventHotKeyRef?

    var screen: NSScreen {
        NSScreen.screens.first { $0.localizedName.localizedCaseInsensitiveContains("built-in") } ?? NSScreen.main ?? NSScreen.screens[0]
    }

    /// Height of the menu bar on the notch's screen (the hardware notch height on notched Macs).
    var menuBarHeight: CGFloat {
        let s = screen
        if s.safeAreaInsets.top > 0 { return s.safeAreaInsets.top }
        let h = s.frame.maxY - s.visibleFrame.maxY
        return h > 0 ? h : 24
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        if NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "").count > 1 {
            NSApp.terminate(nil); return
        }
        let root = NotchRoot(model: model, menuBarHeight: menuBarHeight, drawsSilhouette: false,
                             onClickCollapsed: { [weak self] in self?.expand() })
        let host = NotchHostingView(rootView: root)
        host.sizingOptions = []
        host.fileDropTarget = canvas
        host.registerForDraggedTypes([.fileURL])
        host.onPointerInside = { [weak self] in self?.hover($0) }
        canvas.onFileDrag = { [weak self] in self?.previewFileDrop() == true }
        canvas.onFileDragExit = { [weak self] in self?.endFileDrag() }
        canvas.onFileDrop = { [weak self] urls in self?.acceptFileDrop(urls) == true }
        self.host = host
        canvas.clip.addSubview(host)
        panel.contentView = canvas
        panel.delegate = self
        panel.registerForDraggedTypes([.fileURL])
        model.airDrop.sourceWindow = panel
        panel.onEscape = { [weak self] in
            guard let self else { return }
            if self.model.ringingAlarm != nil { self.model.dismissAlarm() }
            else { self.collapse("escape") }
        }
        model.onLayoutChange = { [weak self] in self?.layout() }
        NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main) { [weak self] _ in self?.menuTracking = true }
        NotificationCenter.default.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: .main) { [weak self] _ in
            self?.menuTracking = false
            self?.menuEndedAt = Date()
        }
        model.onFlowStart = { [weak self] in self?.collapse("flow") }
        model.onDone = { [weak self] in
            guard let self else { return }
            self.canvas.playDone(reduceMotion: self.model.reduceMotion)
        }
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [weak self] event in
            if event.window === self?.panel { self?.lastInteraction = Date() }
            return event
        }
        model.onWorkChange = { [weak self] busy in
            guard let self else { return }
            self.canvas.setBeam(busy, reduceMotion: self.model.reduceMotion)
        }
        model.onKeyboardFocus = { [weak self] in self?.panel.takeKeyboardFocus() }
        model.onReveal = { [weak self] in self?.expand() }
        applySpaces()
        layout(animatedShrink: false)
        panel.orderFrontRegardless()

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.layout(animatedShrink: false) }
        NotificationCenter.default.addObserver(forName: .notchHotkeyChanged, object: nil, queue: .main) { [weak self] _ in self?.registerHotkey() }
        NotificationCenter.default.addObserver(forName: .notchSpacesChanged, object: nil, queue: .main) { [weak self] _ in self?.applySpaces() }
        registerHotkey()
        if !UserDefaults.standard.bool(forKey: "loginConfigured") {
            LoginItem.set(true)
            UserDefaults.standard.set(true, forKey: "loginConfigured")
        }
    }

    func applySpaces() {
        var b: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        if UserDefaults.standard.object(forKey: "showInFullScreen") as? Bool ?? true { b.insert(.fullScreenAuxiliary) }
        panel.collectionBehavior = b
    }

    @objc func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { canvas.draggingEntered(sender) }
    @objc func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { canvas.draggingUpdated(sender) }
    @objc func draggingExited(_ sender: NSDraggingInfo?) { canvas.draggingExited(sender) }
    @objc func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { canvas.prepareForDragOperation(sender) }
    @objc func performDragOperation(_ sender: NSDraggingInfo) -> Bool { canvas.performDragOperation(sender) }

    private func previewFileDrop() -> Bool {
        guard canAcceptFileDrop else { return false }
        if !model.airdropTargeted {
            closeWork?.cancel()
            if model.view != .airdrop { pageBeforeFilePreview = model.view }
            model.airdropTargeted = true
            model.revealAirDrop()
        }
        return true
    }

    private func endFileDrag() {
        guard model.airdropTargeted else { return }
        model.airdropTargeted = false
        if let previous = pageBeforeFilePreview, model.view == .airdrop {
            model.show(previous)
        }
        pageBeforeFilePreview = nil
        hover(false)
    }

    private func acceptFileDrop(_ urls: [URL]) -> Bool {
        guard canAcceptFileDrop, model.airDrop.add(urls) else { return false }
        pageBeforeFilePreview = nil
        model.revealAirDrop()
        return true
    }

    private var canAcceptFileDrop: Bool {
        !model.airDrop.isBusy && model.ringingAlarm == nil && (!model.expanded || model.view != .widgets)
    }

    // MARK: Frame

    /// Expanded pages share one window. The compact window fits the visible notch at rest.
    func targetSize() -> NSSize {
        var size = NSSize(width: Metrics.width(model), height: Metrics.height(model, menuBar: menuBarHeight))
        if peeking && !model.expanded { size.width += 10; size.height += 3 }
        return size
    }

    func layout(animatedShrink animate: Bool = true) {
        let size = targetSize()
        let reveal: CGFloat = model.expanded ? 1 : 0
        guard laidOut, animate, !model.reduceMotion else {
            stopLink()
            widthSpring.snap(to: size.width)
            heightSpring.snap(to: size.height)
            revealSpring.snap(to: reveal)
            laidOut = true
            renderRest()
            return
        }
        if abs(size.width - widthSpring.target) < 0.5, abs(size.height - heightSpring.target) < 0.5, revealSpring.target == reveal { return }
        if model.expanded, revealSpring.target == 1 { reportResizeUnderPointer(to: size) }
        NotchMotion.tune(&widthSpring, toward: size.width, bounce: 1)
        NotchMotion.tune(&heightSpring, toward: size.height, bounce: 0.6)
        revealSpring.target = reveal
        coverWindow(for: size)
        placeHost(for: size)
        startLink()
    }

    // The window grows to hold the spring's overshoot and returns to the exact visible size at rest, so no
    // transparent area ever sits over other apps.
    private func coverWindow(for size: CGSize) {
        let need = CGSize(width: max(size.width, widthSpring.value) * 1.14 + 8, height: max(size.height, heightSpring.value) * 1.12 + 8)
        let have = panel.frame.size
        guard need.width > have.width || need.height > have.height else { return }
        setWindow(NotchMotion.frame(on: screen.frame, size: CGSize(width: max(need.width, have.width), height: max(need.height, have.height)),
                                    scale: screen.backingScaleFactor))
    }

    private func setWindow(_ frame: CGRect) {
        guard panel.frame != frame else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        panel.setFrame(frame, display: false, animate: false)
        canvas.layoutSubtreeIfNeeded()
        applyHost(hostSize)
        CATransaction.commit()
    }

    /// Growing axes give the content its final room at once; shrinking axes wait so outgoing content is never squashed.
    private func placeHost(for size: CGSize) {
        hostSettle?.cancel()
        var next = hostSize
        if size.width >= next.width { next.width = size.width }
        if size.height >= next.height { next.height = size.height }
        applyHost(next)
        guard size.width < next.width || size.height < next.height else { return }
        let work = DispatchWorkItem { [weak self] in self?.applyHost(size) }
        hostSettle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
    }

    private func applyHost(_ size: CGSize) {
        hostSize = size
        let frame = CGRect(x: (panel.frame.width - size.width) / 2, y: 0, width: size.width, height: size.height)
        if host?.frame != frame { host?.frame = frame }
        canvas.hitRect = frame
    }

    private func startLink() {
        guard displayLink == nil else { return }
        let link = canvas.displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        let dt = CGFloat(link.targetTimestamp - link.timestamp)
        widthSpring.step(dt)
        heightSpring.step(dt)
        revealSpring.step(dt)
        if widthSpring.settled, heightSpring.settled, revealSpring.settled {
            stopLink()
            renderRest()
            return
        }
        draw(CGSize(width: max(40, widthSpring.value), height: max(10, heightSpring.value)))
    }

    private func draw(_ size: CGSize) {
        let rect = CGRect(x: (canvas.bounds.width - size.width) / 2, y: 0, width: size.width, height: size.height)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        canvas.drawSilhouette(rect: rect, scale: screen.backingScaleFactor, reveal: min(1, max(0, revealSpring.value)))
        CATransaction.commit()
    }

    private func renderRest() {
        hostSettle?.cancel()
        let size = targetSize()
        let frame = NotchMotion.frame(on: screen.frame, size: size, scale: screen.backingScaleFactor)
        widthSpring.snap(to: size.width)
        heightSpring.snap(to: size.height)
        revealSpring.snap(to: model.expanded ? 1 : 0)
        setWindow(frame)
        applyHost(frame.size)
        draw(frame.size)
    }

    // MARK: Hover, click, escape

    func hover(_ inside: Bool) {
        if inside {
            closeWork?.cancel()
            hoverWork?.cancel()
            if model.expanded { return }   // the watch timer owns an open panel; host-frame enter events lag resizes
            if !peeking { peeking = true; layout() }
            let w = DispatchWorkItem { [weak self] in self?.expand(fromPointer: true) }
            hoverWork = w
            DispatchQueue.main.asyncAfter(deadline: .now() + Metrics.hoverDelay, execute: w)
        } else {
            hoverWork?.cancel()
            if peeking && !model.expanded { peeking = false; layout() }
        }
    }

    private func panelRect(margin: CGFloat) -> NSRect {
        let frame = screen.frame
        let size = targetSize()
        return NSRect(x: frame.midX - size.width / 2 - margin, y: frame.maxY - size.height - margin,
                      width: size.width + 2 * margin, height: size.height + 2 * margin + 60)
    }

    /// A page change can leave the pointer outside the new, smaller shape (a button at the bottom, then a shorter
    /// or narrower page). The panel stays open and waits for the pointer to come back instead of closing under it.
    private func reportResizeUnderPointer(to size: CGSize) {
        let frame = screen.frame
        let next = NSRect(x: frame.midX - size.width / 2 - 6, y: frame.maxY - size.height - 6, width: size.width + 12, height: size.height + 66)
        if !next.contains(NSEvent.mouseLocation) {
            farRule = farRule || armed
            armed = false
            outsideTicks = 0
        }
    }

    private func startWatching() {
        guard watchTimer == nil else { return }
        let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in self?.watchPointer() }
        t.tolerance = 0.03
        RunLoop.main.add(t, forMode: .common)
        watchTimer = t
    }

    private func stopWatching() {
        watchTimer?.invalidate()
        watchTimer = nil
    }

    private func watchPointer() {
        guard model.expanded else { stopWatching(); return }
        let p = NSEvent.mouseLocation
        if panelRect(margin: 6).contains(p) { armed = true; farRule = true; outsideTicks = 0; return }
        // Never judge the pointer while the panel is changing shape or while someone is clicking in it.
        if displayLink != nil || menuTracking || Date().timeIntervalSince(menuEndedAt) < 0.9 || Date().timeIntervalSince(lastInteraction) < 1.6 { outsideTicks = 0; return }
        // Never close under the user while they're typing, dragging or a button is held.
        if model.keepsPanelOpen || NSEvent.pressedMouseButtons != 0 || model.airdropTargeted { outsideTicks = 0; return }
        if armed {
            outsideTicks += 1
            if outsideTicks >= 2 { collapse("pointer-left") }
        } else if farRule, !panelRect(margin: 220).contains(p) {
            collapse("pointer-far")
        }
    }

    func expand(fromPointer: Bool = false) {
        hoverWork?.cancel()
        guard !model.expanded else { return }
        peeking = false
        armed = fromPointer
        farRule = fromPointer
        outsideTicks = 0
        model.setExpanded(true)
        startWatching()
        if outsideClick == nil {
            outsideClick = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
                guard let self, !self.model.keepsPanelOpenOnOutsideClick else { return }
                // A click that passed through the panel's edge, or one made in a menu it opened, is not "outside".
                if self.menuTracking || Date().timeIntervalSince(self.menuEndedAt) < 0.8 { return }
                if self.panelRect(margin: 14).contains(NSEvent.mouseLocation) { return }
                self.collapse("outside-click")
            }
        }
    }

    /// Why the panel closed, kept in ~/Library/Logs/Notch/collapse.log so an unexpected close can be traced.
    private func logCollapse(_ reason: String) {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Notch")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("collapse.log")
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(reason) view=\(model.view.rawValue) mouse=\(NSEvent.mouseLocation) armed=\(armed) menu=\(menuTracking)\n"
        if let handle = try? FileHandle(forWritingTo: file) { handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close() }
        else { try? line.write(to: file, atomically: true, encoding: .utf8) }
    }

    func collapse(_ reason: String = "unknown") {
        if model.expanded { logCollapse(reason) }
        closeWork?.cancel()
        hoverWork?.cancel()
        guard model.expanded else { return }
        pageBeforeFilePreview = nil
        canvas.finishDrag()
        model.airdropTargeted = false
        peeking = false
        stopWatching()
        model.setExpanded(false)
        if panel.isKeyWindow { panel.resignKey() }
        if NSApp.isActive { NSApp.deactivate() }
        if let m = outsideClick { NSEvent.removeMonitor(m); outsideClick = nil }
    }

    func toggle() { model.expanded ? collapse("hotkey") : expand() }

    // MARK: Shortcut

    func registerHotkey() {
        if let r = hotkeyRef { UnregisterEventHotKey(r); hotkeyRef = nil }
        let pref = UserDefaults.standard.string(forKey: "hotkey") ?? "optcmdN"
        let combo: (UInt32, UInt32)?
        switch pref {
        case "optcmdN": combo = (UInt32(kVK_ANSI_N), UInt32(cmdKey | optionKey))
        case "ctrloptSpace": combo = (UInt32(kVK_Space), UInt32(controlKey | optionKey))
        default: combo = nil
        }
        guard let (key, mods) = combo else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            (NSApp.delegate as? AppDelegate)?.toggle()
            return noErr
        }, 1, &spec, nil, nil)
        RegisterEventHotKey(key, mods, EventHotKeyID(signature: OSType(0x4E4F5443), id: 1), GetApplicationEventTarget(), 0, &hotkeyRef)
    }

    // Test hooks: open -g "notch://expand" | collapse | view/timer | ask/<text>
    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls where u.scheme == "notch" {
            switch u.host {
            case "login":
                if u.lastPathComponent == "enable" { LoginItem.set(true) }
                if u.lastPathComponent == "disable" { LoginItem.set(false) }
            case "state":
                let m = model
                let text = "expanded=\(m.expanded) view=\(m.view.rawValue) mediaTitle=\(m.media.state?.title ?? "nil") status=\(String(describing: m.media.state?.status)) hasPlaying=\(m.hasPlayingMedia) sources=\(m.media.sources.map(\.id)) working=\(String(describing: m.working?.label)) done=\(String(describing: m.doneMessage)) flow=\(m.flowActive) banner=\(String(describing: m.banner?.title)) secondary=\(m.secondaryActivities.count) w=\(Metrics.width(m)) h=\(Metrics.height(m, menuBar: menuBarHeight))"
                try? text.write(toFile: u.path, atomically: true, encoding: .utf8)
            case "open":
                if let i = Int(u.lastPathComponent), model.chat.allChats.indices.contains(i) { expand(); model.chat.open(model.chat.allChats[i]); model.show(.chat) }
            case "expand": expand()
            case "effort": NotificationCenter.default.post(name: .notchDebugEffort, object: nil)
            case "snap":
                if let rep = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) {
                    canvas.cacheDisplay(in: canvas.bounds, to: rep)
                    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: u.path))
                }
            case "collapse": collapse("url")
            case "view": expand(); model.show(NotchView(rawValue: u.lastPathComponent) ?? .home)
            case "ask":
                expand()
                model.chatDraft = u.pathComponents.dropFirst().joined(separator: "/")
                model.submitChat()
            default: break
            }
        }
    }
}

/// `Notch --snapshots <dir>` renders every state from the real views and live data to PNGs,
/// with a menu-bar strip behind it, for visual review.
@MainActor func renderSnapshots(to dir: String) {
    let model = NotchModel()
    DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
        let states: [(String, Bool, NotchView)] = [("1-collapsed", false, .home), ("2-home", true, .home), ("2b-apps", true, .apps), ("3-timer", true, .timer),
                                                     ("4-chat", true, .chat), ("5-weather", true, .weather), ("6-more", true, .more),
                                                     ("7-settings", true, .settings), ("8-stopwatch", true, .stopwatch), ("9-note", true, .note)]
        for (name, expanded, view) in states {
            model.expanded = expanded
            model.view = view
            model.now = Date()
            let size = NSSize(width: Metrics.width(model) + 40, height: Metrics.height(model, menuBar: 24) + 20)
            let content = ZStack(alignment: .top) {
                LinearGradient(colors: [Color(white: 0.22), Color(white: 0.16)], startPoint: .top, endPoint: .bottom)
                Rectangle().fill(Color(white: 0.28)).frame(height: 24)
                NotchRoot(model: model, menuBarHeight: 24, onClickCollapsed: {})
                    .frame(width: Metrics.width(model), height: Metrics.height(model, menuBar: 24))
            }
            .frame(width: size.width, height: size.height)
            let r = ImageRenderer(content: content)
            r.scale = 2
            if let cg = r.cgImage {
                let rep = NSBitmapImageRep(cgImage: cg)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: dir + "/\(name).png"))
            }
        }
        print("weather:", model.weather.report.map { "\($0.place) \($0.temp)" } ?? (model.weather.lastError ?? "none"),
              "| media:", model.media.state.map { "\($0.source) \($0.title) \($0.status)" } ?? "none")
        exit(0)
    }
}

if let i = CommandLine.arguments.firstIndex(of: "--snapshots"), i + 1 < CommandLine.arguments.count {
    NSApplication.shared.setActivationPolicy(.prohibited)
    MainActor.assumeIsolated { renderSnapshots(to: CommandLine.arguments[i + 1]) }
    NSApplication.shared.run()
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()

// Clyra computer-use perception helper (macOS). Compiled on first use, cached locally.
//   ax                 JSON of the frontmost app: windows and visible UI elements (role, title, value, frame)
//   ocr <image.png>    JSON of text lines with frames (Vision, on-device) for apps that expose no accessibility tree
//   trusted            JSON { accessibility: Bool }
// It only READS. Input is injected by native-pointer.swift. Nothing leaves the machine.
import Foundation
import AppKit
import ApplicationServices
import Vision

func emit(_ object: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { exit(3) }
    FileHandle.standardOutput.write(data)
}
func fail(_ message: String) -> Never {
    emit(["ok": false, "error": message]); exit(0)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let verb = args.first else { fail("Usage: perception ax | ocr <png> | trusted") }

func attr<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value as? T
}
func frame(_ element: AXUIElement) -> [String: Double]? {
    var posRef: CFTypeRef?, sizeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let pos = posRef, let size = sizeRef else { return nil }
    var point = CGPoint.zero, dims = CGSize.zero
    AXValueGetValue(pos as! AXValue, .cgPoint, &point)
    AXValueGetValue(size as! AXValue, .cgSize, &dims)
    return ["x": Double(point.x), "y": Double(point.y), "w": Double(dims.width), "h": Double(dims.height)]
}

switch verb {
case "trusted":
    emit(["ok": true, "accessibility": AXIsProcessTrusted()])

case "ax":
    guard AXIsProcessTrusted() else { fail("macOS Accessibility permission is required to read the screen.") }
    guard let app = NSWorkspace.shared.frontmostApplication else { fail("No frontmost application.") }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    // Chromium and Electron apps only build their web accessibility tree when asked.
    AXUIElementSetAttributeValue(root, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    var elements: [[String: Any]] = []
    var windows: [[String: Any]] = []
    var budget = 340
    // Big Chromium/Electron trees answer slowly: read what arrives in time rather than stall every step.
    let deadline = Date().addingTimeInterval(2.4)
    let interesting: Set<String> = ["AXButton", "AXTextField", "AXTextArea", "AXSecureTextField", "AXCheckBox", "AXRadioButton",
        "AXPopUpButton", "AXComboBox", "AXLink", "AXMenuItem", "AXMenuBarItem", "AXTab", "AXTabGroup", "AXSlider", "AXStaticText",
        "AXRow", "AXCell", "AXImage", "AXMenuButton", "AXDisclosureTriangle", "AXSearchField", "AXHeading", "AXToolbar", "AXSheet"]
    // Breadth-first, so the whole visible page is covered before any one deep branch eats the budget.
    var queue: [(AXUIElement, Int, Int)] = []
    func walk(_ element: AXUIElement, depth: Int, window: Int) {
        if budget <= 0 || depth > 30 || Date() > deadline { return }
        let role: String = attr(element, kAXRoleAttribute as String) ?? ""
        let subrole: String = attr(element, kAXSubroleAttribute as String) ?? ""
        let title: String = attr(element, kAXTitleAttribute as String) ?? ""
        let desc: String = attr(element, kAXDescriptionAttribute as String) ?? ""
        var value = ""
        if let raw: CFTypeRef = attr(element, kAXValueAttribute as String) {
            if let s = raw as? String { value = s } else if let n = raw as? NSNumber { value = n.stringValue }
        }
        let secure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
        let label = [title, desc].first(where: { !$0.isEmpty }) ?? (role == "AXStaticText" ? value : "")
        if interesting.contains(role), let f = frame(element), f["w"]! > 1, f["h"]! > 1 {
            let enabled: Bool = attr(element, kAXEnabledAttribute as String) ?? true
            let focused: Bool = attr(element, kAXFocusedAttribute as String) ?? false
            let hasContent = !label.isEmpty || !value.isEmpty || ["AXTextField", "AXTextArea", "AXSecureTextField", "AXSearchField", "AXCheckBox", "AXPopUpButton", "AXSlider"].contains(role)
            if hasContent {
                budget -= 1
                var item: [String: Any] = ["i": elements.count, "role": role.replacingOccurrences(of: "AX", with: ""), "label": String(label.prefix(90)),
                    "frame": f, "enabled": enabled, "focused": focused, "window": window]
                if secure { item["secure"] = true } else if !value.isEmpty && role != "AXStaticText" { item["value"] = String(value.prefix(120)) }
                elements.append(item)
            }
        }
        var children: [AXUIElement]? = attr(element, kAXChildrenAttribute as String)
        if children == nil || children!.isEmpty { children = attr(element, "AXVisibleChildren") }
        for child in children ?? [] { queue.append((child, depth + 1, window)) }
    }
    let winList: [AXUIElement] = attr(root, kAXWindowsAttribute as String) ?? []
    for (index, win) in winList.prefix(4).enumerated() {
        let title: String = attr(win, kAXTitleAttribute as String) ?? ""
        let main: Bool = attr(win, kAXMainAttribute as String) ?? false
        let subrole: String = attr(win, kAXSubroleAttribute as String) ?? ""
        let modal: Bool = attr(win, kAXModalAttribute as String) ?? false
        windows.append(["i": index, "title": title, "main": main, "frame": frame(win) ?? [:], "subrole": subrole, "modal": modal || subrole == "AXDialog" || subrole == "AXSystemDialog"])
        queue.append((win, 0, index))
    }
    var head = 0
    while head < queue.count && budget > 0 && Date() < deadline {
        let (node, depth, window) = queue[head]
        head += 1
        walk(node, depth: depth, window: window)
    }
    // The menu bar lets the agent reach commands without guessing coordinates.
    var menus: [String] = []
    if let bar: AXUIElement = attr(root, kAXMenuBarAttribute as String), let items: [AXUIElement] = attr(bar, kAXChildrenAttribute as String) {
        for item in items { if let t: String = attr(item, kAXTitleAttribute as String), !t.isEmpty { menus.append(t) } }
    }
    var focusedElement: [String: Any] = [:]
    if let focus: AXUIElement = attr(root, kAXFocusedUIElementAttribute as String) {
        let role: String = attr(focus, kAXRoleAttribute as String) ?? ""
        focusedElement = ["role": role.replacingOccurrences(of: "AX", with: ""), "secure": role == "AXSecureTextField"]
    }
    emit(["ok": true, "app": app.localizedName ?? "", "bundle": app.bundleIdentifier ?? "", "pid": app.processIdentifier,
          "windows": windows, "menus": menus, "elements": elements, "focus": focusedElement, "truncated": budget <= 0])

case "press":
    // press <pid> <x> <y> [press|menu]: the Accessibility equivalent of a click on whatever control sits at that point.
    // Nothing moves the person's pointer. Buttons, links, tabs and menu items are pressed; fields are focused.
    guard AXIsProcessTrusted() else { fail("macOS Accessibility permission is required.") }
    guard args.count >= 4, let pid = pid_t(args[1]), let px = Float(args[2]), let py = Float(args[3]) else { fail("Usage: press pid x y [press|menu]") }
    let wantMenu = args.count >= 5 && args[4] == "menu"
    var hit: AXUIElement?
    // Asked of the app itself, so Clyra's own overlay windows on top are never what answers.
    // If the exact point lands on nothing pressable, nearby points are tried: a click that is a few pixels off still finds its control.
    let probes: [(Float, Float)] = [(0, 0), (8, 0), (-8, 0), (0, 8), (0, -8), (14, 10), (-14, -10), (14, -10), (-14, 10)]
    var found: AXUIElement?
    for (dx, dy) in probes {
        AXUIElementCopyElementAtPosition(AXUIElementCreateApplication(pid), px + dx, py + dy, &hit)
        guard let candidate = hit else { continue }
        var probe = candidate
        for _ in 0..<7 {
            var names: CFArray?
            AXUIElementCopyActionNames(probe, &names)
            let list = (names as? [String]) ?? []
            let role: String = attr(probe, kAXRoleAttribute as String) ?? ""
            if list.contains(wantMenu ? "AXShowMenu" : "AXPress") || (!wantMenu && ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(role)) { found = candidate; break }
            guard let parent: AXUIElement = attr(probe, kAXParentAttribute as String) else { break }
            probe = parent
        }
        if found != nil { break }
    }
    guard var node = found ?? hit else { fail("Nothing at that point.") }
    for _ in 0..<7 {
        var names: CFArray?
        AXUIElementCopyActionNames(node, &names)
        let actions = (names as? [String]) ?? []
        let role: String = attr(node, kAXRoleAttribute as String) ?? ""
        let action = wantMenu ? "AXShowMenu" : "AXPress"
        if actions.contains(action) {
            let result = AXUIElementPerformAction(node, action as CFString)
            emit(["ok": result == .success, "role": role, "via": action]); exit(0)
        }
        if !wantMenu && ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(role) {
            let result = AXUIElementSetAttributeValue(node, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            emit(["ok": result == .success, "role": role, "via": "focus"]); exit(0)
        }
        guard let parent: AXUIElement = attr(node, kAXParentAttribute as String) else { break }
        node = parent
    }
    emit(["ok": false, "error": "No pressable control there."])

case "app":
    // Cheap: just the frontmost app and its window titles, for planning before the first real look.
    guard AXIsProcessTrusted() else { fail("macOS Accessibility permission is required to read the screen.") }
    guard let front = NSWorkspace.shared.frontmostApplication else { fail("No frontmost application.") }
    let appRoot = AXUIElementCreateApplication(front.processIdentifier)
    let wins: [AXUIElement] = attr(appRoot, kAXWindowsAttribute as String) ?? []
    let titles = wins.prefix(4).map { (attr($0, kAXTitleAttribute as String) as String?) ?? "" }
    emit(["ok": true, "app": front.localizedName ?? "", "pid": front.processIdentifier, "windows": titles])

case "ocr":
    guard args.count >= 2, let image = NSImage(contentsOfFile: args[1]), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("Cannot read image.") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request]) } catch { fail("OCR failed: \(error.localizedDescription)") }
    var lines: [[String: Any]] = []
    for observation in (request.results ?? []).prefix(120) {
        guard let candidate = observation.topCandidates(1).first, candidate.confidence > 0.3 else { continue }
        let b = observation.boundingBox
        // Vision's origin is bottom-left; return top-left fractions.
        lines.append(["text": candidate.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height])
    }
    emit(["ok": true, "lines": lines])

default:
    fail("Unsupported perception verb.")
}

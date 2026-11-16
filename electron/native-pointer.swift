// Clyra's minimal native macOS mouse backend. Compiled on first authorised
// desktop-control action, cached locally; no external network or packages.
// CGEvent is a real OS input event and requires macOS Accessibility permission.
import Foundation
import ApplicationServices
import CoreGraphics

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(2)
}
if !AXIsProcessTrusted() { fail("macOS Accessibility permission is required for desktop control.") }
let args = Array(CommandLine.arguments.dropFirst())
if args.first == "type" {
    // type <base64 utf8 text> [delay_ms]: one real key event per character, a little uneven like a person typing.
    guard args.count >= 2, let raw = Data(base64Encoded: args[1]), let text = String(data: raw, encoding: .utf8) else { fail("Invalid text.") }
    let delay = args.count >= 3 ? max(0, min(400, Int(args[2]) ?? 45)) : 45
    let typer = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        var units = Array(String(scalar).utf16)
        if scalar == "\n" {
            for down in [true, false] { CGEvent(keyboardEventSource: typer, virtualKey: 36, keyDown: down)?.post(tap: .cghidEventTap) }
        } else {
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: typer, virtualKey: 0, keyDown: down) else { fail("Unable to create key event.") }
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
                event.post(tap: .cghidEventTap)
            }
        }
        let jitter = Int.random(in: -(delay / 4)...(delay / 4))
        usleep(useconds_t(max(8, delay + jitter) * 1000))
    }
    exit(0)
}
if args.first == "clickrestore" {
    // clickrestore <x> <y> [left|right] [count]: a real click, then the person's pointer goes straight back where it was.
    guard args.count >= 3, let cx = Double(args[1]), let cy = Double(args[2]) else { fail("Invalid arguments.") }
    let saved = CGEvent(source: nil)?.location ?? CGPoint(x: cx, y: cy)
    let at = CGPoint(x: cx, y: cy)
    let src = CGEventSource(stateID: .hidSystemState)
    let right = args.count >= 4 && args[3] == "right"
    let count = args.count >= 5 ? Int64(args[4]) ?? 1 : 1
    func post(_ kind: CGEventType, _ n: Int64 = 1) {
        guard let e = CGEvent(mouseEventSource: src, mouseType: kind, mouseCursorPosition: at, mouseButton: right ? .right : .left) else { fail("Unable to create CGEvent.") }
        e.setIntegerValueField(.mouseEventClickState, value: n)
        e.post(tap: .cghidEventTap)
    }
    post(.mouseMoved); usleep(25_000)
    for n in 1...max(1, count) { post(right ? .rightMouseDown : .leftMouseDown, n); usleep(35_000); post(right ? .rightMouseUp : .leftMouseUp, n); if n < count { usleep(40_000) } }
    usleep(20_000)
    CGWarpMouseCursorPosition(saved)
    exit(0)
}
if args.first == "clickpid" || args.first == "scrollpid" || args.first == "movepid" {
    // clickpid <pid> <x> <y> [left|right|middle] [count] | scrollpid <pid> <x> <y> <lines> | movepid <pid> <x> <y>
    // Events are delivered straight to one app: the person's own pointer never moves and nothing in front can intercept them.
    guard args.count >= 4, let pid = pid_t(args[1]), let px = Double(args[2]), let py = Double(args[3]) else { fail("Invalid arguments.") }
    let at = CGPoint(x: px, y: py)
    let src = CGEventSource(stateID: .privateState)
    func emit(_ kind: CGEventType, _ button: CGMouseButton, _ clicks: Int64 = 1) {
        guard let e = CGEvent(mouseEventSource: src, mouseType: kind, mouseCursorPosition: at, mouseButton: button) else { fail("Unable to create CGEvent.") }
        e.setIntegerValueField(.mouseEventClickState, value: clicks)
        e.postToPid(pid)
    }
    if args[0] == "movepid" { emit(.mouseMoved, .left); exit(0) }
    if args[0] == "scrollpid" {
        let lines = args.count >= 5 ? Int32(args[4]) ?? 0 : 0
        emit(.mouseMoved, .left); usleep(15_000)
        guard let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0) else { fail("Unable to create scroll event.") }
        e.location = at
        e.postToPid(pid)
        exit(0)
    }
    let name = args.count >= 5 ? args[4] : "left"
    let count = args.count >= 6 ? Int64(args[5]) ?? 1 : 1
    let button: CGMouseButton = name == "right" ? .right : name == "middle" ? .center : .left
    let down: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
    let up: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
    emit(.mouseMoved, .left)
    usleep(18_000)
    for n in 1...max(1, count) {
        emit(down, button, n)
        usleep(35_000)
        emit(up, button, n)
        if n < count { usleep(40_000) }
    }
    exit(0)
}
if args.count < 3 { fail("Usage: pointer move x y [duration_ms] | click x y [left|right|middle] | scroll x y delta") }
let verb = args[0]
guard let x = Double(args[1]), let y = Double(args[2]), x.isFinite, y.isFinite else { fail("Invalid pointer coordinates.") }
let point = CGPoint(x: x, y: y)
let source = CGEventSource(stateID: .hidSystemState)
func postMouse(_ kind: CGEventType, _ at: CGPoint, _ button: CGMouseButton) {
    guard let event = CGEvent(mouseEventSource: source, mouseType: kind, mouseCursorPosition: at, mouseButton: button) else { fail("Unable to create CGEvent.") }
    event.post(tap: .cghidEventTap)
}
switch verb {
case "move":
    let current = CGEvent(source: nil)?.location ?? point
    let duration = args.count >= 4 ? max(0, min(1400, Int(args[3]) ?? 0)) : 0
    let steps = duration == 0 ? 1 : max(2, min(90, Int(ceil(Double(duration) / 16.0))))
    for index in 1...steps {
        let t = Double(index) / Double(steps)
        let eased = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
        let next = CGPoint(x: current.x + (point.x - current.x) * eased, y: current.y + (point.y - current.y) * eased)
        postMouse(.mouseMoved, next, .left)
        if index < steps { usleep(useconds_t(max(1000, duration * 1000 / steps))) }
    }
case "click":
    let name = args.count >= 4 ? args[3] : "left"
    let button: CGMouseButton = name == "right" ? .right : name == "middle" ? .center : .left
    let down: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
    let up: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
    postMouse(down, point, button)
    usleep(45_000)
    postMouse(up, point, button)
case "scroll":
    let delta = args.count >= 4 ? Int32(args[3]) ?? 0 : 0
    guard let event = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) else { fail("Unable to create scroll event.") }
    event.post(tap: .cghidEventTap)
default:
    fail("Unsupported native pointer action.")
}

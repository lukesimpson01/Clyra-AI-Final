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
    let duration = args.count >= 4 ? max(0, min(500, Int(args[3]) ?? 0)) : 0
    let steps = duration == 0 ? 1 : max(2, min(30, Int(ceil(Double(duration) / 16.0))))
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

import Foundation
import CoreGraphics

enum NotchMotion {
    static func frame(on screen: CGRect, size: CGSize, scale: CGFloat = 1) -> CGRect {
        let width = (size.width * scale).rounded() / scale
        let height = (size.height * scale).rounded() / scale
        let left = ((screen.midX - width / 2) * scale).rounded() / scale
        return CGRect(x: left, y: screen.maxY - height, width: width, height: height)
    }

    static func envelope(from start: CGSize, to end: CGSize) -> CGSize {
        // Reserve the small spring overshoot within the same native window.
        CGSize(width: max(start.width, end.width) + abs(end.width - start.width) * 0.02,
               height: max(start.height, end.height) + abs(end.height - start.height) * 0.02)
    }

    static func contentFrame(in window: CGRect, on screen: CGRect, size: CGSize, scale: CGFloat) -> CGRect {
        let visible = frame(on: screen, size: size, scale: scale)
        return CGRect(x: visible.minX - window.minX, y: window.maxY - visible.maxY,
                      width: visible.width, height: visible.height)
    }

    static func silhouette(in rect: CGRect, ear: CGFloat, radius: CGFloat, topBleed: CGFloat = 0, closed: Bool = true) -> CGPath {
        let path = CGMutablePath()
        let e = max(0, min(ear, rect.height, rect.width / 2))
        let r = max(0, min(radius, rect.height - e, rect.width / 2 - e))
        let left = rect.minX, right = rect.maxX, top = rect.minY, bottom = rect.maxY
        path.move(to: CGPoint(x: left, y: top - topBleed))
        path.addLine(to: CGPoint(x: left, y: top))
        path.addQuadCurve(to: CGPoint(x: left + e, y: top + e), control: CGPoint(x: left + e, y: top))
        path.addLine(to: CGPoint(x: left + e, y: bottom - r))
        path.addQuadCurve(to: CGPoint(x: left + e + r, y: bottom), control: CGPoint(x: left + e, y: bottom))
        path.addLine(to: CGPoint(x: right - e - r, y: bottom))
        path.addQuadCurve(to: CGPoint(x: right - e, y: bottom - r), control: CGPoint(x: right - e, y: bottom))
        path.addLine(to: CGPoint(x: right - e, y: top + e))
        path.addQuadCurve(to: CGPoint(x: right, y: top), control: CGPoint(x: right - e, y: top))
        path.addLine(to: CGPoint(x: right, y: top - topBleed))
        if closed { path.closeSubpath() }
        return path
    }

    // Spring parameters from Boring Notch's ContentView at b7611bbf.
    static let openResponse: TimeInterval = 0.42
    static let closeResponse: TimeInterval = 0.45
    static let openDamping = 0.8
    static let closeDamping = 1.0

    static func duration(opening: Bool) -> TimeInterval { opening ? 0.39 : 0.36 }

    static func progress(_ fraction: Double, opening: Bool) -> Double {
        let t = min(1, max(0, fraction))
        let response = opening ? openResponse : closeResponse
        let time = 2 * .pi * duration(opening: opening) * t / response
        let displacement: Double
        if opening {
            let oscillation = sqrt(1 - openDamping * openDamping)
            displacement = exp(-openDamping * time) * (cos(oscillation * time) + openDamping / oscillation * sin(oscillation * time))
        } else {
            displacement = exp(-time) * (1 + time)
        }
        let tail = max(0, (t - 0.78) / 0.22)
        let remaining = 1 - tail * tail * (3 - 2 * tail)
        return t == 1 ? 1 : 1 - displacement * remaining
    }
}

/// One-axis spring. Velocity survives a retarget, so interrupting a transition bends it instead of restarting it.
struct Spring {
    var value: CGFloat
    var target: CGFloat
    var velocity: CGFloat = 0
    var stiffness: CGFloat
    var damping: CGFloat

    init(_ value: CGFloat, stiffness: CGFloat = 400, damping: CGFloat = 30) {
        self.value = value
        self.target = value
        self.stiffness = stiffness
        self.damping = damping
    }

    var settled: Bool { abs(value - target) < 0.05 && abs(velocity) < 0.5 }

    mutating func snap(to v: CGFloat) { value = v; target = v; velocity = 0 }

    mutating func step(_ dt: CGFloat) {
        var left = min(dt, 1.0 / 20)
        while left > 0 {
            let h = min(left, 1.0 / 240)
            velocity += (-stiffness * (value - target) - damping * velocity) * h
            value += velocity * h
            left -= h
        }
        if settled { snap(to: target) }
    }
}

extension NotchMotion {
    /// Grow with a little overshoot (liquid), shrink without any, and let the axes run at slightly different rates.
    static func tune(_ s: inout Spring, toward target: CGFloat, bounce: CGFloat) {
        let growing = target > s.value
        s.stiffness = growing ? 430 - bounce * 60 : 520
        s.damping = growing ? 25 + bounce * 4 : 44
        s.target = target
    }
}

extension NotchMotion {
    /// Length of a path (curves sampled), used to run a light around the edge at a steady speed.
    static func length(of path: CGPath) -> CGFloat {
        var total: CGFloat = 0
        var current = CGPoint.zero
        var start = CGPoint.zero
        path.applyWithBlock { pointer in
            let e = pointer.pointee
            switch e.type {
            case .moveToPoint:
                current = e.points[0]; start = current
            case .addLineToPoint:
                total += hypot(e.points[0].x - current.x, e.points[0].y - current.y)
                current = e.points[0]
            case .addQuadCurveToPoint:
                let c = e.points[0], end = e.points[1]
                var previous = current
                for i in 1...8 {
                    let t = CGFloat(i) / 8
                    let u = 1 - t
                    let x1 = u * u * current.x
                    let x2 = 2 * u * t * c.x
                    let x3 = t * t * end.x
                    let y1 = u * u * current.y
                    let y2 = 2 * u * t * c.y
                    let y3 = t * t * end.y
                    let point = CGPoint(x: x1 + x2 + x3, y: y1 + y2 + y3)
                    total += hypot(point.x - previous.x, point.y - previous.y)
                    previous = point
                }
                current = end
            case .closeSubpath:
                total += hypot(start.x - current.x, start.y - current.y)
                current = start
            default: break
            }
        }
        return total
    }
}

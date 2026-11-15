import Foundation
import CoreGraphics

var passed = 0, failed = 0
func check(_ c: Bool, _ n: String, line: Int = #line) { if c { passed += 1 } else { failed += 1; print("FAIL [\(line)] \(n)") } }

// Timer engine: wall-clock based, survives "sleep" (time jumps) and relaunch.
do {
    let suite = UserDefaults(suiteName: "notch-tests")!
    suite.removePersistentDomain(forName: "notch-tests")
    var t0 = Date(timeIntervalSince1970: 1_000_000)
    let e = TimerEngine(store: suite, key: "t"); e.now = { t0 }
    var finished: [String] = []
    e.onFinish = { finished.append($0.label) }
    let a = e.start(seconds: 300, label: "Tea")
    check(a.label == "Tea" && e.running.count == 1, "start")
    t0 += 100; e.pause(a.id)
    check(e.timers[0].status == .paused && abs(e.timers[0].remaining - 200) < 0.01, "pause keeps remaining")
    t0 += 1000
    check(abs(e.timers[0].remaining(at: t0) - 200) < 0.01, "paused time frozen")
    e.resume(a.id); t0 += 150
    check(abs(e.timers[0].remaining(at: t0) - 50) < 0.01, "resume counts down")
    let relaunched = TimerEngine(store: suite, key: "t"); relaunched.now = { t0 }
    check(relaunched.timers.count == 1 && abs(relaunched.timers[0].remaining(at: t0) - 50) < 0.01, "persists across relaunch")
    t0 += 3600  // a long sleep
    e.reconcile()
    check(e.timers[0].status == .done && finished == ["Tea"], "finishes once after sleep")
    e.reconcile()
    check(finished.count == 1, "no double finish")
    e.restart(a.id)
    check(e.timers[0].status == .running && abs(e.timers[0].remaining(at: t0) - 300) < 0.01, "restart")
    let b = e.start(seconds: 60)
    check(e.soonest?.id == b.id, "soonest")
    e.cancel(b.id)
    check(e.timers.count == 1, "cancel")
    check(e.start(seconds: 0).duration == 1, "minimum 1 s")
}

// Natural-language timer requests.
do {
    let r1 = TimerEngine.parseRequest("Set a timer for 20 minutes")
    check(r1?.seconds == 1200, "20 minutes")
    check(TimerEngine.parseRequest("timer 1 hour 30 min")?.seconds == 5400, "1h30")
    check(TimerEngine.parseRequest("start a 45 sec timer")?.seconds == 45, "45 s")
    check(TimerEngine.parseRequest("what's the weather") == nil, "not a timer")
    check(TimerEngine.parseRequest("timer for 10 minutes for pasta")?.label == "Pasta", "label")
    check(TimerEngine.clock(65) == "1:05" && TimerEngine.clock(3725) == "1:02:05", "clock format")
}

// SSE parsing and agent events.
do {
    var p = SSEParser()
    var out = p.feed("data: {\"type\":\"text\",\"text\":\"Hel")
    check(out.isEmpty, "partial chunk held")
    out = p.feed("lo\"}\n\n: keep-alive\n\ndata: {\"type\":\"done\",\"text\":\"Hello\",\"citations\":[],\"diagnostics\":{}}\n\n")
    check(out.count == 2, "two events, comment skipped")
    check(decodeAgentEvent(out[0]) == .text("Hello"), "text event")
    check(decodeAgentEvent(out[1]) == .done("Hello"), "done event")
    check(decodeAgentEvent("{\"type\":\"step\",\"id\":\"1\",\"tool\":\"web\",\"label\":\"Searched\",\"state\":\"done\"}") == .step("1", "✓ Searched"), "step")
    check(decodeAgentEvent("{\"type\":\"error\",\"code\":\"failed\",\"message\":\"x\"}") == .error("x"), "error")
    check(decodeAgentEvent("not json") == nil, "garbage ignored")
}

// Open-Meteo parsing: real shape accepted, malformed rejected (no partial "weather").
do {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let json = """
    {"current":{"temperature_2m":18.4,"apparent_temperature":17.1,"weather_code":2,"is_day":1},
     "hourly":{"time":[1799997000,1800000000,1800003600],"temperature_2m":[18,18.4,19],"weather_code":[2,2,3],"precipitation_probability":[0,10,null]},
     "daily":{"time":[1799971200,1800057600],"temperature_2m_max":[21,23],"temperature_2m_min":[12,13],"weather_code":[2,61],"precipitation_probability_max":[10,80]}}
    """
    let r = try? parseOpenMeteo(Data(json.utf8), place: "Sydney", now: now)
    check(r != nil && r!.temp == 18.4 && r!.todayMax == 21 && r!.days.count == 2 && r!.days[1].rain == 80, "parse")
    check(r?.hours.count == 3 && r?.hours[2].rain == 0, "null rain → 0")
    check((try? parseOpenMeteo(Data("{\"current\":{}}".utf8), place: "x")) == nil, "malformed rejected")
    check(WeatherCode.symbol(0) == "sun.max.fill" && WeatherCode.symbol(0, day: false) == "moon.stars.fill", "symbols")
}

do {
    let screen = CGRect(x: -1440, y: 100, width: 1440, height: 900)
    for opening in [false, true] {
        let staysPinned = (0...120).allSatisfy { step in
            let p = NotchMotion.progress(Double(step) / 120, opening: opening)
            let frame = NotchMotion.frame(on: screen, size: CGSize(width: 200 + 440 * p, height: 31 + 369 * p))
            return abs(frame.maxY - screen.maxY) < 0.00001 && abs(frame.midX - screen.midX) <= 0.5
        }
        check(staysPinned, "notch stays centered and top-aligned through every animation sample")
        check(NotchMotion.progress(0, opening: opening) == 0 && NotchMotion.progress(1, opening: opening) == 1,
              "animation starts and ends at the intended sizes")
    }
    let samples = (0...120).map { Double($0) / 120 }
    let open = samples.map { NotchMotion.progress($0, opening: true) }
    let close = samples.map { NotchMotion.progress($0, opening: false) }
    check((open.max() ?? 0) > 1 && (open.max() ?? 0) < 1.02, "opening spring has a small overshoot")
    check(zip(close, close.dropFirst()).allSatisfy { $0.0 <= $0.1 }, "release settles without overshooting")
    let retina = NotchMotion.frame(on: screen, size: CGSize(width: 233.37, height: 101.27), scale: 2)
    check(retina.maxY == screen.maxY && (retina.minX * 2).rounded() == retina.minX * 2 && (retina.minY * 2).rounded() == retina.minY * 2,
          "the animated frame aligns to Retina pixels without detaching from the screen top")
    let layouts = [CGSize(width: 198, height: 25), CGSize(width: 450, height: 196),
                   CGSize(width: 640, height: 400), CGSize(width: 390, height: 210)]
    let transitions = zip(layouts, layouts.dropFirst())
    for (from, to) in transitions {
        for (start, end) in [(from, to), (to, from)] {
            let canvas = NotchMotion.frame(on: screen, size: NotchMotion.envelope(from: start, to: end), scale: 2)
            let opening = end.width > start.width || end.height > start.height
            let fits = samples.allSatisfy { phase in
                let fraction = NotchMotion.progress(phase, opening: opening)
                let size = CGSize(width: start.width + (end.width - start.width) * fraction,
                                  height: start.height + (end.height - start.height) * fraction)
                let rect = NotchMotion.contentFrame(in: canvas, on: screen, size: size, scale: 2)
                return rect.minY == 0 && CGRect(origin: .zero, size: canvas.size).contains(rect)
            }
            check(fits, "the silhouette stays flush inside the same canvas through the complete transition")
        }
    }
}

do {
    let display = CGRect(x: -1440, y: 100, width: 1440, height: 900)
    let pages = [CGSize(width: 198, height: 25), CGSize(width: 450, height: 232),
                 CGSize(width: 640, height: 400), CGSize(width: 640, height: 340),
                 CGSize(width: 640, height: 420), CGSize(width: 480, height: 320),
                 CGSize(width: 390, height: 210), CGSize(width: 198, height: 25)]
    for scale: CGFloat in [1, 2] {
        let canvas = NotchMotion.frame(on: display, size: CGSize(width: 654, height: 429), scale: scale)
        let opaque = zip(pages, pages.dropFirst()).allSatisfy { start, end in
            (0...120).allSatisfy { step in
                let opening = end.height > start.height || end.width > start.width
                let progress = NotchMotion.progress(Double(step) / 120, opening: opening)
                let size = CGSize(width: start.width + (end.width - start.width) * progress,
                                  height: start.height + (end.height - start.height) * progress)
                let frame = NotchMotion.contentFrame(in: canvas, on: display, size: size, scale: scale)
                let path = NotchMotion.silhouette(in: frame, ear: 19, radius: 24, topBleed: 2 / scale)
                var pixels = [UInt8](repeating: 0, count: 32 * 4 * 3)
                return pixels.withUnsafeMutableBytes { bytes in
                    guard let ctx = CGContext(data: bytes.baseAddress, width: 32, height: 3, bitsPerComponent: 8,
                                              bytesPerRow: 128, space: CGColorSpaceCreateDeviceRGB(),
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                    ctx.translateBy(x: 16 - frame.midX * scale, y: 3)
                    ctx.scaleBy(x: scale, y: -scale)
                    ctx.setFillColor(red: 0, green: 0, blue: 0, alpha: 1)
                    ctx.addPath(path)
                    ctx.fillPath()
                    return stride(from: 3, to: bytes.count, by: 4).allSatisfy { bytes[$0] == 255 }
                }
            }
        }
        check(opaque, "rasterized notch has an opaque attachment on every sampled frame at \(scale)x")
    }
}

do {
    let stopwatch = Stopwatch()
    var elapsed: TimeInterval = 100
    stopwatch.now = { elapsed }
    stopwatch.start()
    elapsed += 1.234
    check(abs(stopwatch.elapsed - 1.234) < 0.00001, "monotonic stopwatch includes fractional seconds")
    stopwatch.stop()
    elapsed += 60
    check(abs(stopwatch.elapsed - 1.234) < 0.00001, "paused stopwatch stays still")
    stopwatch.start()
    elapsed += 0.766
    check(abs(stopwatch.elapsed - 2.0) < 0.00001, "resume preserves subsecond precision")
}

do {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
    let start = cal.date(from: DateComponents(year: 2026, month: 11, day: 14, hour: 8))!
    let alarm = NotchAlarm(hour: 7, minute: 30, weekdays: [2])
    let next = alarm.next(after: start, calendar: cal)
    check(next.map { cal.component(.weekday, from: $0) } == 2, "alarm respects selected repeat days")
    check(next.map { cal.component(.minute, from: $0) } == 30, "alarm respects the chosen minute")
    check(NotchAlarm(hour: 0, minute: 0, weekdays: []).label == "12:00 AM", "midnight uses AM")
    check(NotchAlarm(hour: 12, minute: 0, weekdays: []).label == "12:00 PM", "noon uses PM")
}

// Spring: settles on target, overshoots when growing, never when shrinking, keeps velocity across a retarget.
do {
    var grow = Spring(100)
    NotchMotion.tune(&grow, toward: 400, bounce: 1)
    var peak: CGFloat = 0
    for _ in 0..<600 { grow.step(1.0 / 120); peak = max(peak, grow.value) }
    check(grow.settled && grow.value == 400, "spring settles on target")
    check(peak <= 400.5, "a wide move never overshoots")
    var short = Spring(100)
    NotchMotion.tune(&short, toward: 160, bounce: 1)
    var shortPeak: CGFloat = 0
    for _ in 0..<600 { short.step(1.0 / 120); shortPeak = max(shortPeak, short.value) }
    check(shortPeak > 160 && shortPeak < 160 * 1.12, "a short move keeps a little life")
    var shrink = Spring(400)
    NotchMotion.tune(&shrink, toward: 100, bounce: 1)
    var floor: CGFloat = 400
    for _ in 0..<600 { shrink.step(1.0 / 120); floor = min(floor, shrink.value) }
    check(shrink.value == 100 && floor >= 99.5, "shrinking never undershoots")
    var mid = Spring(100)
    NotchMotion.tune(&mid, toward: 400, bounce: 1)
    for _ in 0..<12 { mid.step(1.0 / 120) }
    let v = mid.velocity
    NotchMotion.tune(&mid, toward: 200, bounce: 1)
    check(mid.velocity == v, "retarget keeps velocity")
}

print("\(passed) checks passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)

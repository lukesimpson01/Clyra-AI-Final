// Clyra Location — a tiny background helper that asks macOS Location Services for this Mac's position and prints one
// JSON line: {"ok":true,"lat":..,"lon":..,"accuracy":..} or {"ok":false,"error":"denied|restricted|disabled|timeout|..."}.
// It is a separate app bundle so macOS shows its own "Clyra would like to use your location" prompt even when the
// Electron dev binary's prompt never surfaces.
import CoreLocation
import Foundation

final class Locator: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    var best: CLLocation?
    var finished = false
    let deadline: Date

    init(timeout: TimeInterval) {
        deadline = Date().addingTimeInterval(timeout)
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
    }

    func emit(_ object: [String: Any]) {
        guard !finished else { return }
        finished = true
        if let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) {
            print(text)
            fflush(stdout)
        }
        exit(0)
    }

    func start() {
        guard CLLocationManager.locationServicesEnabled() else { emit(["ok": false, "error": "disabled"]); return }
        handle(manager.authorizationStatus)
    }

    func handle(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied:
            emit(["ok": false, "error": "denied"])
        case .restricted:
            emit(["ok": false, "error": "restricted"])
        default:
            manager.startUpdatingLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        handle(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 {
            if best == nil || location.horizontalAccuracy < best!.horizontalAccuracy { best = location }
        }
        // Good enough for street-level framing: stop as soon as the fix is tight.
        if let fix = best, fix.horizontalAccuracy <= 65 { report(fix) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let clError = error as? CLError, clError.code == .denied { emit(["ok": false, "error": "denied"]) }
    }

    func report(_ fix: CLLocation) {
        emit(["ok": true, "lat": fix.coordinate.latitude, "lon": fix.coordinate.longitude, "accuracy": fix.horizontalAccuracy, "at": fix.timestamp.timeIntervalSince1970 * 1000])
    }

    func tick() {
        if Date() >= deadline {
            if let fix = best { report(fix) } else { emit(["ok": false, "error": "timeout"]) }
        }
    }
}

let timeoutArgument = CommandLine.arguments.dropFirst().first.flatMap(Double.init) ?? 12
let locator = Locator(timeout: timeoutArgument)
locator.start()
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in locator.tick() }
RunLoop.main.run()

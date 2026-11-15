import Foundation
import CoreLocation

// Real weather from Open-Meteo (free, no key; attribution shown in the weather view).
// Location comes from Location Services when allowed, otherwise from a city typed in Settings.

struct WeatherReport: Codable, Equatable {
    struct Hour: Codable, Equatable { var time: Date; var temp: Double; var code: Int; var rain: Int }
    struct Day: Codable, Equatable { var date: Date; var min: Double; var max: Double; var code: Int; var rain: Int }
    var place: String
    var fetchedAt: Date
    var temp: Double
    var feelsLike: Double
    var code: Int
    var isDay: Bool
    var todayMin: Double
    var todayMax: Double
    var hours: [Hour]
    var days: [Day]
}

enum WeatherCode {
    static func symbol(_ code: Int, day: Bool = true) -> String {
        switch code {
        case 0: return day ? "sun.max.fill" : "moon.stars.fill"
        case 1, 2: return day ? "cloud.sun.fill" : "cloud.moon.fill"
        case 3: return "cloud.fill"
        case 45, 48: return "cloud.fog.fill"
        case 51...57: return "cloud.drizzle.fill"
        case 61...67, 80...82: return "cloud.rain.fill"
        case 71...77, 85, 86: return "cloud.snow.fill"
        case 95...99: return "cloud.bolt.rain.fill"
        default: return "cloud.fill"
        }
    }

    static func text(_ code: Int) -> String {
        switch code {
        case 0: return "Clear"
        case 1: return "Mostly Clear"
        case 2: return "Partly Cloudy"
        case 3: return "Cloudy"
        case 45, 48: return "Fog"
        case 51...57: return "Drizzle"
        case 61...65: return "Rain"
        case 66, 67: return "Freezing Rain"
        case 71...77: return "Snow"
        case 80...82: return "Showers"
        case 85, 86: return "Snow Showers"
        case 95...99: return "Thunderstorms"
        default: return "—"
        }
    }
}

enum WeatherError: Error, LocalizedError {
    case noLocation, badResponse, cityNotFound
    var errorDescription: String? {
        switch self {
        case .noLocation: return "Set a city in Settings or allow Location Services."
        case .badResponse: return "Weather service didn't answer."
        case .cityNotFound: return "City not found."
        }
    }
}

/// Parses an Open-Meteo forecast response. Throws on anything malformed so no partial data is shown as real.
func parseOpenMeteo(_ data: Data, place: String, now: Date = Date()) throws -> WeatherReport {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let cur = root["current"] as? [String: Any],
          let temp = cur["temperature_2m"] as? Double,
          let feels = cur["apparent_temperature"] as? Double,
          let code = cur["weather_code"] as? Int,
          let hourly = root["hourly"] as? [String: Any],
          let hTimes = hourly["time"] as? [Double],
          let hTemps = hourly["temperature_2m"] as? [Double],
          let hCodes = hourly["weather_code"] as? [Int],
          let hRainRaw = hourly["precipitation_probability"] as? [Any],
          let daily = root["daily"] as? [String: Any],
          let dTimes = daily["time"] as? [Double],
          let dMax = daily["temperature_2m_max"] as? [Double],
          let dMin = daily["temperature_2m_min"] as? [Double],
          let dCodes = daily["weather_code"] as? [Int],
          let dRainRaw = daily["precipitation_probability_max"] as? [Any],
          !dTimes.isEmpty, dMax.count == dTimes.count, dMin.count == dTimes.count,
          hTemps.count == hTimes.count, hCodes.count == hTimes.count
    else { throw WeatherError.badResponse }
    let isDay = (cur["is_day"] as? Int ?? 1) == 1
    let hRain = hRainRaw.map { $0 as? Int }, dRain = dRainRaw.map { $0 as? Int }
    let hours = hTimes.indices
        .map { WeatherReport.Hour(time: Date(timeIntervalSince1970: hTimes[$0]), temp: hTemps[$0], code: hCodes[$0],
                                  rain: $0 < hRain.count ? (hRain[$0] ?? 0) : 0) }
        .filter { $0.time > now.addingTimeInterval(-3600) }
        .prefix(12)
    let days = dTimes.indices.map {
        WeatherReport.Day(date: Date(timeIntervalSince1970: dTimes[$0]), min: dMin[$0], max: dMax[$0],
                          code: $0 < dCodes.count ? dCodes[$0] : 0, rain: $0 < dRain.count ? (dRain[$0] ?? 0) : 0)
    }
    return WeatherReport(place: place, fetchedAt: now, temp: temp, feelsLike: feels, code: code, isDay: isDay,
                         todayMin: dMin[0], todayMax: dMax[0], hours: Array(hours), days: days)
}

struct WeatherCity: Codable, Identifiable {
    let id: Int
    let name: String
    let latitude: Double
    let longitude: Double
    let admin1: String?
    let country: String?
    var label: String { [Optional(name), admin1 == name ? nil : admin1, country].compactMap { $0 }.joined(separator: ", ") }
}

final class WeatherService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var pendingLocation: ((CLLocation?) -> Void)?
    private(set) var report: WeatherReport?
    private(set) var lastError: String?
    private var loading = false
    private var generation = 0
    var onChange: (() -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        if let data = UserDefaults.standard.data(forKey: "weatherCache"),
           let cached = try? JSONDecoder().decode(WeatherReport.self, from: data) {
            report = cached
        }
    }

    var city: String { UserDefaults.standard.string(forKey: "weatherCity") ?? "" }

    /// Refreshes when the cache is older than 30 minutes (or always when forced).
    func refresh(force: Bool = false) {
        if loading { return }
        if !force, let r = report, Date().timeIntervalSince(r.fetchedAt) < 1800 { return }
        loading = true
        generation += 1
        let request = generation
        resolvePlace { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.generation == request else { return }
                switch result {
                case .failure(let e): self.finish(error: e.localizedDescription)
                case .success(let (lat, lon, name)): self.fetch(lat: lat, lon: lon, place: name, request: request)
                }
            }
        }
    }

    func choose(_ city: WeatherCity) {
        let defaults = UserDefaults.standard
        defaults.set(city.name, forKey: "weatherCity")
        defaults.set(try? JSONEncoder().encode(city), forKey: "weatherSelectedCity")
        generation += 1
        loading = true
        fetch(lat: city.latitude, lon: city.longitude, place: city.label, request: generation)
    }

    func useCurrentLocation() {
        UserDefaults.standard.removeObject(forKey: "weatherCity")
        UserDefaults.standard.removeObject(forKey: "weatherSelectedCity")
        loading = false
        refresh(force: true)
    }

    func suggestions(_ query: String) async throws -> [WeatherCity] {
        struct Results: Decodable { let results: [WeatherCity]? }
        var url = URLComponents(string: "https://geocoding-api.open-meteo.com/v1/search")!
        url.queryItems = [.init(name: "name", value: query), .init(name: "count", value: "6"), .init(name: "language", value: "en")]
        let (data, response) = try await URLSession.shared.data(from: url.url!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw WeatherError.badResponse }
        return try JSONDecoder().decode(Results.self, from: data).results ?? []
    }

    private func finish(error: String?) {
        DispatchQueue.main.async {
            self.loading = false
            self.lastError = error
            self.onChange?()
        }
    }

    private func resolvePlace(_ done: @escaping (Result<(Double, Double, String), Error>) -> Void) {
        if !city.isEmpty {
            if let data = UserDefaults.standard.data(forKey: "weatherSelectedCity"),
               let chosen = try? JSONDecoder().decode(WeatherCity.self, from: data), chosen.name == city {
                done(.success((chosen.latitude, chosen.longitude, chosen.label)))
                return
            }
            geocode(city, done)
            return
        }
        let status = manager.authorizationStatus
        if status == .denied || status == .restricted {
            done(.failure(WeatherError.noLocation))
            return
        }
        pendingLocation = { [weak self] loc in
            guard let loc else { done(.failure(WeatherError.noLocation)); return }
            CLGeocoder().reverseGeocodeLocation(loc) { marks, _ in
                let name = marks?.first?.locality ?? "Current Location"
                done(.success((loc.coordinate.latitude, loc.coordinate.longitude, name)))
            }
            _ = self
        }
        if status == .notDetermined { manager.requestWhenInUseAuthorization() }
        manager.requestLocation()
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        pendingLocation?(locations.last)
        pendingLocation = nil
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        pendingLocation?(nil)
        pendingLocation = nil
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        if pendingLocation != nil, m.authorizationStatus == .denied { pendingLocation?(nil); pendingLocation = nil }
    }

    private func geocode(_ name: String, _ done: @escaping (Result<(Double, Double, String), Error>) -> Void) {
        var c = URLComponents(string: "https://geocoding-api.open-meteo.com/v1/search")!
        c.queryItems = [.init(name: "name", value: name), .init(name: "count", value: "1")]
        URLSession.shared.dataTask(with: c.url!) { data, _, _ in
            guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let first = (root["results"] as? [[String: Any]])?.first,
                  let lat = first["latitude"] as? Double, let lon = first["longitude"] as? Double
            else { done(.failure(WeatherError.cityNotFound)); return }
            done(.success((lat, lon, first["name"] as? String ?? name)))
        }.resume()
    }

    private func fetch(lat: Double, lon: Double, place: String, request: Int) {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            .init(name: "latitude", value: String(format: "%.3f", lat)),
            .init(name: "longitude", value: String(format: "%.3f", lon)),
            .init(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day"),
            .init(name: "hourly", value: "temperature_2m,weather_code,precipitation_probability"),
            .init(name: "daily", value: "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max"),
            .init(name: "timezone", value: "auto"),
            .init(name: "timeformat", value: "unixtime"),
            .init(name: "forecast_days", value: "6"),
        ]
        URLSession.shared.dataTask(with: c.url!) { [weak self] data, resp, _ in
            let r = (resp as? HTTPURLResponse)?.statusCode == 200 ? data.flatMap { try? parseOpenMeteo($0, place: place) } : nil
            DispatchQueue.main.async {
                guard let self, self.generation == request else { return }
                guard let r else {
                    self.finish(error: self.report == nil ? WeatherError.badResponse.localizedDescription : "Offline · showing last update")
                    return
                }
                self.report = r
                if let enc = try? JSONEncoder().encode(r) { UserDefaults.standard.set(enc, forKey: "weatherCache") }
                self.finish(error: nil)
            }
        }.resume()
    }
}

import AppKit

// Now Playing for Spotify and Apple Music. Both apps broadcast a distributed notification on every
// play/pause/track change, so this is event-driven; AppleScript is only used for artwork, the exact
// position and the transport buttons (macOS asks once for Automation permission per app).
// The system adapter also supplies browser and other macOS Now Playing sessions.

struct MediaState: Equatable {
    enum Status { case playing, paused }
    var source: String          // "Spotify" | "Music"
    var bundleID: String
    var status: Status
    var title: String
    var artist: String
    var album: String
    var duration: TimeInterval?
    var position: TimeInterval?
    var positionAt: Date
    var artworkURL: String?

    func position(at now: Date) -> TimeInterval? {
        guard let p = position else { return nil }
        let live = status == .playing ? p + now.timeIntervalSince(positionAt) : p
        return duration.map { min(live, $0) } ?? live
    }
}

final class MediaMonitor {
    private(set) var state: MediaState?
    private(set) var artwork: NSImage?
    var onChange: (() -> Void)?
    private var artworkKey: String?
    private var automationDenied = Set<String>()
    private let system = SystemMedia()
    private var systemActive = false
    private var systemBundle: String?
    private var spotify: MediaState?
    private var recentSystem: [String: Any]?
    private(set) var prohibitsSkip = false
    private let queue = DispatchQueue(label: "notch.media")

    static let players = [("Spotify", "com.spotify.client", "com.spotify.client.PlaybackStateChanged"),
                          ("Music", "com.apple.Music", "com.apple.Music.playerInfo")]

    init() {
        let dc = DistributedNotificationCenter.default()
        for (name, bundle, note) in MediaMonitor.players {
            dc.addObserver(forName: Notification.Name(note), object: nil, queue: .main) { [weak self] n in
                guard let self else { return }
                if let info = n.userInfo, info["Name"] != nil || (info["Player State"] as? String)?.lowercased() == "stopped" {
                    self.handle(info, source: name, bundle: bundle)
                } else {
                    self.refreshFromApps()
                }
            }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didLaunchApplicationNotification,
                                                          object: nil, queue: .main) { [weak self] n in
            let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            guard MediaMonitor.players.contains(where: { $0.1 == app?.bundleIdentifier }) else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.refreshFromApps() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didTerminateApplicationNotification,
                                                          object: nil, queue: .main) { [weak self] n in
            let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if app?.bundleIdentifier == "com.spotify.client" { self?.spotify = nil }
            if let self, app?.bundleIdentifier == self.state?.bundleID {
                self.clear()
                if app?.bundleIdentifier == self.systemBundle {
                    self.recentSystem = nil
                    self.systemActive = false
                    self.systemBundle = nil
                    self.prohibitsSkip = false
                } else {
                    self.receiveSystem(self.recentSystem)
                }
                self.refreshFromApps()
            }
        }
        refreshFromApps()
        system.onUpdate = { [weak self] in self?.receiveSystem($0) }
        system.start()
    }

    private func receiveSystem(_ payload: [String: Any]?) {
        recentSystem = payload
        systemBundle = (payload?["parentApplicationBundleIdentifier"] as? String) ?? (payload?["bundleIdentifier"] as? String)
        if let spotify, spotify.status == .playing, systemBundle != spotify.bundleID {
            if state?.bundleID != spotify.bundleID {
                artwork = nil
                artworkKey = nil
                state = spotify
                prohibitsSkip = false
                onChange?()
                refreshDetails()
            }
            return
        }
        guard let data = payload, let title = data["title"] as? String, !title.isEmpty,
              let bundle = (data["parentApplicationBundleIdentifier"] ?? data["bundleIdentifier"]) as? String else {
            if systemActive {
                systemActive = false
                prohibitsSkip = false
                clear()
                refreshFromApps()
            }
            return
        }
        systemActive = true
        prohibitsSkip = data["prohibitsSkip"] as? Bool == true
        let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle)
        let source = MediaMonitor.players.first { $0.1 == bundle }?.0 ?? app?.deletingPathExtension().lastPathComponent ?? "Now Playing"
        let timestamp = (data["timestampEpochMicros"] as? Double).map { Date(timeIntervalSince1970: $0 / 1_000_000) } ?? Date()
        state = MediaState(source: source, bundleID: bundle, status: data["playing"] as? Bool == true ? .playing : .paused,
                           title: title, artist: data["artist"] as? String ?? "", album: data["album"] as? String ?? "",
                           duration: (data["durationMicros"] as? Double).map { $0 / 1_000_000 } ?? data["duration"] as? Double,
                           position: (data["elapsedTimeMicros"] as? Double).map { $0 / 1_000_000 } ?? data["elapsedTime"] as? Double,
                           positionAt: timestamp, artworkURL: nil)
        if bundle == "com.spotify.client" {
            spotify = state?.status == .playing ? state : nil
        }
        let encoded = data["artworkData"] as? String
        if encoded != artworkKey {
            artworkKey = encoded
            artwork = encoded.flatMap { Data(base64Encoded: $0) }.flatMap { NSImage(data: $0) }
        }
        onChange?()
    }

    private func isRunning(_ bundle: String) -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: bundle).isEmpty
    }

    private func clear() {
        state = nil
        artwork = nil
        artworkKey = nil
        onChange?()
    }

    private func handle(_ info: [AnyHashable: Any], source: String, bundle: String) {
        let isSpotify = bundle == "com.spotify.client"
        guard !systemActive || isSpotify else { return }
        let ps = (info["Player State"] as? String ?? "").lowercased()
        if ps == "stopped" || info["Name"] == nil {
            if isSpotify { spotify = nil }
            if isSpotify, systemBundle != bundle, let recentSystem { receiveSystem(recentSystem); return }
            if state?.bundleID == bundle { clear() }
            return
        }
        let status: MediaState.Status = ps == "playing" ? .playing : .paused
        // Spotify reports duration in ms and position in s; Music reports Total Time in ms.
        let durMs = (info["Duration"] as? Double) ?? (info["Total Time"] as? Double)
        let pos = info["Playback Position"] as? Double
        let s = MediaState(source: source, bundleID: bundle, status: status,
                           title: info["Name"] as? String ?? "", artist: info["Artist"] as? String ?? "",
                           album: info["Album"] as? String ?? "",
                           duration: durMs.map { $0 / 1000 }, position: pos, positionAt: Date(),
                           artworkURL: state?.title == (info["Name"] as? String) ? state?.artworkURL : nil)
        if isSpotify {
            spotify = status == .playing ? s : nil
            if systemBundle == bundle, state?.status == status { return }
            if status == .paused, systemBundle != bundle, let recentSystem { receiveSystem(recentSystem); return }
            prohibitsSkip = false
        }
        // A paused player shouldn't replace one that is playing.
        if let cur = state, cur.bundleID != bundle, cur.status == .playing, status == .paused { return }
        if state?.bundleID != bundle || state?.title != s.title || state?.artist != s.artist {
            artwork = nil
            artworkKey = nil
        }
        state = s
        onChange?()
        refreshDetails()
    }

    /// Exact position and artwork, read from the app (off the main thread).
    func refreshDetails() {
        guard let s = state, !automationDenied.contains(s.bundleID), isRunning(s.bundleID) else { return }
        let script: String
        if s.source == "Spotify" {
            script = """
            tell application "Spotify" to return (player position as text) & "|" & (artwork url of current track) & "|" & (player state as text)
            """
        } else {
            script = """
            tell application "Music" to return (player position as text) & "||" & (player state as text)
            """
        }
        queue.async { [weak self] in
            var err: NSDictionary?
            let out = NSAppleScript(source: script)?.executeAndReturnError(&err).stringValue
            DispatchQueue.main.async {
                guard let self, var cur = self.state, cur.bundleID == s.bundleID,
                      cur.title == s.title, cur.artist == s.artist, cur.status == s.status, let out else { return }
                let parts = out.components(separatedBy: "|")
                if let p = Double(parts[0].replacingOccurrences(of: ",", with: ".")) { cur.position = p; cur.positionAt = Date() }
                if parts.count > 1, !parts[1].isEmpty { cur.artworkURL = parts[1] }
                self.state = cur
                self.loadArtwork()
                self.onChange?()
            }
        }
        if s.source == "Music" { loadMusicArtwork() }
    }

    private func loadArtwork() {
        guard let s = state, let url = s.artworkURL, url != artworkKey, let u = URL(string: url) else { return }
        artworkKey = url
        URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
            guard let data, let img = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.artworkKey == url else { return }
                self.artwork = img
                self.onChange?()
            }
        }.resume()
    }

    private func loadMusicArtwork() {
        guard let s = state else { return }
        let key = "music:\(s.title)|\(s.album)"
        guard key != artworkKey else { return }
        artworkKey = key
        queue.async { [weak self] in
            var err: NSDictionary?
            let d = NSAppleScript(source: "tell application \"Music\" to get raw data of artwork 1 of current track")?
                .executeAndReturnError(&err).data
            let img = d.flatMap { NSImage(data: $0) }
            DispatchQueue.main.async {
                guard let self, self.artworkKey == key else { return }
                self.artwork = img
                self.onChange?()
            }
        }
    }

    /// On launch, ask running players what they're doing (no notification has arrived yet).
    func refreshFromApps() {
        system.start()
        for (name, bundle, _) in MediaMonitor.players where (!systemActive || (bundle == "com.spotify.client" && systemBundle != bundle)) && isRunning(bundle) && !automationDenied.contains(bundle) {
            let app = name == "Spotify" ? "Spotify" : "Music"
            let script = """
            tell application "\(app)"
              if player state is stopped then return {"stopped"}
              set t to current track
              return {player state as text, name of t as text, artist of t as text, album of t as text, duration of t as text, player position as text}
            end tell
            """
            queue.async { [weak self] in
                var err: NSDictionary?
                guard let result = NSAppleScript(source: script)?.executeAndReturnError(&err), err == nil else {
                    if err?[NSAppleScript.errorNumber] as? Int == -1743 {
                        DispatchQueue.main.async { [weak self] in self?.automationDenied.insert(bundle) }
                    }
                    return
                }
                if result.atIndex(1)?.stringValue == "stopped" {
                    DispatchQueue.main.async { [weak self] in self?.handle(["Player State": "stopped"], source: name, bundle: bundle) }
                    return
                }
                guard result.numberOfItems == 6 else { return }
                let p = (1...6).map { result.atIndex($0)?.stringValue ?? "" }
                var dur = Double(p[4].replacingOccurrences(of: ",", with: ".")) ?? 0
                if name == "Music" { dur *= 1000 }  // Music reports seconds here; normalise to ms like the notification
                let info: [String: Any] = ["Player State": p[0].capitalized, "Name": p[1], "Artist": p[2], "Album": p[3],
                                           "Duration": dur, "Playback Position": Double(p[5].replacingOccurrences(of: ",", with: ".")) ?? 0]
                DispatchQueue.main.async { self?.handle(info, source: name, bundle: bundle) }
            }
        }
    }

    func command(_ cmd: String) {
        if systemActive && state?.bundleID == systemBundle {
            if prohibitsSkip && cmd != "toggle" { return }
            if let code = ["toggle": "2", "next": "4", "previous": "5"][cmd] { system.send(["send", code]) }
            return
        }
        guard let s = state else { return }
        let app = s.source == "Spotify" ? "Spotify" : "Music"
        let verb: String
        switch cmd {
        case "toggle": verb = "playpause"
        case "next": verb = "next track"
        case "previous": verb = "previous track"
        default: return
        }
        queue.async {
            var err: NSDictionary?
            NSAppleScript(source: "tell application \"\(app)\" to \(verb)")?.executeAndReturnError(&err)
        }
    }

    func seek(_ seconds: Double, in track: MediaState) {
        guard seconds.isFinite, let duration = track.duration, duration > 0,
              var current = state, current.bundleID == track.bundleID, current.title == track.title,
              current.artist == track.artist, systemActive || isRunning(track.bundleID) else { return }
        let target = min(max(0, seconds), duration)
        if systemActive && track.bundleID == systemBundle {
            system.send(["seek", String(max(1, Int64(target * 1_000_000)))])
            current.position = target
            current.positionAt = Date()
            state = current
            onChange?()
            return
        }
        queue.async { [weak self] in
            let value = String(format: "%.3f", locale: Locale(identifier: "en_US_POSIX"), target)
            var error: NSDictionary?
            NSAppleScript(source: "tell application id \"\(track.bundleID)\" to set player position to \(value)")?.executeAndReturnError(&error)
            DispatchQueue.main.async {
                guard let self else { return }
                self.refreshFromApps()
            }
        }
        current.position = target
        current.positionAt = Date()
        state = current
        onChange?()
    }

    func openSource() {
        guard let s = state, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: s.bundleID) else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: .init())
    }

    /// Spotify owns its catalogue and authentication. Open its real search UI instead of
    /// pretending that an unauthenticated overlay can browse or play a catalogue.
    func openSpotifySearch(_ query: String = "") {
        let escaped = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if let url = URL(string: "spotify:search:" + escaped) { NSWorkspace.shared.open(url) }
    }
}

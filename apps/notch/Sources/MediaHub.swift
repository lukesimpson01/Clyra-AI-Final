import AppKit

// Everything that is playing on this Mac, in one place. Clyra's own Spotify connection is the first source (the same
// link the Notch inside Clyra reads, so the player behaves exactly as it does there); whatever else the system is
// playing (the Spotify app, Apple Music, a browser tab) is the second. When both are playing, the person picks.

struct MediaSource: Identifiable, Equatable {
    let id: String
    let name: String
    let symbol: String
    let state: MediaState
    let viaClyra: Bool
}

final class MediaHub {
    private let local = MediaMonitor()
    private weak var link: FlowBridge?
    /// The wave's meter, so Clyra's loudness readings can reach it.
    weak var meter: AudioMeter?
    private var listening = false
    private var listenTimer: Timer?
    private var spotifyState: MediaState?
    private var spotifyMisses = 0
    private var spotifyArtwork: NSImage?
    private var spotifyArtworkURL: String?
    private(set) var sources: [MediaSource] = []
    private(set) var pinnedID: String? = UserDefaults.standard.string(forKey: "notchMediaSource")
    var onChange: (() -> Void)?

    init(link: FlowBridge) {
        self.link = link
        local.onChange = { [weak self] in self?.recompute() }
        link.onSpotify = { [weak self] payload in self?.receiveSpotify(payload) }
        link.onMusicLevel = { [weak self] payload in
            if let rms = (payload["rms"] as? NSNumber)?.doubleValue {
                let bands = (payload["bands"] as? [NSNumber])?.map { $0.floatValue } ?? []
                self?.meter?.receiveExternal(rms: rms, bands: bands)
            }
        }
        recompute()
    }

    // MARK: Chosen source

    var active: MediaSource? {
        if let pinnedID, let pinned = sources.first(where: { $0.id == pinnedID }),
           pinned.state.status == .playing || !sources.contains(where: { $0.state.status == .playing }) { return pinned }
        return sources.first(where: { $0.state.status == .playing }) ?? sources.first
    }
    var state: MediaState? { active?.state }
    var artwork: NSImage? { active?.viaClyra == true ? spotifyArtwork : local.artwork }
    var prohibitsSkip: Bool { active?.viaClyra == true ? false : local.prohibitsSkip }
    var hasChoice: Bool { sources.count > 1 }

    func select(_ id: String) {
        pinnedID = id
        UserDefaults.standard.set(id, forKey: "notchMediaSource")
        onChange?()
    }

    // MARK: Clyra's Spotify

    private func receiveSpotify(_ o: [String: Any]) {
        guard o["connected"] as? Bool == true, let s = o["state"] as? [String: Any], let title = s["title"] as? String else {
            // One failed poll must not make the player vanish and reappear: keep the last state until three in a row fail.
            spotifyMisses += 1
            if spotifyMisses >= 3 || o["connected"] as? Bool == false && spotifyMisses >= 2 { spotifyState = nil; recompute() }
            return
        }
        spotifyMisses = 0
        let duration = (s["durationMs"] as? NSNumber).map { $0.doubleValue / 1000 }
        let position = (s["progressMs"] as? NSNumber).map { $0.doubleValue / 1000 }
        let art = s["artwork"] as? String
        spotifyState = MediaState(source: "Spotify", bundleID: "com.spotify.client", status: (s["playing"] as? Bool) == true ? .playing : .paused,
                                  title: title, artist: s["artist"] as? String ?? "", album: s["album"] as? String ?? "",
                                  duration: duration, position: position, positionAt: Date(), artworkURL: art)
        if art != spotifyArtworkURL {
            spotifyArtworkURL = art
            spotifyArtwork = nil
            if let art, let url = URL(string: art) {
                URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                    guard let data, let image = NSImage(data: data) else { return }
                    DispatchQueue.main.async { guard self?.spotifyArtworkURL == art else { return }; self?.spotifyArtwork = image; self?.onChange?() }
                }.resume()
            }
        }
        recompute()
    }

    private func recompute() {
        var list: [MediaSource] = []
        let l = local.state
        let duplicate = l.map { $0.bundleID == "com.spotify.client" && spotifyState?.title == $0.title } ?? false
        if var s = spotifyState {
            // The app reports a pause or play the instant it happens; Clyra's connection hears of it a poll later. Trust the fresher.
            if duplicate, let l, l.status != s.status { s.status = l.status; s.position = l.position; s.positionAt = l.positionAt }
            list.append(MediaSource(id: "clyra-spotify", name: "Spotify", symbol: "dot.radiowaves.left.and.right", state: s, viaClyra: true))
        }
        if let l {
            // the Spotify app playing what Clyra's connection already shows is one source, not two
            if !duplicate { list.append(MediaSource(id: "local-\(l.bundleID)", name: l.source, symbol: l.bundleID == "com.apple.Music" ? "music.note" : "play.rectangle", state: l, viaClyra: false)) }
        }
        sources = list
        updateListening()
        onChange?()
    }

    /// While something plays, ask Clyra to measure its loudness; keep asking now and then so a restarted Clyra picks it up.
    private func updateListening() {
        let playing = active?.state.status == .playing
        guard playing != listening else { return }
        listening = playing
        link?.sendMusic(playing)
        listenTimer?.invalidate()
        listenTimer = nil
        if playing {
            let t = Timer(timeInterval: 5, repeats: true) { [weak self] _ in if self?.listening == true { self?.link?.sendMusic(true) } }
            RunLoop.main.add(t, forMode: .common)
            listenTimer = t
        }
    }

    // MARK: Controls

    func refreshFromApps() { local.refreshFromApps() }

    func command(_ cmd: String) {
        guard let active, active.viaClyra, let link else { local.command(cmd); return }
        switch cmd {
        case "toggle":
            let playing = active.state.status == .playing
            link.sendSpotify(playing ? "pause" : "play")
            optimistic { $0.status = playing ? .paused : .playing; $0.position = $0.position(at: Date()); $0.positionAt = Date() }
        case "next": link.sendSpotify("next")
        case "previous": link.sendSpotify("previous")
        default: local.command(cmd)
        }
    }

    func seek(_ seconds: Double, in track: MediaState) {
        guard active?.viaClyra == true, let link else { local.seek(seconds, in: track); return }
        link.sendSpotify("seek", extra: ["positionMs": Int(max(0, seconds) * 1000)])
        optimistic { $0.position = seconds; $0.positionAt = Date() }
    }

    func openSource() {
        if active?.viaClyra == true, let url = URL(string: "spotify:") { NSWorkspace.shared.open(url) } else { local.openSource() }
    }

    private func optimistic(_ change: (inout MediaState) -> Void) {
        guard var s = spotifyState else { return }
        change(&s)
        spotifyState = s
        recompute()
    }
}

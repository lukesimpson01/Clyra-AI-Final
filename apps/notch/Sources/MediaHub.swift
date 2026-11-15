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
    private var spotifyState: MediaState?
    private var spotifyArtwork: NSImage?
    private var spotifyArtworkURL: String?
    private(set) var sources: [MediaSource] = []
    private(set) var pinnedID: String? = UserDefaults.standard.string(forKey: "notchMediaSource")
    var onChange: (() -> Void)?

    init(link: FlowBridge) {
        self.link = link
        local.onChange = { [weak self] in self?.recompute() }
        link.onSpotify = { [weak self] payload in self?.receiveSpotify(payload) }
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
            spotifyState = nil
            recompute()
            return
        }
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
        if let s = spotifyState { list.append(MediaSource(id: "clyra-spotify", name: "Spotify", symbol: "dot.radiowaves.left.and.right", state: s, viaClyra: true)) }
        if let l = local.state {
            // the Spotify app playing what Clyra's connection already shows is one source, not two
            let duplicate = l.bundleID == "com.spotify.client" && spotifyState?.title == l.title
            if !duplicate { list.append(MediaSource(id: "local-\(l.bundleID)", name: l.source, symbol: l.bundleID == "com.apple.Music" ? "music.note" : "play.rectangle", state: l, viaClyra: false)) }
        }
        sources = list
        onChange?()
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

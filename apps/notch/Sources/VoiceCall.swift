import AVFoundation
import SwiftUI

/// Voice call: Clyra (double-tap of the dictation key) hands each thing you say to this chat, and the answer is spoken back.
/// Listening uses the same Flow pill as dictation; the reply uses the same tool-call line as typed chat. When a reply finishes
/// the microphone opens again, until the key is double-tapped (or Stop is pressed) to end the call.
final class VoiceCall: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var active = false
    @Published private(set) var speaking = false
    @Published private(set) var muted = false
    /// What is being spoken, shortened for the collapsed notch.
    private(set) var snippet = "Speaking"
    var thinking: Bool { waiting }
    private(set) var startedAt: Date?
    /// A voice call running in the Clyra app itself: the notch mirrors it and can end or mute it.
    @Published private(set) var appActive = false
    @Published private(set) var appState = "Listening"
    @Published private(set) var appMuted = false
    @Published private(set) var appMedia = "none"   // none | camera | screen, as the app's call has it
    var live: Bool { active || appActive }

    func handleApp(_ o: [String: Any]) {
        let was = appActive
        appActive = o["active"] as? Bool ?? false
        appState = o["state"] as? String ?? "Voice call"
        appMuted = o["muted"] as? Bool ?? false
        let previousMedia = appMedia
        appMedia = o["media"] as? String ?? "none"
        if appActive && !was { startedAt = Date() }
        if appActive, appMedia == "screen", previousMedia != "screen" { model?.announce("Screen sharing", "Clyra can see your screen", symbol: "rectangle.on.rectangle") }
        // The app's camera and the notch's preview follow each other.
        if appActive, let model {
            if appMedia == "camera", !model.camera.wanted { model.camera.start() }
            if appMedia != "camera", previousMedia == "camera", model.camera.wanted { model.camera.stop() }
        }
        if was && !appActive, let model, model.camera.wanted { model.camera.stop() }
        if was && !appActive { DispatchQueue.main.async { [weak model] in if let model, model.view == .voice { model.show(.home) } } }
        objectWillChange.send()
    }

    /// What the collapsed notch says during a call: plain white text, no shimmer.
    var collapsedLabel: (symbol: String, text: String) {
        if appActive {
            if appMedia == "screen" { return ("rectangle.on.rectangle", "Screen sharing") }
            if appMedia == "camera" { return ("video.fill", "Camera on") }
            return ("phone.fill", appMuted ? "Muted" : "Voice call")
        }
        if speaking { return ("speaker.wave.2.fill", snippet) }
        if thinking { return ("ellipsis", "Thinking") }
        return ("phone.fill", muted ? "Muted" : "Voice call")
    }

    func toggleShare(_ kind: String) {
        model?.flow.sendOp(["op": "app-call", "action": kind])
    }

    func endAny() {
        if appActive { model?.flow.sendOp(["op": "app-call", "action": "end"]) } else { end() }
    }

    func muteAny() {
        if appActive { model?.flow.sendOp(["op": "app-call", "action": appMuted ? "unmute" : "mute"]) } else { toggleMute() }
    }
    private weak var model: NotchModel?
    private let synthesizer = AVSpeechSynthesizer()
    private var waiting = false
    private var poll: Timer?
    private var computerWasActive = false
    /// Music playing when the call began is paused for it (the microphone would hear it, and the call could never tell you had stopped talking) and resumed after.
    private var pausedMusic = false

    func attach(_ model: NotchModel) { self.model = model; synthesizer.delegate = self }

    func handle(_ o: [String: Any]) {
        switch o["event"] as? String ?? "" {
        case "start":
            model?.chat.voiceMode = true
            active = true
            muted = false
            startedAt = Date()
            if let model, model.hasPlayingMedia { model.media.command("toggle"); pausedMusic = true }
            waiting = false
            computerWasActive = false
        case "end":
            end(notifyClyra: false)
        case "tap":
            // One press while it is speaking: skip ahead and listen.
            if speaking { synthesizer.stopSpeaking(at: .immediate) } else if !waiting { listen() }
        case "transcript":
            guard active, let text = (o["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, let model else { return }
            if let say = model.submitVoice(text) { speak(say); return }
            waiting = true
            startPolling()
        default: break
        }
        objectWillChange.send()
    }

    func toggleMute() {
        muted.toggle()
        model?.flow.sendOp(["op": "voice-call", "action": muted ? "mute" : "unmute"])
    }

    func end(notifyClyra: Bool = true) {
        muted = false
        model?.chat.voiceMode = false
        active = false
        waiting = false
        poll?.invalidate(); poll = nil
        synthesizer.stopSpeaking(at: .immediate)
        speaking = false
        if notifyClyra { model?.flow.sendOp(["op": "voice-call", "action": "end"]) }
        // Hung up: back to the chat home screen.
        DispatchQueue.main.async { [weak model] in if let model, model.view == .voice || model.view == .chat || model.view == .media { model.show(.home) } }
        objectWillChange.send()
    }

    private func listen() {
        guard active, !muted else { return }
        model?.flow.sendOp(["op": "voice-call", "action": "listen"])
    }

    private func startPolling() {
        poll?.invalidate()
        poll = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in self?.check() }
    }

    /// Waits for the reply (or the computer-use task) to finish, then speaks it.
    private func check() {
        guard active, waiting, let model else { poll?.invalidate(); return }
        if model.computer.isActive { computerWasActive = true; return }
        if model.chat.isStreaming || model.chat.work != nil { return }
        poll?.invalidate(); poll = nil
        waiting = false
        var reply = ""
        if computerWasActive {
            reply = model.computer.summary.isEmpty ? "Done." : model.computer.summary
        } else {
            reply = model.chat.chat.messages.last(where: { !$0.isUser })?.text ?? ""
        }
        computerWasActive = false
        speak(VoiceCall.spoken(reply))
    }

    private func speak(_ text: String) {
        guard active else { return }
        guard !text.isEmpty else { listen(); return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        snippet = text.count > 44 ? String(text.prefix(42)) + "…" : text
        speaking = true
        synthesizer.speak(utterance)
        objectWillChange.send()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { finishedSpeaking() }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { finishedSpeaking() }
    private func finishedSpeaking() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.speaking = false
            self.objectWillChange.send()
            if self.active { self.listen() }
        }
    }

    /// Markdown and links read aloud badly: speak the words only, and keep it to a few sentences.
    static func spoken(_ markdown: String) -> String {
        var t = markdown
        t = t.replacingOccurrences(of: #"```[\s\S]*?```"#, with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: #"[*_`#>]+"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(t.prefix(900))
    }
}


/// What the notch opens to while dictating or on a voice call. A call follows Clyra's own call screen (status and timer at the
/// top, captions in the middle, Mute and End underneath), without the ball; the conversation is shown as text.
struct VoiceView: View {
    @ObservedObject var model: NotchModel
    @ObservedObject var flow: FlowBridge
    @ObservedObject var voice: VoiceCall

    init(model: NotchModel) { self.model = model; self.flow = model.flow; self.voice = model.voice }

    private var status: String {
        if voice.appActive { return voice.appMuted ? "Muted" : voice.appState }
        if voice.muted { return "Muted" }
        if voice.speaking { return "Speaking" }
        if model.chat.work != nil || model.chat.isStreaming || model.computer.isActive { return "Thinking" }
        return flow.phase == "listening" ? "Listening" : "Voice call"
    }

    private func duration(_ now: Date) -> String {
        let s = Int(now.timeIntervalSince(voice.startedAt ?? now))
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    var body: some View {
        if voice.live { call } else { dictation }
    }

    private var call: some View {
        let reply = model.chat.chat.messages.last(where: { !$0.isUser })
        let muted = voice.appActive ? voice.appMuted : voice.muted
        let sharing = voice.appMedia == "screen"
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(status == "Listening" ? ClyraTint.blueSoft : .white.opacity(0.5)).frame(width: 7, height: 7)
                    .shadow(color: ClyraTint.blue.opacity(status == "Listening" ? 0.8 : 0), radius: 4)
                ZStack { Text(status).id(status).font(.system(size: 13, weight: .semibold)).transition(.opacity.combined(with: .offset(y: 4))) }
                    .animation(model.reduceMotion ? nil : .easeOut(duration: 0.18), value: status)
                TimelineView(.periodic(from: .now, by: 1)) { frame in
                    Text(duration(frame.date)).font(.system(size: 12, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                }
                Spacer(minLength: 4)
                MicBars(flow: flow, live: flow.phase == "listening" && !muted)
            }
            .frame(height: 24)

            // Camera: the notch grows to show it, with a button to close it, as the app's call does.
            if model.camera.wanted {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.06))
                    if model.camera.running {
                        CameraPreview(session: model.camera.session).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous)).transition(.opacity)
                    } else {
                        Text(model.camera.denied ? "Camera access is off for Clyra’s Notch" : "Starting camera…").font(.system(size: 12)).foregroundStyle(.white.opacity(0.55)).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    Button { model.camera.stop(); if voice.appMedia == "camera" { voice.toggleShare("camera") } } label: {
                        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 24, height: 24).background(Circle().fill(Color.black.opacity(0.55)))
                    }.buttonStyle(PillPress()).padding(8).accessibilityLabel("Close camera")
                }
                .frame(height: 126)
                .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))
            } else {
                // Captions: what is being heard, then what Clyra answers, in text.
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 6) {
                            if flow.phase == "listening", !flow.text.isEmpty {
                                Text(flow.text).font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                            }
                            if let reply, !reply.text.isEmpty, !(flow.phase == "listening" && !flow.text.isEmpty) {
                                Text(VoiceCall.spoken(reply.text)).font(.system(size: 14.5, weight: .medium)).foregroundStyle(.white.opacity(0.95)).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                            }
                            if voice.appActive {
                                Text(sharing ? "Clyra can see your screen" : "On a call in Clyra").font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
                            } else if flow.text.isEmpty, (reply?.text.isEmpty ?? true) {
                                Text("Say something…").font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
                            }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .frame(maxWidth: .infinity).padding(.horizontal, 6)
                    }
                    .scrollIndicators(.never)
                    .onChange(of: reply?.text) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
                }
            }

            HStack(spacing: 12) {
                control(symbol: muted ? "mic.slash.fill" : "mic.fill", tip: muted ? "Unmute" : "Mute", on: muted, tint: Color(red: 0.95, green: 0.7, blue: 0.2)) { voice.muteAny() }
                control(symbol: "rectangle.on.rectangle", tip: sharing ? "Stop sharing screen" : "Share screen", on: sharing, tint: ClyraTint.blue) { voice.toggleShare("screen") }
                control(symbol: model.camera.wanted ? "video.fill" : "video", tip: model.camera.wanted ? "Turn camera off" : "Turn camera on", on: model.camera.wanted, tint: ClyraTint.blue) {
                    model.camera.toggle()
                    if voice.appActive { voice.toggleShare("camera") }
                }
                control(symbol: "phone.down.fill", tip: "End call", on: true, tint: Color(red: 0.9, green: 0.25, blue: 0.27)) { voice.endAny() }
            }
        }
        .animation(model.reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.86), value: model.camera.wanted)
    }

    private func control(symbol: String, tip: String, on: Bool, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 38, height: 38).background(Circle().fill(on ? tint : Color.white.opacity(0.14)))
        }.buttonStyle(PillPress()).accessibilityLabel(tip).help(tip)
    }

    private var dictation: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                MicBars(flow: flow, live: flow.phase == "listening")
                Text("Dictation").font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 6)
                IconButton(symbol: "xmark", size: 11, label: "Cancel") { flow.send(action: "cancel") }
            }.frame(height: 28)
            Text(flow.text.isEmpty ? (flow.detail.isEmpty ? "Listening…" : flow.detail) : flow.text)
                .font(.system(size: 15)).foregroundStyle(.white.opacity(flow.text.isEmpty ? 0.5 : 0.95))
                .frame(maxWidth: .infinity, alignment: .topLeading)
            Spacer(minLength: 0)
            Button { flow.send(action: "stop") } label: {
                Text("Done").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).frame(height: 30).background(Capsule().fill(ClyraTint.blue))
            }.buttonStyle(PillPress())
        }
    }
}

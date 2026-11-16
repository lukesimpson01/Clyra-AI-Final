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
            waiting = true
            model.submitVoice(text)
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
        if voice.active { call } else { dictation }
    }

    private var call: some View {
        let reply = model.chat.chat.messages.last(where: { !$0.isUser })
        return VStack(spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(status == "Listening" ? ClyraTint.blueSoft : .white.opacity(0.5)).frame(width: 7, height: 7)
                    .shadow(color: ClyraTint.blue.opacity(status == "Listening" ? 0.8 : 0), radius: 4)
                ZStack { Text(status).id(status).font(.system(size: 13, weight: .semibold)).transition(.opacity.combined(with: .offset(y: 4))) }
                    .animation(model.reduceMotion ? nil : .easeOut(duration: 0.18), value: status)
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { frame in
                    Text(duration(frame.date)).font(.system(size: 12.5, weight: .medium).monospacedDigit()).foregroundStyle(.white.opacity(0.55))
                }
            }
            .frame(height: 24)

            // Captions: what is being heard, then what Clyra answers, in text.
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 10) {
                        if flow.phase == "listening", !flow.text.isEmpty {
                            Text(flow.text).font(.system(size: 15, weight: .medium)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                        }
                        if let reply, !reply.text.isEmpty, !(flow.phase == "listening" && !flow.text.isEmpty) {
                            Text(VoiceCall.spoken(reply.text)).font(.system(size: 16, weight: .medium)).foregroundStyle(.white.opacity(0.95)).multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                        }
                        if flow.text.isEmpty, (reply?.text.isEmpty ?? true) {
                            Text("Say something…").font(.system(size: 14)).foregroundStyle(.white.opacity(0.4))
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 6)
                }
                .scrollIndicators(.never)
                .onChange(of: reply?.text) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
            }

            MicBars(flow: flow, live: flow.phase == "listening" && !voice.muted).frame(height: 22)

            HStack(spacing: 26) {
                control(symbol: voice.muted ? "mic.slash.fill" : "mic.fill", label: voice.muted ? "Unmute" : "Mute", tint: voice.muted ? Color(red: 0.95, green: 0.7, blue: 0.2) : .white.opacity(0.14)) { voice.toggleMute() }
                control(symbol: "phone.down.fill", label: "End", tint: Color(red: 0.9, green: 0.25, blue: 0.27)) { voice.end() }
            }
        }
    }

    private func control(symbol: String, label: String, tint: Color, action: @escaping () -> Void) -> some View {
        VStack(spacing: 4) {
            Button(action: action) {
                Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 42, height: 42).background(Circle().fill(tint))
            }.buttonStyle(PillPress()).accessibilityLabel(label)
            Text(label).font(.system(size: 10.5, weight: .medium)).foregroundStyle(.white.opacity(0.55))
        }
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

import SwiftUI

/// Clyra's computer-use run, mirrored from Clyra over the local bridge. Clyra owns the run (the glow, the control bar, the
/// real mouse and keyboard); the Notch shows what it is doing and can start, pause, resume and stop it.
final class ComputerSession: ObservableObject {
    @Published private(set) var status = "idle"   // idle | running | paused | needs_user | done | failed | cancelled
    @Published private(set) var goal = ""
    @Published private(set) var message = ""
    @Published private(set) var summary = ""
    @Published private(set) var steps: [StepItem] = []
    @Published private(set) var plan: [(title: String, status: String)] = []
    var onChange: (() -> Void)?
    var sender: (([String: Any]) -> Void)?

    /// In use from the moment it starts until it has finished, was stopped, or failed.
    var isActive: Bool { ["planning", "running", "paused", "needs_user"].contains(status) }

    func apply(_ o: [String: Any]) {
        let next = o["status"] as? String ?? "idle"
        let was = (isActive, status)
        status = next
        goal = o["goal"] as? String ?? goal
        message = o["message"] as? String ?? ""
        summary = (o["summary"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (o["error"] as? String ?? "")
        plan = (o["plan"] as? [[String: Any]] ?? []).map { ($0["title"] as? String ?? "", $0["status"] as? String ?? "pending") }
        steps = (o["steps"] as? [[String: Any]] ?? []).filter { ($0["kind"] as? String) != "message" }.map { s in
            let kind = s["kind"] as? String ?? "action"
            let app = s["app"] as? String ?? ""
            return StepItem(id: s["id"] as? String ?? UUID().uuidString, tool: "computer_" + kind, label: s["label"] as? String ?? "Working",
                            state: s["status"] as? String ?? "done", detail: app.isEmpty ? nil : app, error: (s["detail"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                            sources: [], images: [], repos: [], documentID: nil)
        }
        if was.0 != isActive || was.1 != status { onChange?() } else { objectWillChange.send() }
    }

    func start(_ goal: String) { sender?(["op": "computer", "action": "start", "goal": goal]) }
    func pause() { sender?(["op": "computer", "action": "pause"]) }
    func resume() { sender?(["op": "computer", "action": "resume"]) }
    func humanDone() { sender?(["op": "computer", "action": "human-done"]) }
    func stop() { sender?(["op": "computer", "action": "stop"]) }
    func message(_ text: String) { sender?(["op": "computer", "action": "message", "text": text]) }

    /// What the collapsed notch says.
    var collapsedLabel: (symbol: String, label: String) {
        switch status {
        case "planning": return ("computermouse.fill", "Planning")
        case "paused": return ("pause.fill", "Computer paused")
        case "needs_user": return ("hand.raised.fill", "Your turn")
        default: return ("computermouse.fill", "Computer in use")
        }
    }
}

/// The hover panel while Clyra is driving the computer: the same tool-call rows as chat, newest last, with the controls.
struct ComputerView: View {
    @ObservedObject var model: NotchModel
    @ObservedObject var computer: ComputerSession
    @State private var draft = ""

    init(model: NotchModel) { self.model = model; self.computer = model.computer }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "computermouse.fill").font(.system(size: 13)).foregroundStyle(ClyraTint.blueSoft)
                VStack(alignment: .leading, spacing: 1) {
                    Text(headline).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    if !computer.goal.isEmpty { Text(computer.goal).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.45)).lineLimit(1) }
                }
                Spacer(minLength: 8)
                if computer.status == "needs_user" {
                    Button("Resume") { computer.humanDone() }.buttonStyle(.plain)
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).frame(height: 26).background(Capsule().fill(ClyraTint.blue))
                } else {
                    iconButton(computer.status == "paused" ? "play.fill" : "pause.fill", label: computer.status == "paused" ? "Resume" : "Pause") {
                        computer.status == "paused" ? computer.resume() : computer.pause()
                    }
                }
                iconButton("stop.fill", label: "Stop", tint: Color(red: 1, green: 0.35, blue: 0.35)) { computer.stop() }
            }
            if computer.status == "needs_user", !computer.message.isEmpty {
                Text(computer.message).font(.system(size: 12.5)).foregroundStyle(.white.opacity(0.75)).fixedSize(horizontal: false, vertical: true)
            }
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(computer.steps) { step in StepLine(step: step, reduceMotion: model.reduceMotion).id(step.id) }
                        if computer.steps.isEmpty { ShimmerText(text: "Looking at the screen", reduceMotion: model.reduceMotion, size: 12.5) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: computer.steps.last?.id) { id in if let id { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .bottom) } } }
            }
            HStack(spacing: 8) {
                TextField("Message Clyra…", text: $draft).textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(.white)
                    .onSubmit(send)
                if !draft.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(action: send) { Image(systemName: "arrow.up").font(.system(size: 11, weight: .bold)).foregroundStyle(.white).frame(width: 24, height: 24).background(Circle().fill(ClyraTint.blue)) }
                        .buttonStyle(.plain).accessibilityLabel("Send message").help("Send to Clyra")
                }
            }
            .padding(.horizontal, 12).frame(height: 36)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.22), lineWidth: 1))
        }
        .padding(.horizontal, 8)
    }

    private var headline: String {
        switch computer.status {
        case "paused": return "Paused"
        case "needs_user": return "Waiting for you"
        default: return "Computer in use"
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        computer.message(text)
        draft = ""
    }

    private func iconButton(_ symbol: String, label: String, tint: Color = .white, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(tint).frame(width: 26, height: 26)
                .background(Circle().fill(.white.opacity(0.1)))
        }.buttonStyle(.plain).accessibilityLabel(label).help(label)
    }
}

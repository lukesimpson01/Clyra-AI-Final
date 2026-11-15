import Foundation

// The Notch chat is a second window onto Clyra's own chat: the same conversations (shared store at /api/chat-sync),
// the same agent (POST /api/chat/agent, Server-Sent Events), and messages kept in Clyra's own shape (agent run,
// steps, to-dos) so either side can paint a chat the other one wrote. Nothing here generates replies itself.

typealias JSON = [String: Any]

struct TodoItem: Identifiable, Equatable {
    let id: String
    let content: String
    let status: String  // pending | in_progress | completed
}

struct SourceRef: Identifiable, Equatable {
    let url: String
    let host: String
    let title: String?
    var id: String { url }
}

struct ResearchImage: Identifiable, Equatable {
    let thumbnailURL: String
    let sourceURL: String
    let title: String
    var id: String { sourceURL }
}

struct RepoCard: Identifiable, Equatable {
    let fullName: String
    let url: String
    let about: String?
    let stars: Int
    let language: String?
    let licence: String?
    let avatar: String?
    var id: String { fullName }
}

struct StepItem: Identifiable, Equatable {
    let id: String
    let tool: String
    let label: String
    let state: String  // running | done | failed
    let detail: String?
    let error: String?
    let sources: [SourceRef]
    let images: [ResearchImage]
    let repos: [RepoCard]
    let documentID: String?
}

enum ToolStyle {
    /// Opening, finding in and following links inside a page are the search's own legwork; the search row says it all.
    static let quiet: Set<String> = ["web_open", "web_find", "web_follow_links"]

    static func symbol(_ tool: String) -> String {
        switch tool {
        case "web_open", "notes_read": return "doc.text"
        case "web_find", "notes_search": return "magnifyingglass"
        case "web_follow_links", "notes_link_page": return "link"
        case "image_search": return "photo.on.rectangle"
        case "github_repo_search", "github_repo_inspect": return "chevron.left.forwardslash.chevron.right"
        case "show_map": return "mappin.and.ellipse"
        case "create_note": return "doc.badge.plus"
        case "notes_insert", "notes_edit": return "pencil.line"
        default: return "globe"
        }
    }

    static func label(_ step: StepItem) -> String {
        step.tool == "web_search" ? (step.state == "running" ? "Searching" : "Searched") : step.label
    }
}

/// A Clyra message kept as raw JSON so every field Clyra added survives a round trip through the Notch.
struct ChatMessage: Identifiable {
    var raw: JSON
    var id: String { raw["id"] as? String ?? "" }
    var isUser: Bool { raw["role"] as? String == "user" }
    var text: String {
        get { raw["content"] as? String ?? "" }
        set { raw["content"] = newValue }
    }
    var streaming: Bool { raw["isStreaming"] as? Bool ?? false }
    var stopped: Bool { raw["stopped"] as? Bool ?? false }
    var failed: Bool { raw["failure"] != nil }
    private var run: JSON { raw["agentRun"] as? JSON ?? [:] }
    var todos: [TodoItem] {
        (run["todos"] as? [JSON] ?? []).compactMap { item in
            guard let content = item["content"] as? String else { return nil }
            return TodoItem(id: item["id"] as? String ?? content, content: content, status: item["status"] as? String ?? "pending")
        }
    }
    /// Every step the agent took, including the quiet ones (their images and repositories still feed the result cards).
    var allSteps: [StepItem] {
        (run["steps"] as? [JSON] ?? []).compactMap { step in
            guard let label = step["label"] as? String else { return nil }
            let sources = (step["sources"] as? [JSON] ?? []).compactMap { row -> SourceRef? in
                guard let url = row["url"] as? String else { return nil }
                return SourceRef(url: url, host: row["host"] as? String ?? URL(string: url)?.host ?? url, title: row["title"] as? String)
            }
            let images = (step["images"] as? [JSON] ?? []).compactMap { row -> ResearchImage? in
                guard let thumb = row["thumbnailUrl"] as? String, let source = row["sourceUrl"] as? String else { return nil }
                return ResearchImage(thumbnailURL: thumb, sourceURL: source, title: row["title"] as? String ?? "")
            }
            let repos = (step["repositories"] as? [JSON] ?? []).compactMap { row -> RepoCard? in
                guard let name = row["fullName"] as? String, let url = row["url"] as? String else { return nil }
                return RepoCard(fullName: name, url: url, about: row["description"] as? String, stars: (row["stars"] as? NSNumber)?.intValue ?? 0,
                                language: row["language"] as? String, licence: row["licence"] as? String, avatar: row["ownerAvatar"] as? String)
            }
            return StepItem(id: step["id"] as? String ?? label, tool: step["tool"] as? String ?? "", label: label,
                            state: step["state"] as? String ?? "running", detail: step["detail"] as? String, error: step["error"] as? String,
                            sources: sources, images: images, repos: repos, documentID: (step["document"] as? JSON)?["id"] as? String)
        }
    }
    var steps: [StepItem] { allSteps.filter { !ToolStyle.quiet.contains($0.tool) } }
    var citations: [SourceRef] {
        (raw["searchCitations"] as? [JSON] ?? []).compactMap { row in
            guard let url = row["url"] as? String else { return nil }
            return SourceRef(url: url, host: row["host"] as? String ?? URL(string: url)?.host ?? url, title: row["title"] as? String)
        }
    }

    /// What the agent is doing right now, for the collapsed notch: the running tool, else "Thinking".
    var work: (symbol: String, label: String, sources: [SourceRef])? {
        guard !isUser, streaming else { return nil }
        if let step = steps.last(where: { $0.state == "running" }) {
            return (ToolStyle.symbol(step.tool), ToolStyle.label(step), step.sources)
        }
        if let search = steps.last(where: { $0.tool == "web_search" }), text.isEmpty { return (ToolStyle.symbol(search.tool), "Searching", search.sources) }
        return ("sparkle", "Thinking", [])
    }

    static func make(role: String, text: String, streaming: Bool = false) -> ChatMessage {
        var raw: JSON = ["id": UUID().uuidString.lowercased(), "role": role, "content": text, "createdAt": Date().timeIntervalSince1970 * 1000]
        if streaming { raw["isStreaming"] = true; raw["isThinking"] = true; raw["agentRun"] = ["todos": [JSON](), "steps": [JSON]()] }
        return ChatMessage(raw: raw)
    }
}

struct SyncedChat {
    var id: String
    var title: String
    var updatedAt: Double  // milliseconds, as in Clyra
    var meta: JSON
    var messages: [ChatMessage]

    static func new() -> SyncedChat {
        SyncedChat(id: "chat-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6).lowercased())", title: "New Chat",
                   updatedAt: 0, meta: ["kind": "chat"], messages: [])
    }

    init(id: String, title: String, updatedAt: Double, meta: JSON, messages: [ChatMessage]) {
        self.id = id; self.title = title; self.updatedAt = updatedAt; self.meta = meta; self.messages = messages
    }

    init?(json: JSON) {
        guard let id = json["id"] as? String, let messages = json["messages"] as? [JSON] else { return nil }
        var meta = json
        for key in ["id", "title", "updatedAt", "messages"] { meta[key] = nil }
        self.init(id: id, title: json["title"] as? String ?? "Chat", updatedAt: (json["updatedAt"] as? NSNumber)?.doubleValue ?? 0,
                  meta: meta, messages: messages.map { ChatMessage(raw: $0) })
    }

    func json() -> JSON {
        var out = meta
        out["id"] = id
        out["title"] = title
        out["updatedAt"] = updatedAt
        out["messages"] = messages.map(\.raw)
        return out
    }

    /// The to-do list of the most recent reply, shown vertically beside the conversation.
    var todos: [TodoItem] { messages.last(where: { !$0.isUser })?.todos ?? [] }
}

struct ChatSummary: Identifiable, Equatable {
    let id: String
    let title: String
    let updated: Date
    var pinned = false
}

struct Usage: Equatable {
    let used: Int
    let limit: Int
}

/// Splits an SSE byte stream into `data:` payloads.
struct SSEParser {
    private var buffer = ""
    mutating func feed(_ chunk: String) -> [String] {
        buffer += chunk.replacingOccurrences(of: "\r\n", with: "\n")
        var out: [String] = []
        while let r = buffer.range(of: "\n\n") {
            let block = String(buffer[..<r.lowerBound])
            buffer.removeSubrange(..<r.upperBound)
            let data = block.split(separator: "\n", omittingEmptySubsequences: false)
                .filter { $0.hasPrefix("data:") }
                .map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces) }
                .joined(separator: "\n")
            if !data.isEmpty { out.append(data) }
        }
        return out
    }
}

enum AgentUpdate: Equatable {
    case text(String)
    case step(String, String)  // id, label with state
    case status(String)
    case done(String)
    case error(String)
}

func decodeAgentEvent(_ json: String) -> AgentUpdate? {
    guard let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let type = o["type"] as? String else { return nil }
    switch type {
    case "text": return (o["text"] as? String).map { .text($0) }
    case "step":
        let label = o["label"] as? String ?? (o["tool"] as? String ?? "Working")
        let state = o["state"] as? String ?? "running"
        let mark = state == "done" ? "✓ " : state == "failed" ? "✕ " : "… "
        return .step(o["id"] as? String ?? label, mark + label)
    case "phase": return (o["label"] as? String).map { .status($0) }
    case "done": return .done(o["text"] as? String ?? "")
    case "error": return .error(o["message"] as? String ?? "The agent could not finish.")
    default: return nil
    }
}

final class ChatClient: NSObject, URLSessionDataDelegate {
    /// Clyra's local server requires its per-launch token on writes; Clyra passes it in CLYRA_SERVICE_TOKEN.
    static func authorize(_ req: inout URLRequest) {
        if let token = ProcessInfo.processInfo.environment["CLYRA_SERVICE_TOKEN"], !token.isEmpty {
            req.setValue("clyra_token=\(token)", forHTTPHeaderField: "Cookie")
        }
    }

    /// Asked of the agent on every Notch request: a last line the notch reads aloud when it is closed.
    static let notifyInstruction = "After your complete answer, leave a blank line and finish with exactly one last line: a short notification, at most eight words, past tense, specific to what you just did (for example: Compared the three phones), written as **NOTE: your notification** with the double asterisks. Never mention or explain this line."

    /// Splits the closing notification off a reply: (what to show in the chat, the notification if it has arrived).
    static func splitNote(_ text: String) -> (text: String, note: String?) {
        if let regex = try? NSRegularExpression(pattern: #"\*\*\s*NOTE:\s*(.+?)\s*\*\*\s*$"#, options: [.dotMatchesLineSeparators]),
           let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let whole = Range(match.range, in: text), let group = Range(match.range(at: 1), in: text) {
            return (String(text[..<whole.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines), String(text[group]))
        }
        // still arriving: hide the half-written marker so it never flashes in the chat
        if let regex = try? NSRegularExpression(pattern: #"\*{1,2}\s*(N(O(T(E(:[^\n]*)?)?)?)?)?$"#),
           let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let whole = Range(match.range, in: text), match.range.length > 0 {
            let before = text[..<whole.lowerBound]
            if before.hasSuffix("\n") || before.isEmpty { return (String(before).trimmingCharacters(in: .whitespacesAndNewlines), nil) }
        }
        return (text, nil)
    }

    /// The closing message for the collapsed notch once a reply has finished.
    private(set) var finished: (message: String, at: Date)?
    var doneMessage: String? {
        guard let finished, Date().timeIntervalSince(finished.at) < 6, work == nil else { return nil }
        return finished.message
    }
    var onDone: ((String) -> Void)?

    private func announceDone(_ note: String?) {
        let message = (note?.isEmpty == false ? note! : "Reply ready")
        finished = (message, Date())
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.2) { [weak self] in self?.onChange?() }
        onDone?(message)
    }

    static var baseURL: URL {
        // Clyra launches Notch with CLYRA_URL pointing at its own server; that server talks to DeepSeek.
        let configured = ProcessInfo.processInfo.environment["CLYRA_URL"] ?? UserDefaults.standard.string(forKey: "clyraURL") ?? ""
        if let url = URL(string: configured), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil { return url }
        return URL(string: "http://127.0.0.1:3000")!
    }

    private(set) var chat = SyncedChat.new()
    private(set) var allChats: [ChatSummary] = []
    private(set) var usage: Usage?
    var recent: [ChatSummary] { Array(allChats.prefix(8)) }
    private var planUntil = Date.distantPast
    private(set) var isStreaming = false
    private(set) var status: String?
    private(set) var profileName = ""
    /// A reply Clyra itself is writing right now (in any chat), so the collapsed notch can show it working.
    private var external: SyncedChat?
    private var externalAt = Date.distantPast
    var onChange: (() -> Void)?

    /// Same three levels as Clyra's composer; Extended is Clyra's default.
    static let efforts: [(key: String, title: String, model: String)] = [
        ("light", "Light", "deepseek-v4-flash"), ("medium", "Standard", "deepseek-v4-pro"), ("high", "Extended", "deepseek-v4-pro"),
    ]
    var effort: String {
        get { UserDefaults.standard.string(forKey: "notchEffort") ?? "high" }
        set { UserDefaults.standard.set(newValue, forKey: "notchEffort"); onChange?() }
    }
    var effortTitle: String { ChatClient.efforts.first { $0.key == effort }?.title ?? "Extended" }

    /// The reply being written now, wherever it is being written.
    var work: (symbol: String, label: String, sources: [SourceRef])? {
        if isStreaming, let w = chat.messages.last?.work { return w }
        if let external, Date().timeIntervalSince(externalAt) < 30, let w = external.messages.last?.work { return w }
        return nil
    }

    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var syncTask: URLSessionDataTask?
    private var parser = SSEParser()
    private var syncParser = SSEParser()
    private var httpError: Int?
    private var streamBytes = Data()
    private var roundText = ""
    private var pushWork: DispatchWorkItem?
    private var recentWork: DispatchWorkItem?

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
        refreshRecent()
        startSync()
        loadProfile()
        refreshUsage()
    }

    /// "114 of 500 requests", the same figure Clyra's sidebar shows.
    func refreshUsage() {
        URLSession.shared.dataTask(with: request("api/usage/quota")) { [weak self] data, _, _ in
            guard let data, let o = try? JSONSerialization.jsonObject(with: data) as? JSON, let q = o["quota"] as? JSON,
                  let r = q["requests"] as? JSON, let used = (r["used"] as? NSNumber)?.intValue, let limit = (r["limit"] as? NSNumber)?.intValue else { return }
            DispatchQueue.main.async { self?.usage = Usage(used: used, limit: limit); self?.onChange?() }
        }.resume()
    }

    /// The plan shows only while it is needed: as the reply is worked out, then it folds away.
    var planTodos: [TodoItem] {
        guard let m = chat.messages.last(where: { !$0.isUser }), !m.todos.isEmpty else { return [] }
        return (m.streaming || Date() < planUntil) ? m.todos : []
    }

    private func loadProfile() {
        URLSession.shared.dataTask(with: request("api/chat-sync-profile")) { [weak self] data, _, _ in
            guard let data, let o = try? JSONSerialization.jsonObject(with: data) as? JSON, let name = o["name"] as? String, !name.isEmpty else { return }
            DispatchQueue.main.async { self?.profileName = name; self?.onChange?() }
        }.resume()
    }

    // MARK: Shared store

    private func request(_ path: String, method: String = "GET", body: JSON? = nil, query: [URLQueryItem] = []) -> URLRequest {
        var comps = URLComponents(url: ChatClient.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        if method != "GET" { ChatClient.authorize(&req) }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    func refreshRecent() {
        recentWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            URLSession.shared.dataTask(with: self.request("api/chat-sync", query: [URLQueryItem(name: "summary", value: "1")])) { [weak self] data, _, _ in
                guard let data, let body = try? JSONSerialization.jsonObject(with: data) as? JSON, let rows = body["chats"] as? [JSON] else { return }
                let list = rows.prefix(80).compactMap { row -> ChatSummary? in
                    guard let id = row["id"] as? String else { return nil }
                    let ms = (row["updatedAt"] as? NSNumber)?.doubleValue ?? 0
                    return ChatSummary(id: id, title: (row["title"] as? String) ?? "Chat", updated: Date(timeIntervalSince1970: ms / 1000),
                                       pinned: row["pinned"] as? Bool ?? false)
                }
                DispatchQueue.main.async {
                    guard let self, self.allChats != list else { return }
                    self.allChats = list
                    self.onChange?()
                }
            }.resume()
        }
        recentWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func fetch(_ id: String, completion: @escaping (SyncedChat) -> Void) {
        URLSession.shared.dataTask(with: request("api/chat-sync/\(id)")) { data, _, _ in
            guard let data, let body = try? JSONSerialization.jsonObject(with: data) as? JSON, let json = body["chat"] as? JSON,
                  let chat = SyncedChat(json: json) else { return }
            DispatchQueue.main.async { completion(chat) }
        }.resume()
    }

    /// Live link to the shared store: when Clyra changes the chat open here, repaint it as it is written.
    private func startSync() {
        syncTask?.cancel()
        syncParser = SSEParser()
        var req = request("api/chat-sync/events")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 24 * 3600
        let t = session.dataTask(with: req)
        syncTask = t
        t.resume()
    }

    private func handleSyncEvent(_ payload: String) {
        guard let data = payload.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? JSON,
              let id = o["id"] as? String else { return }
        refreshRecent()
        guard (o["source"] as? String) != "notch" else { return }
        if o["deleted"] as? Bool == true {
            if id == chat.id { chat = SyncedChat.new() }
            if external?.id == id { external = nil }
            onChange?()
            return
        }
        fetch(id) { [weak self] remote in
            guard let self else { return }
            if remote.messages.last?.streaming == true {
                self.external = remote
                self.externalAt = Date()
                // The notch can go back to quiet once Clyra stops writing, even if that last event never arrives.
                DispatchQueue.main.asyncAfter(deadline: .now() + 31) { [weak self] in self?.onChange?() }
            } else if self.external?.id == remote.id {
                self.external = nil
                if !self.isStreaming { self.announceDone(remote.messages.last?.raw["notchNote"] as? String) }
            }
            if remote.id == self.chat.id, !self.isStreaming, remote.updatedAt > self.chat.updatedAt { self.chat = remote }
            self.onChange?()
        }
    }

    private func pushSoon() {
        pushWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.pushNow() }
        pushWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    private func pushNow() {
        pushWork?.cancel()
        chat.updatedAt = max(Date().timeIntervalSince1970 * 1000, chat.updatedAt + 1)
        let req = request("api/chat-sync/\(chat.id)", method: "PUT", body: ["chat": chat.json()], query: [URLQueryItem(name: "source", value: "notch")])
        URLSession.shared.dataTask(with: req).resume()
    }

    // MARK: Conversations

    func newConversation() {
        stop()
        chat = SyncedChat.new()
        onChange?()
    }

    func open(_ summary: ChatSummary) {
        stop()
        fetch(summary.id) { [weak self] remote in
            self?.chat = remote
            self?.onChange?()
        }
    }

    /// Brings the reply Clyra is writing into the notch's own chat.
    func adoptWorking() {
        guard !isStreaming, let external, Date().timeIntervalSince(externalAt) < 30 else { return }
        chat = external
    }

    /// Asks the same question again, replacing the last answer.
    func regenerate() {
        guard !isStreaming, let lastUser = chat.messages.lastIndex(where: { $0.isUser }) else { return }
        let text = chat.messages[lastUser].text
        chat.messages.removeSubrange(lastUser...)
        send(text)
    }

    /// Adds a local exchange (e.g. a timer the notch set itself) without calling the agent.
    func appendLocal(user: String, reply: String) {
        detachFromClyraRun()
        chat.messages.append(.make(role: "user", text: user))
        chat.messages.append(.make(role: "assistant", text: reply))
        if chat.title == "New Chat" { chat.title = String(user.prefix(40)) }
        pushNow()
        onChange?()
    }

    private func patchLast(_ f: (inout ChatMessage) -> Void) {
        guard let i = chat.messages.indices.last, !chat.messages[i].isUser else { return }
        f(&chat.messages[i])
    }

    /// Clyra is still writing the chat that is open here: never add to it from the notch, start a fresh conversation instead.
    private func detachFromClyraRun() {
        if let external, external.id == chat.id, Date().timeIntervalSince(externalAt) < 45 { chat = SyncedChat.new() }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isStreaming else { return }
        detachFromClyraRun()
        chat.messages.append(.make(role: "user", text: trimmed))
        if chat.title == "New Chat" { chat.title = String(trimmed.prefix(40)) }
        chat.messages.append(.make(role: "assistant", text: "", streaming: true))
        let history = chat.messages.dropLast().filter { !$0.failed && !$0.stopped && !$0.text.isEmpty }
            .map { ["role": $0.isUser ? "user" : "assistant", "content": String($0.text.prefix(6000))] }
        var req = request("api/chat/agent", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 600
        let model = ChatClient.efforts.first { $0.key == effort }?.model ?? "deepseek-v4-pro"
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["messages": Array(history.suffix(24)), "model": model, "effort": effort, "instructions": ChatClient.notifyInstruction])
        parser = SSEParser()
        streamBytes.removeAll()
        roundText = ""
        httpError = nil
        isStreaming = true
        status = "Thinking…"
        pushNow()
        onChange?()
        task = session.dataTask(with: req)
        task?.resume()
    }

    func stop() {
        task?.cancel()
        task = nil
        if isStreaming { finish(error: nil, cancelled: true) }
    }

    private func finish(error: String?, cancelled: Bool = false) {
        isStreaming = false
        status = nil
        patchLast { m in
            m.raw["isStreaming"] = false
            m.raw["isThinking"] = false
            if let error {
                m.text = m.text.isEmpty ? error : m.text + "\n\n" + error
            } else if cancelled {
                m.raw["stopped"] = true
            }
        }
        if error == nil && !cancelled { announceDone(chat.messages.last?.raw["notchNote"] as? String) }
        if chat.messages.last?.todos.isEmpty == false {
            planUntil = Date().addingTimeInterval(1.4)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.onChange?() }
        }
        pushNow()
        onChange?()
        refreshUsage()
    }

    private func apply(_ o: JSON) {
        guard let type = o["type"] as? String else { return }
        switch type {
        case "todos":
            let items = o["items"] as? [JSON] ?? []
            patchLast { m in var run = m.raw["agentRun"] as? JSON ?? ["steps": [JSON]()]; run["todos"] = items; m.raw["agentRun"] = run }
        case "step":
            var step = o
            step["type"] = nil
            roundText = ""  // words before a tool call were commentary on the step, not the answer
            patchLast { m in
                var run = m.raw["agentRun"] as? JSON ?? ["todos": [JSON]()]
                var steps = run["steps"] as? [JSON] ?? []
                if let i = steps.firstIndex(where: { ($0["id"] as? String) == (step["id"] as? String) }) { steps[i] = step } else { steps.append(step) }
                run["steps"] = steps
                m.raw["agentRun"] = run
                m.text = ""
                m.raw["isThinking"] = false
                m.raw["isStreaming"] = true
            }
            status = nil
        case "text":
            roundText += o["text"] as? String ?? ""
            let split = ChatClient.splitNote(roundText)
            patchLast { m in
                m.text = split.text
                if let note = split.note { m.raw["notchNote"] = note }
                m.raw["isThinking"] = false
                m.raw["isStreaming"] = true
            }
            status = nil
        case "phase":
            status = o["label"] as? String
        case "done":
            let split = ChatClient.splitNote(o["text"] as? String ?? "")
            let final = split.text
            let citations = o["citations"] as? [JSON] ?? []
            patchLast { m in
                if !final.isEmpty { m.text = final }
                if let note = split.note { m.raw["notchNote"] = note }
                m.raw["searchCitations"] = citations
                m.raw["searchSources"] = citations.compactMap { $0["url"] as? String }
            }
            finish(error: nil)
            return
        case "error":
            finish(error: o["message"] as? String ?? "The agent could not finish.")
            return
        default:
            return
        }
        pushSoon()
        onChange?()
    }

    // MARK: URLSession

    func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard dataTask == task || dataTask == syncTask else { completionHandler(.cancel); return }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code != 200, dataTask == task { httpError = code }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request)
    }

    func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if dataTask == syncTask {
            for payload in syncParser.feed(String(decoding: data, as: UTF8.self)) { handleSyncEvent(payload) }
            return
        }
        guard dataTask == task else { return }
        if httpError != nil {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? JSON)?["error"] as? String
            finish(error: msg ?? "Clyra request failed.")
            task?.cancel()
            return
        }
        streamBytes.append(data)
        guard let lineEnd = streamBytes.lastIndex(of: 10) else { return }
        let lines = streamBytes.prefix(through: lineEnd)
        let chunk = String(decoding: lines, as: UTF8.self)
        streamBytes.removeSubrange(...lineEnd)
        for payload in parser.feed(chunk) {
            guard isStreaming, let bytes = payload.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: bytes) as? JSON else { continue }
            apply(o)
        }
    }

    func urlSession(_ s: URLSession, task finished: URLSessionTask, didCompleteWithError error: Error?) {
        if finished == syncTask {
            // Reconnect quietly; the store is local, so this only fails while Clyra is closed.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.startSync() }
            return
        }
        guard finished == task, isStreaming else { return }
        if let e = error as NSError?, e.code == NSURLErrorCancelled { return }
        if error != nil { finish(error: "Couldn’t reach Clyra. Make sure Clyra is open and try again.") } else { finish(error: nil) }
    }
}

import SwiftUI
import AppKit

// Clyra's chat sidebar and settings, drawn for the notch (dark). Same structure as the app: chats grouped by day,
// new chat, search, request usage, settings and the profile at the bottom.

/// One soft bubble that glides between rows as the pointer moves, like the tab switcher in the app.
struct GlideHover: ViewModifier {
    let id: String
    @Binding var hovered: String?
    let space: Namespace.ID
    func body(content: Content) -> some View {
        content
            .background { if hovered == id { RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.075)).matchedGeometryEffect(id: "glide", in: space) } }
            .onHover { inside in
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    if inside { hovered = id } else if hovered == id { hovered = nil }
                }
            }
    }
}

extension View {
    func glideHover(_ id: String, _ hovered: Binding<String?>, _ space: Namespace.ID) -> some View { modifier(GlideHover(id: id, hovered: hovered, space: space)) }
}

struct SidebarRow: View {
    let symbol: String
    let title: String
    var glided = false
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).frame(width: 16)
                Text(title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(0.9))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8).frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(hover && !glided ? 0.07 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct ChatSidebar: View {
    @ObservedObject var model: NotchModel
    @State private var query = ""
    @State private var hovered: String?
    @Namespace private var selection
    @Namespace private var glide

    private var chats: [ChatSummary] {
        let all = model.chat.allChats
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? all : all.filter { $0.title.lowercased().contains(q) }
    }

    private var groups: [(title: String, chats: [ChatSummary])] {
        let calendar = Calendar.current
        let now = Date()
        var pinned: [ChatSummary] = [], today: [ChatSummary] = [], week: [ChatSummary] = [], earlier: [ChatSummary] = []
        for chat in chats {
            if chat.pinned { pinned.append(chat) }
            else if calendar.isDateInToday(chat.updated) { today.append(chat) }
            else if now.timeIntervalSince(chat.updated) < 7 * 86_400 { week.append(chat) }
            else { earlier.append(chat) }
        }
        return [("Pinned", pinned), ("Today", today), ("Previous 7 days", week), ("Earlier", earlier)].filter { !$0.1.isEmpty }.map { (title: $0.0, chats: $0.1) }
    }

    private func stamp(_ chat: ChatSummary) -> String {
        Calendar.current.isDateInToday(chat.updated) ? chat.updated.formatted(.dateTime.hour().minute()) : chat.updated.formatted(.dateTime.day().month(.abbreviated))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Chats").font(.system(size: 14, weight: .semibold))
                Spacer()
                IconButton(symbol: "chevron.left", size: 11, label: "Hide chats") { model.toggleSidebar() }
            }
            .frame(height: 26)
            SidebarRow(symbol: "plus", title: "New chat", glided: true) { model.chat.newConversation(); model.show(.chat) }
                .glideHover("new", $hovered, glide)
            HStack(spacing: 9) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(.white.opacity(0.5)).frame(width: 16)
                TextField("Search chats", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 12.5))
                    .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?() })
            }
            .padding(.horizontal, 8).frame(height: 28)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(groups, id: \.title) { group in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(group.title).font(.system(size: 10, weight: .semibold)).tracking(0.7).textCase(.uppercase)
                                .foregroundStyle(.white.opacity(0.38)).padding(.horizontal, 8).padding(.bottom, 3)
                            ForEach(group.chats) { chat in
                                SidebarChat(chat: chat, stamp: stamp(chat), selected: chat.id == model.chat.chat.id, namespace: selection) {
                                    model.chat.open(chat)
                                    model.show(.chat)
                                }
                                .glideHover("chat-\(chat.id)", $hovered, glide)
                            }
                        }
                    }
                    if groups.isEmpty {
                        Text(query.isEmpty ? "No chats yet" : "No chats found").font(.system(size: 12)).foregroundStyle(.white.opacity(0.4)).padding(.horizontal, 8)
                    }
                }
                .padding(.top, 8)
            }
            .scrollIndicators(.never)
            .animation(model.reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.85), value: model.chat.chat.id)
            VStack(alignment: .leading, spacing: 6) {
                if let usage = model.chat.usage {
                    HStack {
                        Text("\(usage.used) of \(usage.limit) requests").font(.system(size: 11, weight: .medium))
                        Spacer()
                        Text("This billing period").font(.system(size: 10)).foregroundStyle(.white.opacity(0.4))
                    }
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.12))
                            Capsule().fill(Color.white.opacity(0.55)).frame(width: g.size.width * CGFloat(usage.used) / CGFloat(max(1, usage.limit)))
                        }
                    }
                    .frame(height: 3)
                }
                SidebarRow(symbol: "gearshape", title: "Settings", glided: true) { model.show(.settings) }
                    .glideHover("settings", $hovered, glide)
                HStack(spacing: 9) {
                    Text(String((model.chat.profileName.isEmpty ? "L" : model.chat.profileName).prefix(1)).uppercased())
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(LinearGradient(colors: [ClyraTint.blueSoft, ClyraTint.blue], startPoint: .top, endPoint: .bottom)))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(model.chat.profileName.isEmpty ? "Luke" : model.chat.profileName).font(.system(size: 12.5, weight: .semibold))
                        Text("Clyra").font(.system(size: 10.5)).foregroundStyle(.white.opacity(0.45))
                    }
                }
                .padding(.horizontal, 6)
            }
            .padding(.top, 8)
            .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1) }
        }
        .frame(width: 206)
        .onAppear { model.chat.refreshUsage(); model.chat.refreshRecent() }
    }
}

struct SidebarChat: View {
    let chat: ChatSummary
    let stamp: String
    let selected: Bool
    let namespace: Namespace.ID
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(chat.title).font(.system(size: 12.5, weight: selected ? .medium : .regular)).lineLimit(1)
                    .foregroundStyle(.white.opacity(selected ? 1 : 0.85))
                Spacer(minLength: 4)
                Text(stamp).font(.system(size: 10.5).monospacedDigit()).foregroundStyle(.white.opacity(0.38))
            }
            .padding(.horizontal, 8).frame(height: 28)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.1)).matchedGeometryEffect(id: "selected", in: namespace)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// MARK: Settings

/// Clyra's settings window as a two-pane page: sections on the left, grouped cards on the right.
struct SettingsView: View {
    @ObservedObject var model: NotchModel
    private enum Section: String, CaseIterable { case conversation = "Conversation", model = "Model", notch = "Notch"
        var symbol: String { self == .conversation ? "bubble.left" : self == .model ? "cpu" : "rectangle.topthird.inset.filled" }
    }
    @State private var section: Section = .conversation
    @State private var query = ""
    @State private var flash: String?
    @Namespace private var highlight

    /// Every setting's words, so search finds a row by anything it says, not only by its section's name.
    private static let index: [(section: Section, title: String, detail: String)] = [
        (.conversation, "Show plan while working", "The agent’s to-do list opens above the composer only while it is working. Tasks checklist"),
        (.conversation, "Auto-scroll", "Keep the latest response in view. Scroll follow"),
        (.model, "Effort", "How much Clyra thinks before it answers. Light Standard Extended reasoning depth speed"),
        (.notch, "Weather location", "Current location default city forecast temperature"),
        (.notch, "Shortcut", "Keyboard hotkey open the notch Option Command N Control Space"),
        (.notch, "Show over full-screen apps", "Spaces full screen visible above other windows"),
        (.notch, "Open at login", "Start automatically launch when you sign in"),
        (.notch, "Live audio bars", "Music visualiser playing bars system audio capture"),
        (.notch, "Face unlock", "Glance Face ID password lock screen enroll"),
        (.notch, "Quit Notch", "Close exit the app"),
    ]
    private var matches: [(section: Section, title: String, detail: String)] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [] }
        return Self.index.filter { entry in
            let hay = "\(entry.title) \(entry.detail) \(entry.section.rawValue)".lowercased()
            return words.allSatisfy { hay.contains($0) }
        }
    }
    @AppStorage("notchShowPlan") private var showPlan = true
    @AppStorage("notchAutoScroll") private var autoScroll = true
    @AppStorage("weatherCity") private var city = ""
    @AppStorage("showInFullScreen") private var fullScreen = true
    @AppStorage("hotkey") private var hotkey = "optcmdN"
    @AppStorage("notchLiveAudioBars") private var liveBars = true
    @State private var loginOn = LoginItem.enabled
    @State private var choosingCity = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                SidebarRow(symbol: "arrow.left", title: "Back to application") { model.show(.chat) }
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
                    TextField("Search settings", text: $query).textFieldStyle(.plain).font(.system(size: 12.5))
                        .simultaneousGesture(TapGesture().onEnded { model.onKeyboardFocus?() })
                }
                .padding(.horizontal, 8).frame(height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.07)))
                .padding(.bottom, 6)
                if !query.isEmpty {
                    ForEach(Array(matches.enumerated()), id: \.offset) { _, entry in
                        Button {
                            withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { section = entry.section }
                            flash = entry.title
                            query = ""
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { flash = nil }
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(entry.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(0.92)).lineLimit(1)
                                Text(entry.section.rawValue).font(.system(size: 10.5)).foregroundStyle(.white.opacity(0.4))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    if matches.isEmpty { Text("No results for “\(query)”.").font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.4)).padding(.horizontal, 8) }
                }
                ForEach(query.isEmpty ? Section.allCases : [], id: \.self) { item in
                    Button { withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { section = item } } label: {
                        HStack(spacing: 9) {
                            Image(systemName: item.symbol).font(.system(size: 12)).frame(width: 16)
                            Text(item.rawValue).font(.system(size: 12.5, weight: .medium))
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(section == item ? Color.white : Color.white.opacity(0.6))
                        .padding(.horizontal, 8).frame(height: 30)
                        .background { if section == item { RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.1)).matchedGeometryEffect(id: "nav", in: highlight) } }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }
            .frame(width: 168)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(section.rawValue).font(.system(size: 20, weight: .bold)).tracking(-0.4)
                    switch section {
                    case .conversation: conversation
                    case .model: modelSection
                    case .notch: notch
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(section)
                .transition(.opacity.combined(with: .offset(y: 6)))
            }
            .scrollIndicators(.never)
        }
        .font(.system(size: 12))
    }

    // MARK: sections

    private var conversation: some View {
        card("Composer", "Control how messages are sent and rendered.") {
            row("Show plan while working", "The agent’s to-do list opens beside the chat only while it is working.") { toggle($showPlan) }
            row("Auto-scroll", "Keep the latest response in view.") { toggle($autoScroll) }
        }
    }

    private var modelSection: some View {
        card("Effort", "How much Clyra thinks before it answers. The same setting as the composer.") {
            ForEach(ChatClient.efforts, id: \.key) { level in
                Button { model.chat.effort = level.key } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(level.title).font(.system(size: 12.5, weight: .medium))
                            Text(level.key == "light" ? "Answers directly" : level.key == "medium" ? "Plans, then answers" : "Drafts, then checks")
                                .font(.system(size: 11)).foregroundStyle(.white.opacity(0.5))
                        }
                        Spacer()
                        if model.chat.effort == level.key { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(ClyraTint.blueSoft) }
                    }
                    .padding(.vertical, 8).padding(.horizontal, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var notch: some View {
        VStack(alignment: .leading, spacing: 14) {
            card("Notch", "How it behaves on this Mac.") {
                row("Weather location", nil) {
                    Menu(city.isEmpty ? "Current location" : city) {
                        Button("Use Current Location") { model.weather.useCurrentLocation(); choosingCity = false }
                        Button("Search for a Default City…") { choosingCity = true }
                    }.menuStyle(.borderlessButton).fixedSize()
                }
                if choosingCity { CitySearch(model: model, focusOnAppear: true).padding(.horizontal, 12).padding(.bottom, 8) }
                row("Shortcut", nil) {
                    Picker("", selection: $hotkey) {
                        Text("⌥⌘N").tag("optcmdN"); Text("⌃⌥Space").tag("ctrloptSpace"); Text("Off").tag("off")
                    }
                    .labelsHidden().frame(width: 110)
                    .onChange(of: hotkey) { _, _ in NotificationCenter.default.post(name: .notchHotkeyChanged, object: nil) }
                }
                row("Show over full-screen apps", nil) {
                    toggle($fullScreen).onChange(of: fullScreen) { _, _ in NotificationCenter.default.post(name: .notchSpacesChanged, object: nil) }
                }
                row("Open at login", nil) {
                    toggle($loginOn).onChange(of: loginOn) { _, on in LoginItem.set(on); loginOn = LoginItem.enabled }
                }
            }
            card("Music", "Now playing and the audio bars.") {
                VStack(alignment: .leading) { LiveAudioSettings(meter: model.audioMeter, enabled: $liveBars, apply: model.updateAudioMeter) }
                    .padding(.horizontal, 12).padding(.vertical, 8)
            }
            card("Face unlock", "Glance, for unlocking with your face.") {
                GlanceSettings().padding(.horizontal, 12).padding(.vertical, 8)
            }
            HStack { Spacer(); Button("Quit Notch") { NSApp.terminate(nil) }.buttonStyle(Pill()) }
        }
    }

    // MARK: pieces

    private func toggle(_ binding: Binding<Bool>) -> some View {
        Toggle("", isOn: binding).labelsHidden().toggleStyle(.switch).controlSize(.small).tint(ClyraTint.blue)
    }

    private func card<C: View>(_ title: String, _ detail: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 13.5, weight: .semibold))
                Text(detail).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.5))
            }
            VStack(spacing: 0) { content() }
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        }
    }

    private func row<C: View>(_ title: String, _ detail: String?, @ViewBuilder _ control: () -> C) -> some View {
        let lit = flash == title
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 12.5, weight: .medium))
                if let detail { Text(detail).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5)).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 8)
            control()
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(lit ? 0.12 : 0)))
        .animation(.easeOut(duration: 0.4), value: lit)
    }
}

extension Notification.Name {
    static let notchHotkeyChanged = Notification.Name("notchHotkeyChanged")
    static let notchSpacesChanged = Notification.Name("notchSpacesChanged")
}

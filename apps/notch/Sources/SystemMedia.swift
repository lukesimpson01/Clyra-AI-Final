import Foundation

/// Uses the bundled BSD-licensed MediaRemoteAdapter. The native player integrations
/// remain available when macOS does not provide a system Now Playing session.
final class SystemMedia {
    private let queue = DispatchQueue(label: "notch.system-media")
    private var process: Process?
    private var buffer = Data()
    private var payload: [String: Any] = [:]
    var onUpdate: (([String: Any]?) -> Void)?

    private func makeProcess(_ args: [String]) -> Process? {
        guard let script = Bundle.main.url(forResource: "mediaremote-adapter", withExtension: "pl"),
              let framework = Bundle.main.privateFrameworksURL?.appendingPathComponent("MediaRemoteAdapter.framework"),
              FileManager.default.fileExists(atPath: framework.path) else { return nil }
        let command = Process()
        command.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
        command.arguments = [script.path, framework.path] + args
        command.standardError = FileHandle.nullDevice
        return command
    }

    func start() {
        guard process == nil, let command = makeProcess(["stream", "--debounce=75", "--micros"]) else { return }
        let output = Pipe()
        command.standardOutput = output
        let read = output.fileHandleForReading
        read.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            self?.queue.async { [weak self] in self?.consume(data) }
        }
        command.terminationHandler = { [weak self] _ in
            read.readabilityHandler = nil
            DispatchQueue.main.async { [weak self] in
                self?.process = nil
                self?.onUpdate?(nil)
            }
        }
        do { try command.run(); process = command }
        catch { read.readabilityHandler = nil }
    }

    private func consume(_ data: Data) {
        buffer.append(data)
        while let end = buffer.firstIndex(of: 10) {
            let line = buffer.prefix(upTo: end)
            buffer.removeSubrange(...end)
            guard let envelope = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                  let change = envelope["payload"] as? [String: Any] else { continue }
            if envelope["diff"] as? Bool != true { payload = [:] }
            for (key, value) in change { payload[key] = value is NSNull ? nil : value }
            let current = payload
            DispatchQueue.main.async { [weak self] in self?.onUpdate?(current) }
        }
    }

    func send(_ args: [String]) {
        queue.async { [weak self] in
            guard let command = self?.makeProcess(args) else { return }
            command.standardOutput = FileHandle.nullDevice
            try? command.run()
        }
    }

    deinit { if process?.isRunning == true { process?.terminate() } }
}

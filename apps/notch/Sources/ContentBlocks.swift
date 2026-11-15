import SwiftUI
import AppKit

/// An answer as ordered blocks, the same grammar Clyra's chat reads (src/lib/contentBlocks.ts): the agent writes text and, where a
/// picture belongs, one directive on its own line, and each picture is shown exactly there.
///   [[image: id]]   [[carousel: id, id]]   [[grid: id, id]]   [[image_text: id | Title | description]]
enum ContentBlock {
    case text(String)
    case image(ResearchImage)
    case grid([ResearchImage])
    case carousel([ResearchImage])
    case imageText(ResearchImage, String, String)
}

enum ContentBlocks {
    private static let markdownImage = try! NSRegularExpression(pattern: #"^\s*!\[[^\]]*\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)\s*$"#)
    private static let directive = try! NSRegularExpression(pattern: #"^\s*\[\[\s*(image_text|image|carousel|grid)\s*:\s*(.+?)\s*\]\]\s*$"#, options: [.caseInsensitive])

    static func uniqueImages(_ steps: [StepItem]) -> [ResearchImage] {
        var seen = Set<String>()
        return steps.filter { $0.state == "done" }.flatMap(\.images).filter { seen.insert($0.providerID.isEmpty ? $0.sourceURL : $0.providerID).inserted }
    }

    static func parse(_ content: String, images: [ResearchImage], streaming: Bool) -> [ContentBlock] {
        guard !images.isEmpty else { return [.text(content)] }
        var byID: [String: ResearchImage] = [:]
        for image in images where !image.providerID.isEmpty { byID[image.providerID] = image }
        var byURL: [String: ResearchImage] = [:]
        for image in images { byURL[image.imageURL] = image; byURL[image.thumbnailURL] = image; byURL[image.imageURL.components(separatedBy: "?")[0]] = image; byURL[image.thumbnailURL.components(separatedBy: "?")[0]] = image }
        var used = Set<String>()
        func take(_ id: String) -> ResearchImage? {
            let key = id.trimmingCharacters(in: .whitespaces)
            guard let image = byID[key], used.insert(key).inserted else { return nil }
            return image
        }
        var blocks: [ContentBlock] = []
        var buffer: [String] = []
        func flush() {
            let text = buffer.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !text.trimmingCharacters(in: .whitespaces).isEmpty { blocks.append(.text(text)) }
            buffer = []
        }
        var placed = 0
        let lines = content.components(separatedBy: "\n")
        for (index, line) in lines.enumerated() {
            let range = NSRange(line.startIndex..., in: line)
            // a picture the model wrote as plain markdown still belongs in place: match it to the run's real images by address
            if let md = markdownImage.firstMatch(in: line, range: range), let urlRange = Range(md.range(at: 1), in: line) {
                let url = String(line[urlRange])
                if let image = byURL[url] ?? byURL[url.components(separatedBy: "?")[0]], used.insert(image.providerID.isEmpty ? image.sourceURL : image.providerID).inserted {
                    flush(); blocks.append(.image(image)); placed += 1
                    continue
                }
            }
            guard let match = directive.firstMatch(in: line, range: range),
                  let kindRange = Range(match.range(at: 1), in: line), let bodyRange = Range(match.range(at: 2), in: line) else {
                // a directive still being written must not flash on screen
                if streaming && index == lines.count - 1 && line.trimmingCharacters(in: .whitespaces).hasPrefix("[[") && !line.contains("]]") { continue }
                buffer.append(line)
                continue
            }
            let kind = line[kindRange].lowercased()
            let body = String(line[bodyRange])
            switch kind {
            case "image":
                if let image = take(body) { flush(); blocks.append(.image(image)); placed += 1 }
            case "carousel", "grid":
                let list = body.split(separator: ",").compactMap { take(String($0)) }
                if list.count == 1 { flush(); blocks.append(.image(list[0])); placed += 1 }
                else if !list.isEmpty { flush(); blocks.append(kind == "carousel" ? .carousel(list) : .grid(Array(list.prefix(4)))); placed += 1 }
            default:
                let parts = body.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
                if let image = take(parts.first ?? "") { flush(); blocks.append(.imageText(image, parts.count > 1 && !parts[1].isEmpty ? parts[1] : image.title, parts.count > 2 ? parts[2] : "")); placed += 1 }
            }
        }
        flush()
        if placed == 0 && !streaming { return withFallback(blocks, images: images) }
        return blocks.isEmpty ? [.text("")] : blocks
    }

    /// The model wrote no placement: show the pictures right after the introduction, never at the very end.
    private static func withFallback(_ blocks: [ContentBlock], images: [ResearchImage]) -> [ContentBlock] {
        guard let first = blocks.firstIndex(where: { if case .text = $0 { return true } else { return false } }),
              case .text(let text) = blocks[first] else { return blocks }
        var paragraphs = text.components(separatedBy: "\n\n")
        var cut = 1
        if paragraphs[0].hasPrefix("#") && paragraphs.count > 1 { cut = 2 }
        cut = min(cut, paragraphs.count)
        let head = paragraphs.prefix(cut).joined(separator: "\n\n")
        let tail = paragraphs.dropFirst(cut).joined(separator: "\n\n")
        paragraphs = []
        let pick = Array(images.prefix(6))
        let visual: ContentBlock = pick.count == 1 ? .image(pick[0]) : (pick.count == 2 ? .grid(pick) : .carousel(pick))
        var out: [ContentBlock] = Array(blocks[..<first]) + [.text(head), visual]
        if !tail.trimmingCharacters(in: .whitespaces).isEmpty { out.append(.text(tail)) }
        out += blocks[(first + 1)...]
        return out
    }
}

/// A non-text block, sized for the notch: smaller than in Clyra, with the same rounded tiles, captions and lift.
struct InlineImageBlock: View {
    let block: ContentBlock

    var body: some View {
        switch block {
        case .image(let image):
            VStack(alignment: .leading, spacing: 5) {
                ImageTile(image: image, hero: false, index: 0).frame(maxWidth: 300).frame(height: 132)
                Text(image.title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
            }
        case .carousel(let images):
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Array(images.enumerated()), id: \.element.id) { i, image in ImageTile(image: image, hero: false, index: i).frame(width: 136, height: 94) }
                }
                .padding(.trailing, 20)
            }
            .scrollIndicators(.never)
            .mask(LinearGradient(stops: [.init(color: .white, location: 0), .init(color: .white, location: 0.9), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
        case .grid(let images):
            switch images.count {
            case 2:
                HStack(spacing: 5) { ForEach(Array(images.enumerated()), id: \.element.id) { i, image in ImageTile(image: image, hero: false, index: i).frame(height: 92) } }.frame(maxWidth: 300)
            case 3:
                HStack(spacing: 5) {
                    ImageTile(image: images[0], hero: false, index: 0).frame(width: 176, height: 117)
                    VStack(spacing: 5) { ImageTile(image: images[1], hero: false, index: 1); ImageTile(image: images[2], hero: false, index: 2) }.frame(width: 88, height: 117)
                }
            default:
                VStack(spacing: 5) {
                    HStack(spacing: 5) { ImageTile(image: images[0], hero: false, index: 0); ImageTile(image: images[1], hero: false, index: 1) }.frame(height: 74)
                    HStack(spacing: 5) { ForEach(Array(images.dropFirst(2).prefix(2).enumerated()), id: \.element.id) { i, image in ImageTile(image: image, hero: false, index: i + 2) } }.frame(height: 74)
                }.frame(maxWidth: 300)
            }
        case .imageText(let image, let title, let text):
            HStack(alignment: .top, spacing: 10) {
                ImageTile(image: image, hero: false, index: 0).frame(width: 60, height: 60)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 12.5, weight: .semibold)).lineLimit(2)
                    if !text.isEmpty { Text(text).font(.system(size: 12)).foregroundStyle(.white.opacity(0.62)).lineLimit(3) }
                }
            }
            .frame(maxWidth: 320, alignment: .leading)
        case .text:
            EmptyView()
        }
    }
}

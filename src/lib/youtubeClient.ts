export type YouTubeVideoProgress = {
  video_id: string;
  title: string;
  url: string;
};

export type YouTubeTranscriptChunk = {
  chunk_number: number;
  start_timestamp: string;
  end_timestamp: string;
  text: string;
  char_count: number;
};

export type YouTubeVideoResult = {
  score: number;
  video_id: string;
  title: string;
  url: string;
  thumbnail?: string | null;
  uploader?: string | null;
  channel?: string | null;
  duration?: number | null;
  upload_date?: string | null;
  language?: string | null;
  views?: number | null;
  description?: string | null;
  transcript_available: boolean;
  transcript_language?: string | null;
  transcript_chunks: YouTubeTranscriptChunk[];
  keywords: string[];
  entities: string[];
  extracted_links: string[];
  summary?: string | null;
  error?: string | null;
};

export type YouTubeCompletePayload = {
  type: "complete";
  query: string;
  search_time_ms: number;
  total_results: number;
  videos: YouTubeVideoResult[];
};

export type YouTubeProgressEvent =
  | { type: "video"; video_id: string; title: string; url: string }
  | YouTubeCompletePayload
  | { type: "error"; message: string };

export function formatYoutubeResearchContext(payload: YouTubeCompletePayload): string {
  if (!payload.videos.length) {
    return "No YouTube research results were found. Say you could not verify video details and avoid guessing.";
  }

  const sections: string[] = [
    `YouTube research query: ${payload.query}`,
    `Videos reviewed: ${payload.videos.length}`,
    "",
  ];

  payload.videos.slice(0, 4).forEach((video, index) => {
    sections.push(`[${index + 1}] ${video.title}`);
    sections.push(`URL: ${video.url}`);
    if (video.channel) sections.push(`Channel: ${video.channel}`);
    if (video.description) sections.push(`Description: ${video.description.slice(0, 600)}`);
    for (const chunk of video.transcript_chunks.slice(0, 3)) {
      sections.push(`[${chunk.start_timestamp}] ${chunk.text}`);
    }
    sections.push("");
  });

  sections.push(
    "Answer using only the YouTube research above. Cite videos by number and timestamps when stating facts.",
  );
  return sections.join("\n");
}

export async function runYoutubeResearch(
  query: string,
  onProgress: (event: YouTubeProgressEvent) => void,
  videoUrl?: string,
): Promise<YouTubeCompletePayload | null> {
  const response = await fetch("/api/youtube-research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, videoUrl }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`YouTube research failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: YouTubeCompletePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(6)) as YouTubeProgressEvent;
        onProgress(event);
        if (event.type === "complete") complete = event;
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return complete;
}

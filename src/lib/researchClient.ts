export type ResearchSite = {
  host: string;
  title: string;
  url: string;
};

export type ResearchChunk = {
  index: number;
  text: string;
  char_count: number;
};

export type ResearchResult = {
  title: string;
  url: string;
  final_url: string;
  host: string;
  snippet: string;
  status_code: number | null;
  content_type: string | null;
  extraction_success: boolean;
  score: number;
  title_extracted?: string | null;
  chunks: ResearchChunk[];
  error?: string | null;
};

export type ResearchCompletePayload = {
  type: "complete";
  query: string;
  search_time_ms: number;
  providers: string[];
  total_results: number;
  results: ResearchResult[];
};

export type ResearchProgressEvent =
  | { type: "site"; host: string; title: string; url: string }
  | ResearchCompletePayload
  | { type: "error"; message: string };

export function formatResearchContext(payload: ResearchCompletePayload): string {
  if (!payload.results.length) {
    return "No web research results were found. Say you could not verify facts online and avoid guessing.";
  }

  const sections: string[] = [
    `Research query: ${payload.query}`,
    `Sources reviewed: ${payload.results.length}`,
    "",
  ];

  payload.results.slice(0, 6).forEach((result, index) => {
    sections.push(`[${index + 1}] ${result.title_extracted || result.title}`);
    sections.push(`URL: ${result.final_url || result.url}`);
    if (result.snippet) sections.push(`Snippet: ${result.snippet}`);
    for (const chunk of result.chunks.slice(0, 2)) {
      sections.push(chunk.text);
    }
    sections.push("");
  });

  sections.push(
    "Answer using only the research above. Cite sources by number when stating facts. If information is missing, say so instead of guessing.",
  );

  return sections.join("\n");
}

export async function runResearch(
  query: string,
  onProgress: (event: ResearchProgressEvent) => void,
): Promise<ResearchCompletePayload | null> {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Research failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: ResearchCompletePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) continue;

      try {
        const event = JSON.parse(line.slice(6)) as ResearchProgressEvent;
        onProgress(event);
        if (event.type === "complete") {
          complete = event;
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return complete;
}

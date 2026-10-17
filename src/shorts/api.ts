// Typed client for the Shorts HTTP API. Every call returns the server's typed
// result or throws an Error whose message is safe to show to the user.

import type { CaptionPreset, ShortsKind, ShortsProject, TimelineItem } from "../../lib/shorts/schema";
import type { GeneratedScript } from "../../lib/shorts/ai";

export type ProjectSummary = {
  id: string;
  kind: ShortsKind;
  title: string;
  updatedAt: string;
  createdAt: string;
  aspect: ShortsProject["aspect"];
  durationMs: number;
  thumbnail: string | null;
  exportCount: number;
  itemCount: number;
  origin: "youtube" | "upload" | "generated" | null;
};

export type LibraryTrack = { file: string; title: string; kind: "music" | "sfx"; durationMs: number; bytes: number; addedAt: string; hasAudio: boolean };

export type GameplayLibraryClip = { id: string; category: string; label: string; videoUrl: string; posterUrl: string | null };

export type ShortsUsage = { totalBytes: number; projectsBytes: number; libraryBytes: number; budgetBytes: number; fraction: number; projectCount: number; exportMinutes: number };

export type JobSnapshot = {
  id: string;
  kind: "render" | "cut" | "transcribe" | "clip-import" | "faketext-timeline";
  projectId: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  stageLabel: string;
  message: string;
  overall: number;
  completed: number;
  total: number;
  elapsedMs: number;
  warnings: string[];
  error: string | null;
  result: any;
  timestamp: number;
};

export type YoutubeSource = {
  url: string;
  videoId: string;
  title: string;
  channel: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  thumbnail: string;
  isLive: boolean;
  uploadDate: string;
  viewCount: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json", ...(init.headers || {}) } : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

export const shortsApi = {
  listProjects: () => request<{ projects: ProjectSummary[] }>("/api/shorts/projects"),
  getProject: (id: string) => request<{ project: ShortsProject }>(`/api/shorts/projects/${encodeURIComponent(id)}`),
  createProject: (input: { kind: ShortsKind; title?: string; aspect?: ShortsProject["aspect"]; generated?: { items: TimelineItem[]; captionWords?: unknown[] }; captionsEnabled?: boolean; narration?: { enabled: boolean; voice: string; speed?: number; volume?: number }; background?: ShortsProject["background"]; resolution?: 720 | 1080; fps?: number }) =>
    request<{ project: ShortsProject }>("/api/shorts/projects", { method: "POST", body: JSON.stringify(input) }),
  saveProject: (project: ShortsProject) =>
    request<{ project: ShortsProject; savedAt: string }>(`/api/shorts/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify(project) }),
  deleteProject: (id: string) => request<{ deleted: boolean }>(`/api/shorts/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  attachUpload: (projectId: string, uploadId: string, title: string, muted?: boolean) =>
    request<{ project: ShortsProject }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/attach-upload`, { method: "POST", body: JSON.stringify({ uploadId, title, muted }) }),
  buildFakeTextTimeline: (projectId: string) =>
    request<{ job: JobSnapshot }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/faketext/build-timeline`, { method: "POST" }),
  faketextSpeechUrl: (projectId: string, messageId: string) => `/api/shorts/projects/${encodeURIComponent(projectId)}/faketext/speech/${encodeURIComponent(messageId)}`,
  uploadFakeTextImage: (projectId: string, dataUrl: string) =>
    request<{ assetPath: string }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/faketext/image`, { method: "POST", body: JSON.stringify({ dataUrl }) }),
  assetUrl: (projectId: string, assetPath: string) => `/api/shorts/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetPath.replace(/^assets\//, ""))}`,
  listGameplayLibrary: () => request<{ clips: GameplayLibraryClip[] }>("/api/shorts/faketext/gameplay-library"),
  attachGameplayClip: (projectId: string, clipId: string) =>
    request<{ project: ShortsProject }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/faketext/gameplay-library`, { method: "POST", body: JSON.stringify({ clipId }) }),
  inspectYoutube: (url: string) => request<{ source: YoutubeSource }>("/api/shorts/source/inspect", { method: "POST", body: JSON.stringify({ url }) }),
  probeUpload: (uploadId: string, name: string) =>
    request<{ probe: { durationMs: number; width: number; height: number; fps: number; hasAudio: boolean; uploadId: string; name: string } }>("/api/shorts/source/probe", { method: "POST", body: JSON.stringify({ uploadId, name }) }),
  generate: (input: Record<string, unknown>) =>
    request<{ script: GeneratedScript; items: TimelineItem[]; title: string }>("/api/shorts/ai/generate", { method: "POST", body: JSON.stringify(input) }),
  startRender: (projectId: string, options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high" }) =>
    request<{ job: JobSnapshot }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/render`, { method: "POST", body: JSON.stringify(options) }),
  startCut: (projectId: string, body: Record<string, unknown>) =>
    request<{ job: JobSnapshot }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/cut`, { method: "POST", body: JSON.stringify(body) }),
  startTranscribe: (projectId: string, model: "tiny" | "base" | "small") =>
    request<{ job: JobSnapshot }>(`/api/shorts/projects/${encodeURIComponent(projectId)}/transcribe`, { method: "POST", body: JSON.stringify({ model }) }),
  cancelJob: (jobId: string) => request<{ job: JobSnapshot }>(`/api/shorts/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  importClip: (payload: Record<string, unknown>) => request<{ project: ShortsProject }>("/api/shorts/clips/import", { method: "POST", body: JSON.stringify(payload) }),
  listPresets: () => request<{ presets: CaptionPreset[] }>("/api/shorts/presets"),
  savePresets: (presets: CaptionPreset[]) => request<{ presets: CaptionPreset[] }>("/api/shorts/presets", { method: "PUT", body: JSON.stringify({ presets }) }),
  listLibrary: (kind: "music" | "sfx") => request<{ tracks: LibraryTrack[]; folder: string }>(`/api/shorts/library/${kind}`),
  libraryFileUrl: (kind: "music" | "sfx", file: string) => `/api/shorts/library/${kind}/${encodeURIComponent(file)}`,
  usage: () => request<{ usage: ShortsUsage }>("/api/shorts/usage"),
};

/** Upload a local video through the existing clipper upload route. Streams the file; never reads it into memory. */
export function uploadVideoFile(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<{ uploadId: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/clipper/upload?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { ok?: boolean; uploadId?: string; name?: string; size?: number; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.ok && body.uploadId) {
          resolve({ uploadId: body.uploadId, name: body.name || file.name, size: body.size || file.size });
        } else {
          reject(new Error(body.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error("Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check the connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Subscribes to a job's server-sent events. Returns an unsubscribe function. */
export function subscribeJob(jobId: string, onSnapshot: (job: JobSnapshot) => void, onError?: (message: string) => void) {
  const source = new EventSource(`/api/shorts/jobs/${encodeURIComponent(jobId)}/events`);
  const handle = (event: MessageEvent) => {
    try {
      onSnapshot(JSON.parse(event.data) as JobSnapshot);
    } catch {
      onError?.("Received an unreadable progress update");
    }
  };
  for (const name of ["job.snapshot", "job.stage", "job.progress", "job.log", "job.completed", "job.failed", "job.cancelled"]) {
    source.addEventListener(name, handle as EventListener);
  }
  source.onerror = () => {
    // EventSource retries on its own; only surface the error when the job is gone.
    if (source.readyState === EventSource.CLOSED) onError?.("Lost the connection to the job");
  };
  return () => source.close();
}

/** Tracks a job until a terminal state. Resolves with the final snapshot. */
export function waitForJob(jobId: string, onUpdate?: (job: JobSnapshot) => void): Promise<JobSnapshot> {
  return new Promise((resolve, reject) => {
    const close = subscribeJob(
      jobId,
      (job) => {
        onUpdate?.(job);
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          close();
          resolve(job);
        }
      },
      (message) => {
        close();
        reject(new Error(message));
      },
    );
  });
}

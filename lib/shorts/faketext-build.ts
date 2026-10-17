// Turns a Fake Text Story's current script (project.items, type "message")
// into the authoritative, TTS-timed version: synthesizes (or reuses cached)
// speech per message, then runs the pure timeline builder so bubble/typing/
// scroll timing all derive from real audio duration. Runs as a background job
// like render/cut so a 30-message story doesn't block the editor, and so
// navigating away mid-build doesn't abort it.

import type { MessageItem, ShortsProject } from "./schema";
import { cancel, complete, createJob, enterStage, fail, reportProgress, warn, type ShortsJob } from "./jobs";
import { readProjectFile, writeProjectFile } from "./store";
import { synthesizeMessageSpeech } from "./faketext-tts";
import { fetchSpeech } from "./tts-client";
import { buildFakeTextTimeline, geometryForFakeText, type FakeTextScriptMessage, type SpeechDuration } from "./faketext-timeline";
import { paceMultiplier } from "./templates";

const STAGES = [
  { id: "voices", label: "Synthesizing voices", weight: 85 },
  { id: "timeline", label: "Laying out the conversation", weight: 15 },
];

export function startFakeTextTimelineBuild(projectId: string, origin: string) {
  const project = readProjectFile(projectId);
  if (!project) throw new Error("This project no longer exists.");
  if (project.kind !== "fake-text") throw new Error("This project is not a Fake Text Story.");
  const job = createJob({ kind: "faketext-timeline", projectId, stages: STAGES });
  void runBuild(job, project, origin).catch((error) => {
    if (job.status === "cancelled") return;
    fail(job, error instanceof Error ? error.message : "Could not build the conversation timeline.");
  });
  return job;
}

async function runBuild(job: ShortsJob, project: ShortsProject, origin: string) {
  const signal = job.controller.signal;
  try {
    enterStage(job, "voices", "Synthesizing voices");
    const messages = project.items.filter((item): item is MessageItem => item.type === "message");
    const voices = project.fakeText.voices;
    const speechDurations = new Map<string, SpeechDuration>();
    let placeholderCount = 0;
    let index = 0;
    for (const item of messages) {
      if (signal.aborted) throw new Error("Cancelled");
      index += 1;
      reportProgress(job, index - 1, messages.length, `Voice ${index} of ${messages.length}`);
      const side = item.side === "right" ? "user" : "contact";
      const voice = item.voice || (side === "user" ? voices.userVoice : voices.contactVoice);
      const speed = side === "user" ? voices.userSpeed : voices.contactSpeed;
      const speech = await synthesizeMessageSpeech(project.id, voice, item.text, (text, voiceName) => fetchSpeech(origin, text, voiceName, signal));
      if (speech.placeholder) placeholderCount += 1;
      speechDurations.set(item.id, { ms: speech.placeholder ? 0 : Math.round(speech.durationMs / speed), placeholder: speech.placeholder });
    }
    if (placeholderCount > 0) {
      warn(job, `${placeholderCount} of ${messages.length} line(s) used a local timing placeholder instead of real speech (no hosted or system voice is configured) — those bubbles will appear silently.`);
    }
    reportProgress(job, messages.length, messages.length, "Voices ready");

    enterStage(job, "timeline", "Laying out the conversation");
    const scriptMessages: FakeTextScriptMessage[] = messages.map((item) => ({
      id: item.id,
      side: item.side,
      sender: item.sender,
      text: item.text,
      reaction: item.reaction,
      voice: item.voice,
      mediaAsset: item.mediaAsset,
    }));
    const { geometry, viewportHeightPx, bottomPaddingPx } = geometryForFakeText(project.aspect, project.fakeText.theme);
    const timedItems = buildFakeTextTimeline(scriptMessages, speechDurations, {
      typingEnabled: voices.typingIndicatorEnabled,
      typingDuration: voices.typingDuration,
      typingDurationCustomMs: voices.typingDurationCustomMs,
      paceMultiplier: paceMultiplier(project.template.pace, project.template.paceCustom),
      geometry,
      viewportHeightPx,
      bottomPaddingPx,
    });

    const latest = readProjectFile(project.id);
    if (!latest) throw new Error("This project no longer exists.");
    const otherItems = latest.items.filter((item) => item.type !== "message");
    latest.items = [...otherItems, ...timedItems];
    latest.updatedAt = new Date().toISOString();
    writeProjectFile(latest);
    reportProgress(job, 1, 1, "Timeline ready");
    complete(job, { project: latest, messageCount: timedItems.length, placeholderCount });
  } catch (error) {
    if (signal.aborted) {
      cancel(job);
      return;
    }
    throw error;
  }
}

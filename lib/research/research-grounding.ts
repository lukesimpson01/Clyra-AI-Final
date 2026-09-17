/**
 * A retrieved URL is not proof by itself. Research prose is eligible for a
 * user-facing factual answer only when it cites one of the fetched excerpts.
 * Keep this browser-safe: it is shared by the Chat renderer and Node tests.
 */
export function isGroundedWebResearchAnswer(answer: string, fetchedSourceCount: number): boolean {
  const trimmed = answer.trim();
  if (!trimmed) return false;
  if (fetchedSourceCount <= 0) {
    return /(?:could not|cannot|can't|unable to)\s+(?:verify|establish)|(?:no|insufficient)\s+(?:retrieved|usable|fetched|verified)\s+(?:evidence|source|page)/i.test(trimmed);
  }
  const citations = [...trimmed.matchAll(/\[S(\d+)\]/g)].map((match) => Number(match[1]));
  return citations.length > 0 && citations.every((source) => Number.isInteger(source) && source >= 1 && source <= fetchedSourceCount);
}

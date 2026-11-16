/** Share camera/screen stills only when a user explicitly asks about the view. */
export function asksToInspectSharedView(text: string): boolean {
  const q = text.toLowerCase().replace(/[?!.]+$/g, "").trim();
  return [
    "what can you see", "what do you see", "what are you seeing",
    "what is on my screen", "what's on my screen", "what is on the screen",
    "what's on the screen", "what is in my camera", "what is in the camera",
    "what am i looking at", "what am i showing you", "what are we looking at",
    "describe this", "describe the view", "describe the screen", "describe the camera",
    "look at this", "look at my screen", "look at the screen", "look at the camera",
    "read this", "read the screen", "read the text", "read the sign",
    "can you see this", "can you see my", "can you see the",
    "what is this", "what's this", "what is in front of me",
  ].some((phrase) => q.includes(phrase));
}

/**
 * Which view the person is asking Clyra to use: "screen", "camera", or "off" (stop looking). Null when it is neither. Used by the
 * voice call so Clyra switches between plain talking, the screen and the camera by itself, as the conversation needs.
 */
export function detectMediaIntent(text: string): "screen" | "camera" | "off" | null {
  const q = text.toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (/\b(stop|turn off|end|quit)\b[^.?!]{0,24}\b(sharing|screen share|camera|looking|watching)\b/.test(q)) return "off";
  if (/\b(look at|see|check|watch|share|show|read)\b[^.?!]{0,30}\b(my screen|the screen|my display|my desktop|my monitor|what i(?:'|’)?m doing|this page|this window|this tab)\b/.test(q) || /\b(can you see|do you see) (?:my|the) screen\b|\bwhere (?:is|are|do i)\b[^.?!]{0,40}\b(on (?:my|the) screen|click|find)\b|\b(screen share|share (?:my )?screen)\b/.test(q)) return "screen";
  if (/\b(look at me|see me|use (?:the |my )?camera|turn on (?:the |my )?camera|my camera|on camera)\b|\b(show|showing) you (?:this|something|my)\b|\bwhat am i holding\b|\bwhat(?:'|’)?s in my hand\b|\bhold(?:ing)? up\b/.test(q)) return "camera";
  return null;
}

/** A question about where something is, or how to do it on the shared screen: Clyra answers and points at it. */
export function asksWhereOnScreen(text: string): boolean {
  return /\b(where(?:'|’)?s|where is|where are|where do i|which (?:button|one|icon|tab|menu)|point (?:to|at)|show me where|show me how|how do i|how to|click|highlight|find (?:the|my))\b/i.test(text);
}

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

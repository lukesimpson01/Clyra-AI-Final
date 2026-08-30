/* Marker for prompts Clyra injects into a coding session on the user's
   behalf — recovery nudges when a provider ends a turn early.

   They have to be real user turns for the model to act on them, which means
   they arrive in the transcript like anything else. The marker lets the
   transcript drop them, so the agent's own scaffolding is never shown to the
   person who asked for a Pomodoro timer. */
export const INTERNAL_PROMPT_MARK = "⁣clyra-internal⁣";

export const internalPrompt = (text: string) => `${INTERNAL_PROMPT_MARK}${text}`;

export const isInternalPrompt = (text: unknown) =>
  typeof text === "string" && text.startsWith(INTERNAL_PROMPT_MARK);

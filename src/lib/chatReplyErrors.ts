/**
 * Turns a failed model reply into copy a person can act on. The raw error
 * (HTTP status, provider detail) stays in the console for diagnosis; it is
 * never written into the conversation.
 */
export function chatReplyFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = Number(message.match(/API error: (\d{3})/)?.[1] ?? 0);
  if (status === 429 || /rate.?limit|too many requests/i.test(message)) {
    return "Clyra's model is rate-limited right now. Wait a moment, then press Retry.";
  }
  if (status === 401 || status === 403) {
    return "Clyra couldn't authorise the model. Check the API key in Settings, then press Retry.";
  }
  if (status >= 500) {
    return "The model service isn't responding right now. Press Retry in a moment.";
  }
  if (error instanceof TypeError || /failed to fetch|network/i.test(message)) {
    return "Clyra couldn't reach the model. Check your connection, then press Retry.";
  }
  return "Clyra couldn't finish this reply. Press Retry to try again.";
}

// Narration voice names the Creator TTS service accepts. The service maps each
// name to a hosted voice when one is configured, or to a local system voice.
export const SHORTS_VOICES = [
  "Max", "Ryan", "Aiden", "Aaron", "Abigail", "Anaya", "Andy", "Archer", "Brian", "Chloe", "Dylan", "Emmanuel",
  "Ethan", "Evelyn", "Gavin", "Gordon", "Ivan", "Laura", "Lucy", "Madison", "Marisol", "Meera", "Walter",
] as const;
export type ShortsVoice = (typeof SHORTS_VOICES)[number];

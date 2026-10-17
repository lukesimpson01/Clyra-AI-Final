export type DictationStyle = "raw" | "light" | "polished";
export type AppKind = "code" | "casual" | "formal" | "generic";
export type CleanupOptions = { level?: DictationStyle; dictionary?: string[]; application?: string | null };
export type CleanupResult = { text: string; changed: boolean; kind: AppKind; needsModel: boolean };
export function classifyApp(application?: string | null): AppKind;
export function cleanDictation(input: string, options?: CleanupOptions): CleanupResult;

export type ProjectIntent = "ios-app" | "web-app" | "desktop-app" | "unspecified";

const IOS_PRODUCT = /\b(?:ios|iphone|ipad|swiftui|uikit|xcode)\s+(?:app|application|project|widget|extension|client|game)\b|\b(?:build|create|make|develop|scaffold)\b[^.!?\n]{0,80}\b(?:ios|iphone|ipad|swiftui|uikit)\b/i;
const IOS_STYLE_ONLY = /\b(?:ios|iphone|ipad|swiftui|apple)\s+(?:theme|style|look|aesthetic|design|inspired)\b/i;
const WEB_PRODUCT = /\b(?:web|website|browser|landing page|react|next\.?js|vite)\b/i;
const DESKTOP_PRODUCT = /\b(?:desktop|electron|windows|macos)\s+(?:app|application|project)\b/i;

/** "iOS theme" is a visual direction, not authority to replace the stack with Swift. */
export function inferProjectIntent(prompt: string, existingPlatform?: ProjectIntent): ProjectIntent {
  const text = prompt.trim();
  if (IOS_STYLE_ONLY.test(text) && !IOS_PRODUCT.test(text)) return existingPlatform ?? "unspecified";
  if (IOS_PRODUCT.test(text)) return "ios-app";
  if (DESKTOP_PRODUCT.test(text)) return "desktop-app";
  if (WEB_PRODUCT.test(text)) return "web-app";
  return existingPlatform ?? "unspecified";
}

export function requestsIosProject(prompt: string, existingPlatform?: ProjectIntent) {
  return inferProjectIntent(prompt, existingPlatform) === "ios-app";
}

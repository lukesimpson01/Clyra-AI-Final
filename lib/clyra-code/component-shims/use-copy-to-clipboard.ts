import * as React from "react";

export function useCopyToClipboard({ timeout = 2000, onCopy }: { timeout?: number; onCopy?: () => void } = {}) {
  const [isCopied, setIsCopied] = React.useState(false);
  const copyToClipboard = (value: string) => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).catch(() => undefined);
    setIsCopied(true);
    onCopy?.();
    window.setTimeout(() => setIsCopied(false), timeout);
  };
  return { isCopied, copyToClipboard };
}

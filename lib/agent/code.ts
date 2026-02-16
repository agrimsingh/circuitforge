const CODE_BLOCK_RE = /```tsx\s*\r?\n([\s\S]*?)```/gi;

export function extractCodeFromText(text: string): string | null {
  let lastMatch: string | null = null;
  let match;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    lastMatch = match[1].trim();
  }
  CODE_BLOCK_RE.lastIndex = 0;
  return lastMatch;
}

export function stripCodeBlocks(text: string): string {
  let result = text.replace(CODE_BLOCK_RE, "\n[Circuit code generated — see Circuit Preview]\n");
  const openIdx = result.search(/```tsx\s*\r?\n/i);
  if (openIdx !== -1) result = result.slice(0, openIdx) + "\n[Generating circuit code...]";
  return result.trim();
}

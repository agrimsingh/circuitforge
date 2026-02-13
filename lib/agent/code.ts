const CODE_BLOCK_RE = /```tsx\n([\s\S]*?)```/g;

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
  let result = text.replace(CODE_BLOCK_RE, "\n[Circuit code generated — see Code tab]\n");
  const openIdx = result.indexOf("```tsx\n");
  if (openIdx !== -1) {
    result = result.slice(0, openIdx) + "\n[Generating circuit code...]";
  }
  return result.trim();
}

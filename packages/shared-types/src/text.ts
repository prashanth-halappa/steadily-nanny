// Small, dependency-free text utilities shared across the app.

/**
 * Counts whitespace-separated words in a string.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Counts sentences in a string. A sentence ends with one or more of
 * `.`, `!`, or `?` (consecutive terminators count as one).
 */
export function countSentences(text: string): number {
  const matches = text.match(/[.!?]+/g);
  return matches ? matches.length : 0;
}

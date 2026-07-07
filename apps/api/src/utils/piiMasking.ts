/**
 * PII masking utilities.
 *
 * Mask a person's name (PII) before sending text to an LLM, and restore it in
 * the response. The placeholder is parameterized (default `[NAME]`) so the same
 * engine works for any entity you need to redact.
 *
 * @module utils/piiMasking
 */

/** Default placeholder substituted for the masked name. */
export const DEFAULT_PLACEHOLDER = '[NAME]';

/** Options accepted by the masking functions. */
export interface PiiMaskOptions {
  /** Placeholder token to substitute (default `[NAME]`). */
  placeholder?: string;
}

/** Minimum name length to mask — avoids over-masking single characters. */
const MIN_NAME_LENGTH = 2;

/**
 * Common English words that are also names. For these we match case-sensitively
 * and skip sentence-initial positions, to reduce false positives (e.g. "will"
 * the modal verb). Accepted residual risk: sentence-initial or ALL-CAPS uses of
 * a common-word name may not be masked, since distinguishing name from word
 * needs NLP.
 */
const COMMON_WORD_NAMES = new Set([
  'will',
  'may',
  'june',
  'rose',
  'grace',
  'mark',
  'hope',
  'autumn',
  'summer',
  'dawn',
  'melody',
  'ivy',
]);

function isCommonWordName(name: string): boolean {
  return COMMON_WORD_NAMES.has(name.toLowerCase());
}

/** True if a match position is at the start of a sentence. */
function isSentenceInitial(text: string, matchStart: number): boolean {
  if (matchStart === 0) {
    return true;
  }
  const beforeMatch = text.substring(0, matchStart);
  return /[.!?\n]\s*$/.test(beforeMatch);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scripts written without word-segmenting spaces. For these a letter-boundary
 * rule under-masks (leaking PII), so we match the bare substring instead
 * (over-masking is the safe direction).
 */
const NON_SEGMENTED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Mask `name` with the placeholder in the given text.
 *
 * Uses Unicode-aware lookarounds (not ASCII `\b`) so space-segmented non-Latin
 * names are matched as whole words. Non-segmented scripts (CJK) fall back to
 * substring matching.
 */
export function maskPII(
  text: string,
  name: string,
  options?: PiiMaskOptions
): string {
  const placeholder = options?.placeholder ?? DEFAULT_PLACEHOLDER;
  if (!text || !name) {
    return text;
  }

  const trimmedName = name.trim();
  if (trimmedName.length < MIN_NAME_LENGTH) {
    return text;
  }

  const escapedName = escapeRegExp(trimmedName);
  const isCommonWord = isCommonWordName(trimmedName);
  const isNonSegmented = NON_SEGMENTED_SCRIPT.test(trimmedName);

  if (isNonSegmented) {
    // CJK: substring matching, no case-sensitivity adjustment.
    return text.replace(new RegExp(escapedName, 'gu'), placeholder);
  }

  if (isCommonWord) {
    // Case-sensitive for common words; skip sentence-initial.
    const pattern = `(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}_])`;
    const regex = new RegExp(pattern, 'gu'); // 'u', NOT 'i'
    const result: string[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(regex)) {
      const matchIndex = match.index;
      if (matchIndex !== undefined && !isSentenceInitial(text, matchIndex)) {
        result.push(text.substring(lastIndex, matchIndex));
        result.push(placeholder);
        lastIndex = matchIndex + match[0].length;
      }
    }
    result.push(text.substring(lastIndex));
    return result.join('');
  }

  // Non-common-word names: case-insensitive.
  const pattern = `(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}_])`;
  return text.replace(new RegExp(pattern, 'giu'), placeholder);
}

/** Uppercase bare-word form of a bracketed placeholder (e.g. `[NAME]` → `NAME`). */
function bareWord(placeholder: string): string {
  return placeholder.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
}

/**
 * Restore `name` in place of the placeholder token.
 *
 * Handles two forms:
 * 1. The proper bracketed token — case- and stray-space-tolerant.
 * 2. A bracket-dropped leak — a model occasionally emits the bare uppercase word
 *    (e.g. `NAME`) instead of the token. We restore this too, but ONLY the
 *    all-caps bare word, case-sensitively: a case-insensitive match would catch
 *    the ordinary lowercase word and corrupt legitimate prose.
 */
function unmaskName(text: string, name: string, placeholder: string): string {
  if (!text || !name || name.trim().length === 0) {
    return text;
  }
  const trimmed = name.trim();
  const bare = bareWord(placeholder);
  // Proper token, tolerant of stray spaces/case: e.g. `[ name ]`.
  const tokenInner = escapeRegExp(bare);
  const tokenRegex = new RegExp(`\\[\\s*${tokenInner}\\s*\\]`, 'gi');
  let out = text.replace(tokenRegex, trimmed);
  if (bare.length > 0) {
    // Bracket-dropped leak — ALL-CAPS only, case-SENSITIVE.
    out = out.replace(new RegExp(`\\b${escapeRegExp(bare)}\\b`, 'g'), trimmed);
  }
  return out;
}

/** Recursively restore the name in place of the placeholder across an object. */
export function unmaskObjectPII<T>(
  obj: T,
  name: string,
  options?: PiiMaskOptions
): T {
  const placeholder = options?.placeholder ?? DEFAULT_PLACEHOLDER;
  if (typeof obj === 'string') {
    return unmaskName(obj, name, placeholder) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item =>
      unmaskObjectPII(item, name, options)
    ) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      result[key] = unmaskObjectPII(record[key], name, options);
    }
    return result as unknown as T;
  }
  return obj;
}

/**
 * Stateful carry-buffer that unmasks the placeholder across streamed chunks
 * without ever emitting a split placeholder (e.g. `[NA` then `ME]`).
 *
 * KNOWN GAP: unlike the non-streamed path, this does NOT restore a
 * bracket-dropped bare-word leak — that needs a word-boundary check on the next
 * chunk, a riskier carry strategy judged not worth it for streams. Accepted.
 */
export interface UnmaskBuffer {
  /** Feed a chunk; returns the safely-unmaskable prefix, holding back a partial placeholder. */
  push(chunk: string): string;
  /** Emit and reset whatever remains in the carry. */
  flush(): string;
}

/** Longest suffix of `text` that is also a case-insensitive prefix of `placeholder`. */
function partialPlaceholderTail(text: string, placeholder: string): number {
  const max = Math.min(placeholder.length - 1, text.length);
  const lowerText = text.toLowerCase();
  const lowerPlaceholder = placeholder.toLowerCase();
  for (let k = max; k > 0; k--) {
    if (lowerText.endsWith(lowerPlaceholder.slice(0, k))) {
      return k;
    }
  }
  return 0;
}

/** Create a streaming-safe unmask buffer for a single name. */
export function createUnmaskBuffer(
  name: string,
  options?: PiiMaskOptions
): UnmaskBuffer {
  const placeholder = options?.placeholder ?? DEFAULT_PLACEHOLDER;
  const trimmed = name?.trim() ?? '';
  let carry = '';

  if (trimmed.length === 0) {
    return {
      push: (chunk: string) => chunk ?? '',
      flush: () => '',
    };
  }

  const placeholderRegex = new RegExp(escapeRegExp(placeholder), 'gi');

  return {
    push(chunk: string): string {
      const combined = carry + (chunk ?? '');
      const holdback = partialPlaceholderTail(combined, placeholder);
      const emittable = combined.slice(0, combined.length - holdback);
      carry = combined.slice(combined.length - holdback);
      return emittable.replace(placeholderRegex, trimmed);
    },
    flush(): string {
      const remaining = carry.replace(placeholderRegex, trimmed);
      carry = '';
      return remaining;
    },
  };
}

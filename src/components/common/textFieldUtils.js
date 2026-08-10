// ── General free-text input edge cases ────────────────────────────────────
//
// Applied on every keystroke, so it must never fight normal typing (no
// trimming here — a user typing "John Doe" needs to be able to type the
// space between the words without it vanishing). Trimming stays the job of
// the Zod schema at submit time (see src/lib/schemas/patientFormSchema.js).
//
// What this DOES strip live:
//  - HTML/script tags — defense in depth in case this value is ever rendered
//    with dangerouslySetInnerHTML or dropped into a generated PDF/print view
//    downstream, neither of which React's default JSX escaping protects against.
//  - Zero-width / invisible characters that paste in from Word or PDFs and
//    silently corrupt "identical-looking" values (e.g. two MRNs that look the
//    same but don't string-match).
//  - Newlines and tabs — a paste from a multi-line source into a single-line
//    field would otherwise carry them through invisibly.

const HTML_TAG = /<[^>]*>/g
// Zero-width space (200B), zero-width non-joiner/joiner (200C/200D), left-to-
// right/right-to-left marks (200E/200F), word joiner (2060), and BOM (FEFF).
const ZERO_WIDTH_AND_INVISIBLE = new RegExp('[\\u200B-\\u200F\\u2060\\uFEFF]', 'g')
const NEWLINES_AND_TABS = /[\r\n\t]+/g

/** Sanitizes a single-line free-text field value as the user types/pastes. */
export function sanitizeTextInput(raw) {
  return String(raw ?? '')
    .replace(HTML_TAG, '')
    .replace(ZERO_WIDTH_AND_INVISIBLE, '')
    .replace(NEWLINES_AND_TABS, ' ')
}

/** Same cleanup, but newlines are kept — for multi-line fields (e.g. Notes). */
export function sanitizeMultilineInput(raw) {
  return String(raw ?? '')
    .replace(HTML_TAG, '')
    .replace(ZERO_WIDTH_AND_INVISIBLE, '')
}

// Letters (any script — Müller, Siddharth, 中文 all pass via \p{L}), spaces,
// and the punctuation real names actually use (O'Brien, Anne-Marie, Dr.).
// Digits and other symbols never make it into the value — nothing to trim
// later, unlike sanitizeTextInput above.
export const NAME_PATTERN = /^[\p{L}\s'.-]*$/u
const NOT_NAME_CHARS = /[^\p{L}\s'.-]/gu

/** Sanitizes a name-type field (person/place name) — letters and spaces only, live. */
export function sanitizeNameInput(raw) {
  return String(raw ?? '').replace(NOT_NAME_CHARS, '')
}

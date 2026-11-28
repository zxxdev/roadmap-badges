/**
 * Text that goes into a badge: cleaned, measured and escaped. The text comes
 * from the catalog (area titles, the project's name), so it is not trusted.
 */
import { ADVANCES, FIRST_CODE_POINT, FONT } from "./font.js";

/** The badges' font size, in pixels. */
export const FONT_SIZE = 11;

/**
 * Width in pixels of the text at the given size, from the widths of DejaVu
 * Sans (src/badges/font.ts). A character the table does not have counts as
 * one em, the width of a wide letter, so the box is too wide rather than too
 * narrow; the SVG fits the text to the box with textLength.
 */
export function textWidth(text: string, size = FONT_SIZE): number {
  let units = 0;
  for (const char of text) {
    const advance = ADVANCES[(char.codePointAt(0) ?? 0) - FIRST_CODE_POINT];
    units += advance === undefined || advance === 0 ? FONT.unitsPerEm : advance;
  }
  return (units * size) / FONT.unitsPerEm;
}

/**
 * Characters that XML 1.0 forbids or that draw nothing: C0 and C1 control
 * characters (but not tab, line breaks and the like, U+0009 to U+000D, which
 * become spaces), lone surrogates (half of an emoji cut in two), the two
 * non-characters U+FFFE and U+FFFF, and invisible formatting characters:
 * zero-width spaces and joiners, direction marks and overrides (U+202E would
 * draw the text backwards, so a title could pass for another), and U+FEFF.
 * With the "u" flag the text is read by code points, so a surrogate range only
 * matches a lone half: a whole emoji is one code point outside it.
 */
const UNSAFE =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u{0}-\u{8}\u{E}-\u{1F}\u{7F}-\u{9F}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}\u{D800}-\u{DFFF}\u{FFFE}\u{FFFF}]/gu;

/**
 * Text ready for a badge: on one line, without characters that would make the
 * SVG invalid, and at most `max` characters, ending in "…" when it was cut,
 * after a whole word if a space is close enough to the cut.
 * Characters are counted as code points, so an emoji is never cut in half.
 */
export function cleanText(text: string, max: number): string {
  // Removed first, so "a \u{1} b" ends with one space between the words, not two.
  const line = text.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  let cut = chars.slice(0, max - 1).join("");
  // End at a whole word when there is a space near the cut: "too long to…", not "to fi…".
  const space = cut.lastIndexOf(" ");
  if (space > 0 && space >= cut.length - WORD_CUT) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/** How far back from the cut a space may be to end the text there instead. */
const WORD_CUT = 10;

/** Text escaped for XML, both between tags and inside attribute values. */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

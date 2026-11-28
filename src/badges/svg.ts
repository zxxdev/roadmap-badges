/**
 * Draws a badge as SVG text, by hand: two boxes side by side, a label on a
 * grey one and a message on a coloured one. No drawing library, so the only
 * hard parts are measuring the text and escaping it.
 */
import { HEX_COLOR } from "../catalog/schema.js";
import { LABEL_COLOR, textColorFor } from "./color.js";
import { cleanText, escapeXml, FONT_SIZE, textWidth } from "./text.js";

export interface Badge {
  /** Left part, such as an area's title. */
  label: string;
  /** Right part, such as "75%". */
  message: string;
  /** Background of the message, "#rgb" or "#rrggbb". */
  color: string;
  /** What a screen reader says, and the tooltip: the whole meaning in words. */
  title: string;
}

/** Longest label, in characters; longer ones end in "…". */
export const MAX_LABEL = 40;

const HEIGHT = 20;
/** Space between the text and the edge of its box, on each side. */
const PADDING = 6;
const RADIUS = 3;
/** Where the text sits: the baseline of an 11 px font, centred in 20 px. */
const BASELINE = 14;
/** Verdana first, as most badges use; the widths come from DejaVu Sans, its common stand-in. */
const FONT_FAMILY = "Verdana,DejaVu Sans,sans-serif";

/**
 * The badge as an SVG document. Every piece of text is cleaned and escaped,
 * and the colour is checked, so nothing from the catalog can add markup.
 *
 * Each text has a textLength: the width measured here. Viewers draw it in
 * whatever font they have and stretch or squeeze the spacing to that width,
 * so the text never spills out of its box.
 */
export function renderBadge(badge: Badge): string {
  const label = cleanText(badge.label, MAX_LABEL) || "progress";
  const message = cleanText(badge.message, MAX_LABEL);
  const title = escapeXml(cleanText(badge.title, 200));
  const color = checkedColor(badge.color);

  const labelText = textWidth(label);
  const messageText = textWidth(message);
  const labelWidth = Math.round(labelText) + 2 * PADDING;
  const messageWidth = Math.round(messageText) + 2 * PADDING;
  const width = labelWidth + messageWidth;

  const text = (content: string, x: number, length: number, fill: string) =>
    `    <text x="${num(x)}" y="${String(BASELINE)}" fill="${fill}" textLength="${num(length)}">` +
    `${escapeXml(content)}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(HEIGHT)}" ` +
      `viewBox="0 0 ${String(width)} ${String(HEIGHT)}" role="img" aria-label="${title}">`,
    `  <title>${title}</title>`,
    // The message's box, starting just under the label's right edge; then the
    // label's box, with a square strip so the join between them is straight. The
    // message's box does not reach the left corners, so its anti-aliased edge
    // cannot tint them.
    `  <rect x="${String(labelWidth - RADIUS)}" width="${String(messageWidth + RADIUS)}" height="${String(HEIGHT)}" rx="${String(RADIUS)}" fill="${color}"/>`,
    `  <rect width="${String(labelWidth)}" height="${String(HEIGHT)}" rx="${String(RADIUS)}" fill="${LABEL_COLOR}"/>`,
    `  <rect x="${String(labelWidth - RADIUS)}" width="${String(RADIUS)}" height="${String(HEIGHT)}" fill="${LABEL_COLOR}"/>`,
    `  <g font-family="${FONT_FAMILY}" font-size="${String(FONT_SIZE)}" text-anchor="middle">`,
    text(label, labelWidth / 2, labelText, textColorFor(LABEL_COLOR)),
    text(message, labelWidth + messageWidth / 2, messageText, textColorFor(color)),
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

/** The colour, if it is "#rgb" or "#rrggbb"; it goes into an attribute as it is. */
function checkedColor(color: string): string {
  if (!HEX_COLOR.test(color)) {
    throw new Error(`roadmap-badges: not a colour: ${JSON.stringify(color)}`);
  }
  return color.toLowerCase();
}

/** A coordinate with at most one decimal: "57" or "57.3". */
function num(value: number): string {
  return String(Math.round(value * 10) / 10);
}

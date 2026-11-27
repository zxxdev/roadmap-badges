/**
 * The badges' colours: which background a percentage gets, and which text
 * colour reads best on it. Contrast follows WCAG 2.2, the same formula that
 * browsers' accessibility tools use.
 */
import type { Threshold } from "../catalog/schema.js";

/**
 * The default steps, lowest first. Each colour has a contrast of at least
 * 4.5:1 with white text (WCAG AA for normal text); tests/badges.test.ts checks
 * it. They are the "danger", "severe", "attention" and "success" colours of
 * GitHub's own interface, so they look at home in both its themes.
 */
export const DEFAULT_THRESHOLDS: readonly Threshold[] = [
  { from: 0, color: "#cf222e" },
  { from: 50, color: "#bc4c00" },
  { from: 80, color: "#9a6700" },
  { from: 100, color: "#1a7f37" },
];

/** The left part of every badge, with its label. */
export const LABEL_COLOR = "#555555";

/** An area with nothing to count: no percentage, so no colour from the thresholds. */
export const NO_ITEMS_COLOR = "#9ea7b3";

/** The two text colours a badge can use. */
export const LIGHT_TEXT = "#ffffff";
export const DARK_TEXT = "#1f2328";

/** The background for a percentage: the last threshold that it reaches. */
export function colorFor(percent: number | null, thresholds: readonly Threshold[]): string {
  if (percent === null) return NO_ITEMS_COLOR;
  let color = thresholds[0]?.color ?? NO_ITEMS_COLOR;
  for (const step of thresholds) {
    if (percent >= step.from) color = step.color;
  }
  return color;
}

/**
 * White or near-black, whichever has more contrast with the background. So a
 * light colour in the catalog's thresholds still gets readable text.
 */
export function textColorFor(background: string): string {
  return contrastRatio(LIGHT_TEXT, background) >= contrastRatio(DARK_TEXT, background)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

/** WCAG contrast ratio between two colours, from 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG relative luminance: how bright a colour looks, from 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** "#rgb" or "#rrggbb" as three numbers from 0 to 255. */
export function rgb(color: string): [number, number, number] {
  const hex = color.replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${color}`);
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

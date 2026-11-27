/**
 * Which badges a run writes: one per area and one for the whole catalog,
 * from the evaluation. A pure function, like evaluate(): the files are written
 * by main.ts through the runner.
 */
import type { Catalog } from "../catalog/schema.js";
import type { Evaluation, Progress } from "../evidence/evaluate.js";
import { colorFor, DEFAULT_THRESHOLDS } from "./color.js";
import { renderBadge } from "./svg.js";

export interface BadgeFile {
  /** File name inside the output folder: "badge.svg" or "badge-<area id>.svg". */
  name: string;
  svg: string;
}

/** The overall badge's label. */
export const OVERALL_LABEL = "progress";

/**
 * The overall badge first, then one per area in catalog order. Area ids are
 * lowercase letters, digits, dots and hyphens (the catalog checks it), so the
 * file names are safe: no "/", no "..".
 */
export function buildBadges(catalog: Catalog, result: Evaluation): BadgeFile[] {
  const thresholds = catalog.badges?.thresholds ?? DEFAULT_THRESHOLDS;
  const draw = (label: string, subject: string, progress: Progress) =>
    renderBadge({
      label,
      message: progress.percent === null ? "no items" : `${String(progress.percent)}%`,
      color: colorFor(progress.percent, thresholds),
      title: `${subject}: ${describe(progress)}`,
    });

  return [
    { name: "badge.svg", svg: draw(OVERALL_LABEL, `${catalog.project} progress`, result) },
    ...result.areas.map((area) => ({
      name: `badge-${area.id}.svg`,
      svg: draw(area.title, area.title, area),
    })),
  ];
}

/** "75% (3 of 4 items done)", or "no items to count". */
function describe({ done, total, percent }: Progress): string {
  if (percent === null) return "no items to count";
  return `${String(percent)}% (${String(done)} of ${String(total)} ${total === 1 ? "item" : "items"} done)`;
}

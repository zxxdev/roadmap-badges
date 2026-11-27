import sax from "sax";
import { describe, expect, it } from "vitest";
import { buildBadges } from "../src/badges/build.js";
import {
  colorFor,
  contrastRatio,
  DARK_TEXT,
  DEFAULT_THRESHOLDS,
  LABEL_COLOR,
  LIGHT_TEXT,
  NO_ITEMS_COLOR,
  rgb,
  textColorFor,
} from "../src/badges/color.js";
import { ADVANCES, FIRST_CODE_POINT, FONT } from "../src/badges/font.js";
import { MAX_LABEL, renderBadge, type Badge } from "../src/badges/svg.js";
import { cleanText, escapeXml, FONT_SIZE, textWidth } from "../src/badges/text.js";
import type { Catalog } from "../src/catalog/schema.js";
import { evaluate } from "../src/evidence/evaluate.js";

/** Width in pixels of one character, straight from the font table. */
const px = (char: string) =>
  ((ADVANCES[(char.codePointAt(0) ?? 0) - FIRST_CODE_POINT] ?? 0) * FONT_SIZE) / FONT.unitsPerEm;

/** Throws if the text is not well-formed XML, using the same strict parser as the JUnit reader. */
function parseXml(text: string): {
  tags: string[];
  texts: string[];
  attributes: Record<string, string>[];
} {
  const parser = sax.parser(true);
  const found = {
    tags: [] as string[],
    texts: [] as string[],
    attributes: [] as Record<string, string>[],
  };
  parser.onerror = (error) => {
    throw error;
  };
  parser.onopentag = (tag) => {
    found.tags.push(tag.name);
    found.attributes.push(tag.attributes as Record<string, string>);
  };
  parser.ontext = (text) => {
    if (text.trim() !== "") found.texts.push(text);
  };
  parser.write(text).close();
  return found;
}

/** A number attribute of the n-th element with that tag. */
function attribute(svg: string, tag: string, name: string, nth = 0): number {
  const { tags, attributes } = parseXml(svg);
  const indexes = tags.flatMap((t, i) => (t === tag ? [i] : []));
  return Number(attributes[indexes[nth] ?? -1]?.[name]);
}

describe("textWidth @outputs.badges", () => {
  it("adds up the advance widths of DejaVu Sans at 11 px", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("m")).toBeCloseTo((1995 * 11) / 2048, 10);
    expect(textWidth("100%")).toBeCloseTo(px("1") + 2 * px("0") + px("%"), 10);
    expect(textWidth("W")).toBeGreaterThan(textWidth("i"));
  });

  it("scales with the font size", () => {
    expect(textWidth("Catalog", 22)).toBeCloseTo(2 * textWidth("Catalog"), 10);
  });

  it("has widths for Spanish and other Latin letters", () => {
    for (const char of "áéíóúñüÁÉÍÓÚÑÜçßøłő") {
      expect(px(char), char).toBeGreaterThan(0);
    }
  });

  it("counts a character outside the table as one em, so its box is never too narrow", () => {
    expect(textWidth("漢")).toBe(FONT_SIZE);
    expect(textWidth("€")).toBe(FONT_SIZE);
    // An emoji is one code point but two UTF-16 units: it counts once.
    expect(textWidth("🚀")).toBe(FONT_SIZE);
  });
});

describe("cleanText @outputs.badges", () => {
  it("puts the text on one line", () => {
    expect(cleanText("  API\tand\n\r\nUI  ", 40)).toBe("API and UI");
  });

  it("removes characters that XML forbids or that draw nothing", () => {
    expect(cleanText("a\u{0}b\u{7}c\u{1b}d\u{7f}e\u{85}f\u{FFFE}g\u{FFFF}h", 40)).toBe("abcdefgh");
  });

  it("removes half of a cut emoji but keeps a whole one", () => {
    expect(cleanText("x\uD83Dy\uDE80z", 40)).toBe("xyz");
    expect(cleanText("go 🚀", 40)).toBe("go 🚀");
  });

  it("cuts long text with an ellipsis, by characters, never inside an emoji", () => {
    expect(cleanText("abcdefghij", 10)).toBe("abcdefghij");
    expect(cleanText("abcdefghijk", 10)).toBe("abcdefghi…");
    expect(cleanText("abcd efghijk", 6)).toBe("abcd…");
    expect(cleanText("🚀🚀🚀🚀", 3)).toBe("🚀🚀…");
  });

  it("ends a cut text after a whole word when a space is near the cut", () => {
    expect(cleanText("Monitoring and alerting", 20)).toBe("Monitoring and…");
    // The only space is far from the cut: cutting there would lose most of the text.
    expect(cleanText("a bcdefghijklmnopqrstu", 20)).toBe("a bcdefghijklmnopqr…");
  });
});

describe("escapeXml @outputs.badges", () => {
  it("escapes the five characters that mean something in XML", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
  });
});

describe("badge colours @outputs.badges", () => {
  it("start at 0 and go up", () => {
    expect(DEFAULT_THRESHOLDS[0]?.from).toBe(0);
    const froms = DEFAULT_THRESHOLDS.map((step) => step.from);
    expect(froms).toEqual(froms.toSorted((a, b) => a - b));
    expect(new Set(froms).size).toBe(froms.length);
  });

  it("give every default colour and the label at least 4.5:1 contrast with its text (WCAG AA)", () => {
    for (const color of [...DEFAULT_THRESHOLDS.map((step) => step.color), LABEL_COLOR]) {
      expect(textColorFor(color), color).toBe(LIGHT_TEXT);
      expect(contrastRatio(LIGHT_TEXT, color), color).toBeGreaterThanOrEqual(4.5);
    }
    expect(textColorFor(NO_ITEMS_COLOR)).toBe(DARK_TEXT);
    expect(contrastRatio(DARK_TEXT, NO_ITEMS_COLOR)).toBeGreaterThanOrEqual(4.5);
  });

  it("pick the last threshold a percentage reaches", () => {
    const picks = [0, 49, 50, 79, 80, 99, 100].map((percent) =>
      colorFor(percent, DEFAULT_THRESHOLDS),
    );
    expect(picks).toEqual([
      "#cf222e",
      "#cf222e",
      "#bc4c00",
      "#bc4c00",
      "#9a6700",
      "#9a6700",
      "#1a7f37",
    ]);
  });

  it("use grey when there is nothing to count, whatever the thresholds", () => {
    expect(colorFor(null, DEFAULT_THRESHOLDS)).toBe(NO_ITEMS_COLOR);
    expect(colorFor(null, [{ from: 0, color: "#000" }])).toBe(NO_ITEMS_COLOR);
  });

  it("follow the catalog's own thresholds", () => {
    const thresholds = [
      { from: 0, color: "#111" },
      { from: 90, color: "#222" },
    ];
    expect(colorFor(89, thresholds)).toBe("#111");
    expect(colorFor(90, thresholds)).toBe("#222");
  });

  it("choose dark text on a light background", () => {
    expect(textColorFor("#ffff00")).toBe(DARK_TEXT);
    expect(textColorFor("#fff")).toBe(DARK_TEXT);
    expect(textColorFor("#000")).toBe(LIGHT_TEXT);
  });

  it("compute contrast with the WCAG formula", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
    expect(contrastRatio("#777", "#777")).toBe(1);
    // A well-known value: #767676 is the lightest grey with 4.5:1 on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(rgb("#abc")).toEqual([170, 187, 204]);
    expect(() => rgb("#ab")).toThrow("not a hex colour");
  });
});

/** The examples in the README: one badge per default colour, and "no items". */
const EXAMPLES: [file: string, message: string, percent: number | null][] = [
  ["progress-0", "0%", 0],
  ["progress-50", "50%", 50],
  ["progress-80", "80%", 80],
  ["progress-100", "100%", 100],
  ["progress-no-items", "no items", null],
];

describe("renderBadge @outputs.badges", () => {
  // The snapshots are the files in docs/images/badges, which the README shows:
  // run `pnpm test -u` after changing how badges are drawn, and look at them
  // before committing. In CI the files are only compared, never written.
  it.each(EXAMPLES)("draws %s as in the README", async (file, message, percent) => {
    const svg = renderBadge({
      label: "progress",
      message,
      color: colorFor(percent, DEFAULT_THRESHOLDS),
      title: `Example: ${message}`,
    });
    await expect(svg).toMatchFileSnapshot(`../docs/images/badges/${file}.svg`);
  });

  it("is a well-formed SVG with its meaning in words for screen readers", () => {
    const svg = renderBadge({ label: "API", message: "75%", color: "#9a6700", title: "API: 75%" });
    const { tags, texts, attributes } = parseXml(svg);
    expect(tags[0]).toBe("svg");
    expect(attributes[0]).toMatchObject({ role: "img", "aria-label": "API: 75%" });
    expect(tags[1]).toBe("title");
    expect(texts).toEqual(["API: 75%", "API", "75%"]);
  });

  it("sizes each box to its text, with the same padding on both sides", () => {
    const svg = renderBadge({ label: "API", message: "100%", color: "#1a7f37", title: "t" });
    const labelWidth = Math.round(textWidth("API")) + 12;
    const messageWidth = Math.round(textWidth("100%")) + 12;
    expect(attribute(svg, "svg", "width")).toBe(labelWidth + messageWidth);
    // The message's box ends at the right edge and starts under the label's corner.
    expect(attribute(svg, "rect", "x", 0) + attribute(svg, "rect", "width", 0)).toBe(
      labelWidth + messageWidth,
    );
    expect(attribute(svg, "rect", "x", 0)).toBe(labelWidth - 3);
    expect(attribute(svg, "rect", "width", 1)).toBe(labelWidth);
    expect(attribute(svg, "text", "x", 0)).toBe(labelWidth / 2);
    expect(attribute(svg, "text", "x", 1)).toBe(labelWidth + messageWidth / 2);
    expect(attribute(svg, "text", "textLength", 1)).toBeCloseTo(textWidth("100%"), 1);
  });

  it("uses dark text on a light colour from the catalog", () => {
    const svg = renderBadge({ label: "a", message: "b", color: "#FFEE88", title: "t" });
    const { attributes, tags } = parseXml(svg);
    const texts = tags.flatMap((tag, i) => (tag === "text" ? [attributes[i]] : []));
    expect(texts.map((text) => text?.fill)).toEqual([LIGHT_TEXT, DARK_TEXT]);
    expect(svg).toContain('fill="#ffee88"');
  });

  const hostile: Badge = {
    label: `<script>alert("x")</script> & 'co'\u0000\u001b]`,
    message: `50%"/><image href="x"/>`,
    color: "#bc4c00",
    title: `</title><script>1</script>\nnext line`,
  };

  it("escapes text from the catalog so it cannot add markup", async () => {
    const svg = renderBadge(hostile);
    const { tags, texts } = parseXml(svg);
    expect(tags).toEqual(["svg", "title", "rect", "rect", "rect", "g", "text", "text"]);
    expect(texts).toEqual([
      "</title><script>1</script> next line",
      `<script>alert("x")</script> & 'co']`,
      `50%"/><image href="x"/>`,
    ]);
    await expect(svg).toMatchFileSnapshot("./__snapshots__/badges/escaped.svg");
  });

  it("refuses a colour that is not #rgb or #rrggbb, because it goes into an attribute as it is", () => {
    for (const color of ["red", '#fff" onload="x', "#ffff", "url(#x)", ""]) {
      expect(() => renderBadge({ ...hostile, color }), color).toThrow("not a colour");
    }
  });

  it("cuts a long label with an ellipsis and never leaves it empty", async () => {
    const long = renderBadge({
      label: "An area with a title far too long to fit on any badge",
      message: "33%",
      color: "#cf222e",
      title: "t",
    });
    const label = parseXml(long).texts[1] ?? "";
    expect(Array.from(label).length).toBeLessThanOrEqual(MAX_LABEL);
    expect(label).toBe("An area with a title far too long to…");
    await expect(long).toMatchFileSnapshot("./__snapshots__/badges/long-label.svg");

    const empty = renderBadge({ label: "\u0000 \t", message: "1%", color: "#000", title: "t" });
    expect(parseXml(empty).texts[1]).toBe("progress");
  });
});

describe("buildBadges @outputs.badges", () => {
  const catalog: Catalog = {
    project: "demo & co",
    areas: [
      {
        id: "api",
        title: "API",
        items: [
          { id: "api.get", title: "Get", evidence: "manual", done: true },
          { id: "api.put", title: "Put", evidence: "manual", done: false },
        ],
      },
      { id: "docs.user-guide", title: "User guide", items: [] },
      {
        id: "ops",
        title: "Ops",
        items: [{ id: "ops.run", title: "Runbook", evidence: "manual", done: true }],
      },
    ],
  };

  it("draws the whole catalog, then each area in catalog order", () => {
    const badges = buildBadges(catalog, evaluate(catalog, []));
    expect(badges.map((badge) => badge.name)).toEqual([
      "badge.svg",
      "badge-api.svg",
      "badge-docs.user-guide.svg",
      "badge-ops.svg",
    ]);
    const [overall, api, docs, ops] = badges.map((badge) => parseXml(badge.svg));
    expect(overall?.texts).toEqual([
      "demo & co progress: 66% (2 of 3 items done)",
      "progress",
      "66%",
    ]);
    expect(api?.texts).toEqual(["API: 50% (1 of 2 items done)", "API", "50%"]);
    expect(docs?.texts).toEqual(["User guide: no items to count", "User guide", "no items"]);
    expect(ops?.texts).toEqual(["Ops: 100% (1 of 1 item done)", "Ops", "100%"]);
    expect(badges[2]?.svg).toContain(`fill="${NO_ITEMS_COLOR}"`);
    expect(badges[3]?.svg).toContain('fill="#1a7f37"');
  });

  it("uses the catalog's thresholds when it has them", () => {
    const own: Catalog = {
      ...catalog,
      badges: {
        thresholds: [
          { from: 0, color: "#123456" },
          { from: 60, color: "#abcdef" },
        ],
      },
    };
    const [overall, api, , ops] = buildBadges(own, evaluate(own, []));
    expect(overall?.svg).toContain('fill="#abcdef"');
    expect(api?.svg).toContain('fill="#123456"');
    expect(ops?.svg).toContain('fill="#abcdef"');
  });
});

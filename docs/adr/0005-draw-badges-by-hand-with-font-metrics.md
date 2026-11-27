# 0005. Draw the badges by hand, sized with widths read from a font file

- **Status:** accepted
- **Date:** 2026-11-28

## Context

The action draws one SVG badge per area and one for the whole catalog. A badge is two boxes with
a short text in each, and each box must be as wide as its text. A GitHub Action has no browser,
so the text cannot be measured by drawing it. The text comes from the catalog, written by
whoever owns the repository, so it is not trusted: it must not be able to add markup to the SVG.

The colours should be readable by everyone, in GitHub's light and dark themes, and a project
should be able to choose its own.

## Options

1. **A badge library** (`badge-maker`, the one behind shields.io). It measures text with a
   width table and draws the classic style. It brings its own dependencies into the bundle that
   every user runs, and its colours were not chosen for contrast: white text on its yellow is
   about 2:1.
2. **Measure with a guess**, such as 7 px per character. No table, but a title with many
   narrow or wide letters ("illi", "WWW") ends up far from its box.
3. **Draw the SVG by hand, with a width table generated from a real font file.** A script
   reads the advance width of every character from the font's own tables, and a small function
   adds them up. The SVG gives each text a `textLength`, so whatever font a viewer
   has, the text is fitted to the measured width.

## Decision

Option 3, with these choices:

- **Widths from DejaVu Sans 2.37**, the font Ubuntu ships and a common stand-in for Verdana.
  `scripts/font-widths.ts` reads the `head`, `cmap`, `hhea`, `hmtx` and `name` tables of the
  TrueType file and writes `src/badges/font.ts`, with the font's version and the file's SHA-256.
  It covers U+0020 to U+017F (ASCII, Latin-1 and Latin Extended-A). Any other character counts
  as one em, so its box is too wide rather than too narrow. Kerning is left out.
- **Every piece of text is cleaned and escaped**: whitespace becomes one space, characters that
  XML forbids (control characters, lone surrogates, U+FFFE, U+FFFF) are removed, labels longer
  than 40 characters end in "…", and `& < > " '` are escaped. Colours are only `#rgb` or
  `#rrggbb`, checked both in the catalog and when drawing, because they go into an attribute.
- **Accessible**: `role="img"`, an `aria-label` and a `<title>` that say the whole meaning in
  words, such as "API: 75% (3 of 4 items done)".
- **Colours by thresholds**, configurable in `progress.yml` under `badges.thresholds`. The
  defaults are GitHub's own red, orange, yellow and green, each with at least 4.5:1 contrast with
  white text (WCAG AA), checked by a test. The text colour, white or near-black, is chosen by
  contrast, so a light colour from a catalog still gets readable text.
- **Snapshot tests** compare each badge with a committed file. The examples in the README are
  those files, so the README always shows what the code draws.

## Consequences

- No new dependency, and the whole badge is about 60 lines that can be read in one go.
- The widths are DejaVu Sans's. A viewer with Verdana or another font sees its own letters
  squeezed or spaced to the same width; with `textLength` the difference stays inside the box.
- Characters outside the table (CJK, emoji, accents written as separate combining marks) make
  the box wider than needed. Acceptable for titles, which are short; the table can grow by
  changing the range in the script.
- Regenerating the table needs the font file, which CI does not have: `pnpm font-widths` runs in
  the development machine, and the generated file says which font file it came from.
- A snapshot can be updated without looking at it (`pnpm test -u`). The README examples make a
  change visible in review, but the reviewer still has to look.

// Bundles src/index.ts and its dependencies into the single file GitHub runs:
// dist/index.js. GitHub does not install dependencies for an action, so the
// bundle is committed, and CI checks that it matches the source.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

/**
 * Writes dist/licenses.txt with the licence of every package bundled into
 * dist/index.js. Their licences (MIT, ISC, Blue Oak) ask that every copy keeps
 * the notice, and the bundle is a copy. Sorted by name and with LF line
 * endings, so every build writes the same file.
 */
function thirdPartyLicences() {
  return {
    name: "third-party-licences",
    generateBundle(_options, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          const dir = packageDir(id);
          if (dir !== undefined && !packages.has(dir)) packages.set(dir, readPackage(dir));
        }
      }
      const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
      const sections = sorted.map(({ name, version, license, text }) => {
        const title = `${name} ${version} (${license})`;
        return `${title}\n${"-".repeat(title.length)}\n\n${text.trim()}\n`;
      });
      const heading = "Third-party software bundled in dist/index.js";
      this.emitFile({
        type: "asset",
        fileName: "licenses.txt",
        source: `${heading}\n${"=".repeat(heading.length)}\n\n${sections.join("\n")}`,
      });
    },
  };
}

/** The folder of the npm package a module comes from, or undefined for our own code. */
function packageDir(id) {
  const path = id.replace(/^\0/, "").split("?")[0].replaceAll("\\", "/");
  const marker = "/node_modules/";
  const at = path.lastIndexOf(marker);
  if (at === -1) return undefined;
  const parts = path.slice(at + marker.length).split("/");
  const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return path.slice(0, at + marker.length) + name;
}

function readPackage(dir) {
  const { name, version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry));
  const text =
    file === undefined
      ? `The package has no licence file. Its package.json gives the licence as ${license}.`
      : readFileSync(join(dir, file), "utf8").replaceAll("\r\n", "\n");
  return { name, version, license, text };
}

export default {
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "es",
    sourcemap: false,
  },
  // Three warnings about code inside dependencies are expected and harmless:
  // compiled `this` at module level and a circular import between two files
  // (@actions/core and its helpers), and comments that mention `@__PURE__` in
  // their prose, which Rollup drops (zod). Anything else is still shown.
  onwarn(warning, warn) {
    const inDependency = (warning.id ?? warning.ids?.[0] ?? "").includes("node_modules");
    const expected = ["THIS_IS_UNDEFINED", "CIRCULAR_DEPENDENCY", "INVALID_ANNOTATION"];
    if (inDependency && expected.includes(warning.code ?? "")) {
      return;
    }
    warn(warning);
  },
  plugins: [
    typescript({ tsconfig: "./tsconfig.build.json" }),
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    thirdPartyLicences(),
  ],
};

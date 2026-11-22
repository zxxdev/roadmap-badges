// Bundles src/index.ts and its dependencies into the single file GitHub runs:
// dist/index.js. GitHub does not install dependencies for an action, so the
// bundle is committed, and CI checks that it matches the source.
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "es",
    sourcemap: false,
  },
  // Two warnings about code inside dependencies (@actions/core and its helpers)
  // are expected and harmless: compiled `this` at module level, and a circular
  // import between two of its files. Anything else is still shown.
  onwarn(warning, warn) {
    const inDependency = (warning.id ?? warning.ids?.[0] ?? "").includes("node_modules");
    if (
      inDependency &&
      (warning.code === "THIS_IS_UNDEFINED" || warning.code === "CIRCULAR_DEPENDENCY")
    ) {
      return;
    }
    warn(warning);
  },
  plugins: [
    typescript({ tsconfig: "./tsconfig.build.json" }),
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
  ],
};

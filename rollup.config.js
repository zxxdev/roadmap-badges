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
  ],
};

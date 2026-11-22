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
  plugins: [
    typescript({ tsconfig: "./tsconfig.build.json" }),
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
  ],
};

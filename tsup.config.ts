import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/web-server.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: false,
  banner: { js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` }
});

import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [svelte(), viteSingleFile({ useRecommendedBuildConfig: false })],
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    // codeSplitting is not yet in vite's type definitions but exists at runtime in v8+
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codeSplitting: false,
  } as any,
});
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // opusscript's Emscripten loader reads opusscript_native_wasm.wasm from disk
  // relative to __dirname at runtime. Bundling it would break that path, and
  // the default trace does not carry the .wasm — so keep the package external
  // and include its build directory in every capture function's bundle.
  serverExternalPackages: ["opusscript"],
  outputFileTracingIncludes: {
    "/api/capture/*": ["./node_modules/opusscript/build/**/*"],
    "/api/capture/**": ["./node_modules/opusscript/build/**/*"],
  },
  async headers() {
    return [
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
        ],
      },
    ];
  },
};

export default nextConfig;

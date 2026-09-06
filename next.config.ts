import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // opusscript's Emscripten loader reads opusscript_native_wasm.wasm from disk
  // relative to __dirname at runtime. Bundling it would break that path, and
  // the default trace does not carry the .wasm — so keep the package external
  // and include its build directory in every capture function's bundle.
  //
  // The speaker-identification model has the same shape of problem:
  // @huggingface/transformers binds to the native onnxruntime-node addon,
  // which dlopen()s its platform binary from bin/napi-v6/<platform>/<arch>/
  // at runtime. The build-time file tracer cannot see that dynamic
  // resolution, so without these entries the model load fails on Vercel —
  // and it fails quietly, leaving every conversation unlabeled (see the
  // per-cluster catch in pipeline.ts's identifySpeakers).
  //
  // Pinned to linux/x64 deliberately: the package ships five prebuilt
  // platforms totalling 210 MB, and a `bin/**/*` glob drags all of them into
  // every capture function, which alone exceeds Vercel's 250 MB unzipped
  // limit and fails the deploy. Only linux/x64 (34 MB) is reachable there.
  // The route scope stays broad because four of these five routes really do
  // load the model: chunks, close and sweep all reach closeSession →
  // transcribeSession → identifySpeakers, not just enroll-voice.
  serverExternalPackages: ["opusscript", "@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/capture/*": [
      "./node_modules/opusscript/build/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/lib/**/*",
    ],
    "/api/capture/**": [
      "./node_modules/opusscript/build/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/lib/**/*",
    ],
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

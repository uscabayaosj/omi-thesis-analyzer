import { AutoModel, AutoProcessor, env } from "@huggingface/transformers";
import { capPcmForEmbedding } from "./clip";

/**
 * Loads the WavLM speaker-verification model once per Function instance and
 * embeds audio into a fixed-size vector.
 *
 * DEVIATION FROM PLAN (see the "Engine decision" and "Open risks" entries in
 * docs/superpowers/specs/2026-09-05-speaker-identification-design.md): the plan called
 * for `device: "wasm"` to force the pure-JS ONNX Runtime Web backend, on the
 * theory that this avoids the native onnxruntime-node binary. As installed
 * (@huggingface/transformers@4.2.0), that is not possible: the library
 * detects a real Node.js process (`apis.IS_NODE_ENV`) and, in that branch,
 * *always* binds to the native `onnxruntime-node` addon — "wasm" is not even
 * in the list of devices Node recognizes (only cpu/coreml/cuda/dml/webgpu,
 * all native-backed). This holds true from every entry point the package
 * exposes (transformers.node.mjs and transformers.web.js both contain the
 * same runtime check). So `device: "wasm"` throws immediately under Node
 * ("Unsupported device"). "cpu" is the closest equivalent Node offers, but it
 * still loads the native onnxruntime-node addon. The native-binary-on-Vercel
 * risk that leaves behind is handled at the packaging layer instead:
 * next.config.ts keeps @huggingface/transformers and onnxruntime-node
 * external and traces onnxruntime-node's bin/ (the platform .node/.dylib/.so
 * files, resolved dynamically and therefore invisible to the file tracer)
 * into the capture function bundles.
 *
 * env.cacheDir is pointed at /tmp. Vercel Functions only allow writes
 * under /tmp; the library's default cache dir ("./.cache") would try to
 * write into the read-only deployment bundle otherwise.
 */

env.cacheDir = "/tmp/transformers-cache";

const MODEL_ID = "Xenova/wavlm-base-plus-sv";

let modelPromise: ReturnType<typeof load> | null = null;

async function load() {
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, { device: "cpu" });
  return { processor, model };
}

/** pcm: 16kHz mono, normalized to [-1, 1] — see identify.ts's int16ToFloat32. */
export async function embedAudio(pcm: Float32Array): Promise<number[]> {
  if (!modelPromise) modelPromise = load();
  const { processor, model } = await modelPromise;
  // Bounded here rather than at each call site: the limit is a property of the
  // model, not of any one caller, and every caller had gotten it wrong. See
  // capPcmForEmbedding for why an unbounded input is not survivable.
  const inputs = await processor(capPcmForEmbedding(pcm));
  const { embeddings } = await model(inputs);
  return Array.from(embeddings.data as Float32Array);
}

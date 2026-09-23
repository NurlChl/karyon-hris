/**
 * Face analysis worker.
 *
 * Runs in a `worker_threads` thread, never on the Next.js request thread.
 * Detection plus embedding costs roughly 350–600 ms of pure CPU per photo on
 * the WASM backend; on the main thread that would freeze every other request
 * for the whole duration, and a few hundred people clocking in at 08:00 would
 * stall the entire application.
 *
 * Deliberately a plain `.mjs` file outside `src/`: it is started by path with
 * `new Worker()`, so it must not be bundled, and it loads the model weights
 * straight from `node_modules` — no network access at any point.
 *
 * Protocol
 *   in : { id, image: Uint8Array }                       (JPEG/PNG/WebP bytes)
 *   out: { id, ok: true, faces, score, descriptor, box, width, height, ms }
 *        { id, ok: false, error }
 */

import path from "node:path";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import sharp from "sharp";

const require = createRequire(import.meta.url);

// face-api and tfjs must come from one CommonJS graph. Importing tfjs as ESM
// alongside the CommonJS face-api build yields two separate tfjs engines: the
// backend gets registered on one and tensors are created on the other, and
// detection then silently finds nothing.
require("@tensorflow/tfjs-backend-wasm");
const faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
const tf = faceapi.tf;

/**
 * Detector confidence floor.
 *
 * Kept low on purpose. A real office webcam selfie in dim light scored 0.45 on
 * the stock detector — below the usual 0.5 default — so a strict floor turns
 * away genuine employees. Identity is decided by the recognition distance
 * afterwards; this only needs to find the face.
 */
const MIN_DETECTION_CONFIDENCE = 0.3;

/** Longest edge fed to the detector. Larger buys nothing but time. */
const MAX_EDGE = 800;

const ready = (async () => {
  await tf.setBackend("wasm");
  await tf.ready();
  tf.enableProdMode();

  const modelDir = path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
})();

async function analyse(image) {
  await ready;
  const started = performance.now();

  // `rotate()` applies EXIF orientation: phone cameras store portrait shots
  // sideways, and the detector does not find sideways faces.
  // `normalise()` stretches contrast. On the same dim selfie it lifted detector
  // confidence from 0.45 to 0.83 without moving the identity distance.
  const { data, info } = await sharp(Buffer.from(image), { failOn: "error" })
    .rotate()
    .normalise()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = tf.tensor3d(Int32Array.from(data), [info.height, info.width, 3], "int32");
  let results;
  try {
    results = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_DETECTION_CONFIDENCE }))
      .withFaceLandmarks()
      .withFaceDescriptors();
  } finally {
    tensor.dispose();
  }

  const best = results.sort((a, b) => b.detection.score - a.detection.score)[0];
  const box = best?.detection.box;

  return {
    faces: results.length,
    score: best ? best.detection.score : 0,
    descriptor: best ? Array.from(best.descriptor) : null,
    box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
    width: info.width,
    height: info.height,
    ms: Math.round(performance.now() - started),
  };
}

parentPort.on("message", async (msg) => {
  if (msg?.type === "warmup") {
    try {
      await ready;
      parentPort.postMessage({ id: msg.id, ok: true, warm: true });
    } catch (err) {
      parentPort.postMessage({ id: msg.id, ok: false, error: String(err?.message ?? err) });
    }
    return;
  }

  try {
    const result = await analyse(msg.image);
    parentPort.postMessage({ id: msg.id, ok: true, ...result });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String(err?.message ?? err) });
  }
});

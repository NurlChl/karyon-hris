import { Worker } from "node:worker_threads";
import path from "node:path";
import os from "node:os";

/**
 * Face analysis on a pool of worker threads.
 *
 * Inference is CPU-bound (~350–600 ms per photo) and runs in
 * `workers/face-worker.mjs`, off the request thread. This module only queues
 * work, spreads it across workers, and restarts a worker that dies.
 *
 * Throughput, measured on a 4-core laptop with the default two workers: 3.4
 * photos a second, about 200 clock-ins a minute, while the request thread's
 * worst stall stayed at 16 ms. The first call after start-up also pays about
 * 1.5 s to spawn workers and load the models. A thousand people clocking in
 * inside five minutes is at the edge of that; a server with more cores should
 * raise `FACE_WORKERS` — never above the core count, or workers just queue
 * behind each other for the same CPU.
 */

export interface FaceAnalysis {
  faces: number;
  score: number;
  descriptor: number[] | null;
  box: { x: number; y: number; width: number; height: number } | null;
  width: number;
  height: number;
  ms: number;
}

interface Job {
  id: number;
  image: Uint8Array;
  resolve: (r: FaceAnalysis) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

interface Slot {
  worker: Worker;
  busy: Job | null;
}

/** Waiting jobs beyond which callers are told to retry rather than pile up. */
const MAX_QUEUE = 200;
const JOB_TIMEOUT_MS = 20_000;

const WORKER_PATH = path.join(process.cwd(), "workers", "face-worker.mjs");

function workerCount(): number {
  const configured = Number(process.env.FACE_WORKERS);
  if (Number.isInteger(configured) && configured > 0) return configured;
  // Leave a core for Next.js and one for MongoDB's client work.
  return Math.max(1, Math.min(2, os.cpus().length - 2));
}

export class FaceBusyError extends Error {
  status = 503;
  code = "FACE_BUSY";
  name = "HttpError";
  constructor() {
    super("Server sedang memverifikasi banyak wajah sekaligus. Coba lagi dalam beberapa detik.");
  }
}

class FacePool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const worker = new Worker(WORKER_PATH);
    const slot: Slot = { worker, busy: null };

    worker.on("message", (msg: { id: number; ok: boolean; error?: string } & Partial<FaceAnalysis>) => {
      const job = slot.busy;
      if (!job || job.id !== msg.id) return;
      clearTimeout(job.timer);
      slot.busy = null;

      if (msg.ok) {
        job.resolve({
          faces: msg.faces ?? 0,
          score: msg.score ?? 0,
          descriptor: msg.descriptor ?? null,
          box: msg.box ?? null,
          width: msg.width ?? 0,
          height: msg.height ?? 0,
          ms: msg.ms ?? 0,
        });
      } else {
        job.reject(new Error(msg.error || "Analisis wajah gagal."));
      }
      this.pump();
    });

    const replace = (reason: string) => {
      const job = slot.busy;
      slot.busy = null;
      if (job) {
        clearTimeout(job.timer);
        job.reject(new Error(`Pemroses wajah berhenti (${reason}). Coba lagi.`));
      }
      const index = this.slots.indexOf(slot);
      if (index !== -1) this.slots[index] = this.spawn();
      this.pump();
    };

    worker.on("error", (err) => {
      console.error("[FACE] worker error:", err.message);
      replace(err.message);
    });
    worker.on("exit", (code) => {
      if (code !== 0) replace(`exit ${code}`);
    });

    return slot;
  }

  analyse(image: Uint8Array): Promise<FaceAnalysis> {
    if (this.queue.length >= MAX_QUEUE) return Promise.reject(new FaceBusyError());
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, image, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const job = this.queue.shift();
      if (!job) return;

      slot.busy = job;
      job.timer = setTimeout(() => {
        // A hung inference is killed; `exit` then rejects the job and spawns a
        // fresh worker, so one bad image cannot wedge a slot permanently.
        void slot.worker.terminate();
      }, JOB_TIMEOUT_MS);

      // Copy into a transferable buffer so the bytes move, not clone.
      const copy = new Uint8Array(job.image);
      slot.worker.postMessage({ id: job.id, image: copy }, [copy.buffer]);
    }
  }
}

const globalForFace = globalThis as typeof globalThis & { __hrisFacePool?: FacePool };

function pool(): FacePool {
  // Kept on globalThis so hot reloads in development reuse the same workers
  // instead of leaking a new pool, with its loaded models, on every edit.
  globalForFace.__hrisFacePool ??= new FacePool(workerCount());
  return globalForFace.__hrisFacePool;
}

export function analyseFace(image: Uint8Array): Promise<FaceAnalysis> {
  return pool().analyse(image);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type FaceStrictness = "ketat" | "normal" | "longgar";

/**
 * Maximum Euclidean distance between two 128-d face descriptors for them to
 * count as the same person.
 *
 * Measured on this model before choosing: two selfies of one employee sat at
 * 0.242; the closest of 22 other people's faces sat at 0.641 (median 0.780).
 * No impostor passed at any threshold up to 0.6. The options stop at 0.55 so
 * a "loose" setting still keeps a clear margin below that nearest impostor.
 */
export const FACE_THRESHOLDS: Record<FaceStrictness, number> = {
  ketat: 0.45,
  normal: 0.5,
  longgar: 0.55,
};

export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Smallest distance from a probe to any enrolled sample. */
export function bestDistance(probe: ArrayLike<number>, enrolled: number[][]): number {
  return enrolled.reduce((min, sample) => Math.min(min, faceDistance(probe, sample)), Infinity);
}

/**
 * Minimum face size, as a fraction of the shorter image edge.
 *
 * A face far from the camera yields a coarse descriptor that matches poorly
 * and inconsistently, so it is refused with an instruction to move closer
 * rather than compared and failed with a confusing "does not match".
 */
const MIN_FACE_FRACTION = 0.18;

export type FaceQualityProblem = "no_face" | "multiple_faces" | "too_small";

export function qualityProblem(a: FaceAnalysis): FaceQualityProblem | null {
  if (a.faces === 0 || !a.descriptor || !a.box) return "no_face";
  if (a.faces > 1) return "multiple_faces";
  const shorter = Math.min(a.width, a.height) || 1;
  if (a.box.width / shorter < MIN_FACE_FRACTION) return "too_small";
  return null;
}

export const QUALITY_MESSAGE: Record<FaceQualityProblem, string> = {
  no_face:
    "Wajah tidak terdeteksi di foto. Pastikan wajah terlihat jelas, tidak tertutup masker atau tangan, dan pencahayaan cukup.",
  multiple_faces:
    "Terdeteksi lebih dari satu wajah. Pastikan hanya Anda yang terlihat di kamera.",
  too_small:
    "Wajah terlalu jauh dari kamera. Dekatkan wajah hingga mengisi sebagian besar bingkai.",
};

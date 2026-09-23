/**
 * Lightweight in-process job queue.
 *
 * Intended for *short-lived, fire-and-forget* work inside a single request's
 * lifetime — retrying a notification, for instance. It is deliberately NOT used
 * for scheduled maintenance: jobs live in memory, so a restart loses them and a
 * serverless host discards them between invocations. Recurring work runs
 * through the authenticated cron endpoint at `/api/v1/cron/daily` instead.
 *
 * When Redis is configured this is where a BullMQ queue would be wired in;
 * every caller already goes through `addJob`, so the swap is local to this file.
 */

export type JobPayload = Record<string, unknown>;
export type JobHandler = (data: JobPayload) => Promise<void>;

interface PendingJob {
  id: string;
  data: JobPayload;
  runAt: number;
}

class QueueManager {
  private handlers = new Map<string, JobHandler>();
  private readonly usesRedis: boolean;
  private pending = new Map<string, PendingJob[]>();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.usesRedis = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
    if (!this.usesRedis) {
      this.startLocalLoop();
    }
  }

  registerWorker(queueName: string, handler: JobHandler) {
    this.handlers.set(queueName, handler);
  }

  async addJob(queueName: string, jobName: string, data: JobPayload, delayMs = 0) {
    const id = `${queueName}:${jobName}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;

    if (this.usesRedis) {
      // BullMQ integration point:
      //   await new Queue(queueName, { connection }).add(jobName, data, { delay: delayMs });
      console.log(`[QUEUE] (redis) ${id} belum dikirim — adapter BullMQ belum dipasang.`);
      return;
    }

    const queue = this.pending.get(queueName) ?? [];
    queue.push({ id, data, runAt: Date.now() + delayMs });
    this.pending.set(queueName, queue);
  }

  private startLocalLoop() {
    // `unref` keeps this timer from holding the process open — important for
    // scripts like the seeder that import models and then expect to exit.
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref?.();
  }

  private async drain() {
    const now = Date.now();

    for (const [queueName, jobs] of this.pending.entries()) {
      const handler = this.handlers.get(queueName);
      if (!handler) continue;

      const due = jobs.filter((j) => j.runAt <= now);
      if (!due.length) continue;

      this.pending.set(
        queueName,
        jobs.filter((j) => j.runAt > now)
      );

      for (const job of due) {
        try {
          await handler(job.data);
        } catch (err) {
          console.error(`[QUEUE] job ${job.id} gagal:`, (err as Error).message);
        }
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const queueManager = new QueueManager();
export default queueManager;

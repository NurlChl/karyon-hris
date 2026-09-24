/**
 * Runs once per server instance. Starts background jobs that must work on a
 * plain self-hosted install without an external cron service.
 *
 * `next dev` does not start them unless HRIS_DEV_SCHEDULER=true, so a
 * development database full of demo employees is not flooded with reminders.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.HRIS_DISABLE_SCHEDULER === "true") return;
  if (process.env.NODE_ENV === "development" && process.env.HRIS_DEV_SCHEDULER !== "true") return;
  const { startAttendanceScheduler } = await import("./lib/hr/attendance-scheduler");
  startAttendanceScheduler();
}

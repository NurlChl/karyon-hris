import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { HttpError } from "@/lib/guard";
import { connectToDatabase } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { clientIp } from "@/lib/rate-limit";
import { logActivity } from "@/lib/audit/logger";
import { getSettings } from "@/lib/settings";
import {
  notifyUsers,
  resolveRecipientForEmployee,
  resolveRecipientsByRole,
} from "@/lib/notification/notify";
import {
  formatDate,
  wibDateKey,
  wibEndOfDay,
  wibParts,
  wibStartOfDay,
} from "@/lib/time";
import { purgeExpiredUploads } from "@/lib/uploads";
import {
  remindIncompleteNewHires,
  remindMissingClockOut,
  remindStaleApprovals,
  remindTomorrowInterviews,
} from "@/lib/notification/reminders";
import HolidaySwapRequest from "@/models/HolidaySwapRequest";
import Attendance from "@/models/Attendance";
import Contract from "@/models/Contract";
import Employee from "@/models/Employee";
import User from "@/models/User";
import OvertimeRecord from "@/models/OvertimeRecord";
import NationalHoliday from "@/models/NationalHoliday";
import { requireProFeature } from "@/lib/licensing/server";

/**
 * Daily maintenance run.
 *
 * Implemented as an authenticated endpoint rather than an in-process timer so
 * it survives restarts and works on serverless hosting, where a background
 * `setInterval` is killed between requests. Point any scheduler at it once a
 * day after midnight WIB:
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://host/api/v1/cron/daily
 *
 * Every task below is idempotent, so a double run (or a retry after a network
 * failure) cannot double-notify or double-charge anything.
 */

export const GET = wrapRouteHandler(async (req) => {
  authorize(req);
  await requireProFeature("automation.advanced");
  await connectToDatabase();

  const todayKey = wibDateKey();
  const results = {
    ranAt: new Date().toISOString(),
    todayKey,
    forfeitedSwaps: await forfeitUnworkedHolidaySwaps(todayKey),
    overtimeFromHolidays: await recordHolidayOvertime(todayKey),
    endedContracts: await endExpiredContracts(),
    contractReminders: await sendContractReminders(),
    birthdayGreetings: await sendBirthdayGreetings(),
    expiredUploads: await purgeExpiredUploads(),
    missingClockOut: await remindMissingClockOut(),
    staleApprovals: await remindStaleApprovals(),
    tomorrowInterviews: await remindTomorrowInterviews(),
    incompleteNewHires: await remindIncompleteNewHires(),
  };

  void logActivity({
    userId: null,
    action: "CRON_DAILY",
    module: "system",
    after: results,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "cron",
  });

  return apiSuccess(results, "Tugas harian selesai dijalankan.");
});

export const POST = GET;

function authorize(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new HttpError(
      503,
      "CRON_DISABLED",
      "CRON_SECRET belum diset, sehingga tugas terjadwal dinonaktifkan."
    );
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!provided || !safeEqual(provided, secret)) {
    throw new HttpError(401, "UNAUTHORIZED", "Kunci penjadwal tidak dikenali.");
  }
}

/* ------------------------------------------------------------------ */

/**
 * Voids approved holiday swaps where the employee never actually worked the
 * holiday. This is the rule the spec states but nothing previously enforced:
 * the right to a replacement day is earned by attending, not by being approved.
 * Only yesterday and earlier are considered, so a swap is never voided while
 * the employee could still clock in.
 */
async function forfeitUnworkedHolidaySwaps(todayKey: string) {
  const cutoff = wibStartOfDay(todayKey);

  const candidates = await HolidaySwapRequest.find({
    status: "approved",
    holidayDate: { $lt: cutoff },
  })
    .limit(500)
    .lean<Array<{ _id: RecordId; employeeId: RecordId; holidayDate: Date }>>();

  let forfeited = 0;
  for (const swap of candidates) {
    const attended = await Attendance.findOne({
      employeeId: swap.employeeId,
      date: { $gte: wibStartOfDay(swap.holidayDate), $lte: wibEndOfDay(swap.holidayDate) },
      clockIn: { $ne: null },
    }).lean();

    if (attended) continue;

    await HolidaySwapRequest.updateOne(
      { _id: swap._id, status: "approved" },
      {
        status: "forfeited",
        forfeitedReason: `Tidak ada catatan absen masuk pada ${formatDate(swap.holidayDate)}.`,
      }
    );
    forfeited++;

    const recipients = await resolveRecipientForEmployee(swap.employeeId);
    void notifyUsers(recipients, {
      kind: "approval_result",
      title: "Hak tukar libur Anda gugur",
      body:
        `Tidak ada catatan presensi pada ${formatDate(swap.holidayDate)}, sehingga hak libur ` +
        `pengganti untuk tanggal merah tersebut otomatis dibatalkan sesuai ketentuan.`,
      href: "/portal/holiday-swap",
    });
  }

  return { checked: candidates.length, forfeited };
}

/**
 * Turns attendance on a public holiday into an overtime record when the
 * employee did not swap the day off, if the CMS has that option enabled.
 */
async function recordHolidayOvertime(todayKey: string) {
  const settings = await getSettings();
  if (!settings.overtime_auto_from_holiday) return { created: 0, skipped: "dinonaktifkan" };

  // Look at yesterday: the day is complete, so clock-out times are final.
  const yesterdayKey = wibDateKey(new Date(wibStartOfDay(todayKey).getTime() - 1));
  const holiday = await NationalHoliday.findOne({
    dateKey: yesterdayKey,
    isActive: true,
    type: "libur_nasional",
  }).lean<{ name: string } | null>();
  if (!holiday) return { created: 0, skipped: "bukan tanggal merah" };

  const logs = await Attendance.find({
    date: wibStartOfDay(yesterdayKey),
    clockIn: { $ne: null },
    clockOut: { $ne: null },
  }).lean<Array<{ employeeId: RecordId; clockIn: Date; clockOut: Date }>>();

  let created = 0;
  for (const log of logs) {
    // An employee who swapped the day off is taking a replacement holiday, not
    // working overtime — they must not be paid twice for the same day.
    const swapped = await HolidaySwapRequest.findOne({
      employeeId: log.employeeId,
      holidayDate: wibStartOfDay(yesterdayKey),
      status: { $in: ["approved", "pending"] },
    }).lean();
    if (swapped) continue;

    const hours = Math.max(
      0,
      Math.round(((log.clockOut.getTime() - log.clockIn.getTime()) / 3_600_000) * 100) / 100
    );
    if (hours < 1) continue;

    // Upsert keyed on employee + date makes a repeated run a no-op.
    const res = await OvertimeRecord.updateOne(
      { employeeId: log.employeeId, date: wibStartOfDay(yesterdayKey) },
      {
        $setOnInsert: {
          employeeId: log.employeeId,
          date: wibStartOfDay(yesterdayKey),
          hours,
          source: "auto",
          status: "approved",
          note: `Bekerja pada ${holiday.name} tanpa tukar libur.`,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created++;
  }

  return { created, holiday: holiday.name };
}

/**
 * Moves contracts past their end date to "ended". Where HR decided not to renew
 * and asked for it, the employee is marked resigned on that date too.
 */
async function endExpiredContracts() {
  const today = wibStartOfDay();
  const due = await Contract.find({ status: "active", endDate: { $ne: null, $lt: today } })
    .select("employeeId decision notes nextContractId")
    .limit(1000)
    .lean<Array<{ _id: RecordId; employeeId: RecordId; decision: string; notes?: string }>>();
  let resigned = 0;
  for (const c of due) {
    await Contract.updateOne({ _id: c._id, status: "active" }, { $set: { status: "ended" } });
    if (c.decision === "not_renew" && c.notes?.includes("[auto-resign]")) {
      await Employee.updateOne({ _id: c.employeeId, status: { $ne: "resigned" } }, { $set: { status: "resigned" } });
      // Same as HR setting the status by hand: the login closes with it.
      await User.updateOne({ employeeId: c.employeeId }, { $set: { isActive: false } });
      resigned++;
    }
  }
  return { ended: due.length, resigned };
}

/** Notifies employee, supervisor, and HRD ahead of a contract ending. */
async function sendContractReminders() {
  const windows = [30, 14, 7];
  const todayStart = wibStartOfDay();
  let notified = 0;

  for (const days of windows) {
    const target = new Date(todayStart.getTime() + days * 86_400_000);
    const contracts = await Contract.find({
      status: "active",
      // Already renewed or decided: nobody needs reminding.
      decision: "pending",
      nextContractId: null,
      endDate: { $gte: wibStartOfDay(target), $lte: wibEndOfDay(target) },
    })
      .limit(200)
      .lean<Array<{ _id: RecordId; employeeId: RecordId; endDate: Date; type: string }>>();

    for (const contract of contracts) {
      const employee = await Employee.findById(contract.employeeId)
        .select("name divisionId")
        .lean<{ name: string; divisionId?: RecordId } | null>();
      if (!employee) continue;

      const [own, supervisors, hrd] = await Promise.all([
        resolveRecipientForEmployee(contract.employeeId),
        resolveRecipientsByRole("SPV", { divisionId: employee.divisionId?.toString() ?? null }),
        resolveRecipientsByRole("HRD"),
      ]);

      // Deduplicate: an HRD who also supervises the division would otherwise
      // receive the same reminder twice.
      const seen = new Set<string>();
      const recipients = [...own, ...supervisors, ...hrd].filter((r) =>
        seen.has(r.userId) ? false : (seen.add(r.userId), true)
      );

      await notifyUsers(recipients, {
        kind: "contract",
        title: `Kontrak ${employee.name} berakhir dalam ${days} hari`,
        body:
          `Kontrak ${contract.type.toUpperCase()} berakhir pada ${formatDate(contract.endDate)}. ` +
          `Putuskan diperpanjang, diangkat tetap, atau tidak diperpanjang sebelum tanggal tersebut.`,
        href: "/admin/contracts?view=expiring",
        refType: "contract",
        refId: contract._id,
      });
      notified++;
    }
  }

  return { notified };
}

/** Sends a birthday greeting to the employee on the day itself. */
async function sendBirthdayGreetings() {
  const { month, day } = wibParts();

  const birthdayPeople = await Employee.aggregate<{ _id: RecordId; name: string }>([
    { $match: { status: "active", birthDate: { $ne: null } } },
    {
      $project: {
        name: 1,
        m: { $month: { date: "$birthDate", timezone: "Asia/Jakarta" } },
        d: { $dayOfMonth: { date: "$birthDate", timezone: "Asia/Jakarta" } },
      },
    },
    { $match: { m: month, d: day } },
    { $limit: 100 },
  ]);

  for (const person of birthdayPeople) {
    const recipients = await resolveRecipientForEmployee(person._id);
    await notifyUsers(recipients, {
      kind: "birthday",
      title: "Selamat ulang tahun!",
      body: `Segenap manajemen mengucapkan selamat ulang tahun, ${person.name}. Semoga sehat selalu.`,
      href: "/portal/profile",
    });
  }

  return { sent: birthdayPeople.length };
}

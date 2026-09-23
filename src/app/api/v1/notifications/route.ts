import { z } from "zod";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requireUser, parseBody, pagination } from "@/lib/guard";
import Notification from "@/models/Notification";

/** The bell: a user's own feed, plus the unread count the badge renders. */
export const GET = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const { page, limit, skip } = pagination(req, 20, 50);
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";

  const filter: Record<string, unknown> = { userId: ctx.user.id };
  if (unreadOnly) filter.isRead = false;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: ctx.user.id, isRead: false }),
  ]);

  return apiSuccess({ items, unreadCount }, undefined, { page, limit, total });
});

const markSchema = z.object({
  /** Specific ids to mark read; omit together with `all` to no-op. */
  ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
  all: z.boolean().optional(),
});

export const POST = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const body = await parseBody(req, markSchema);

  // Always scoped to the caller's own id, so an id from another user's feed
  // simply matches nothing.
  const filter: Record<string, unknown> = { userId: ctx.user.id, isRead: false };
  if (!body.all) {
    if (!body.ids?.length) return apiSuccess({ updated: 0 }, "Tidak ada notifikasi yang diperbarui.");
    filter._id = { $in: body.ids };
  }

  const res = await Notification.updateMany(filter, { isRead: true });
  return apiSuccess(
    { updated: res.modifiedCount },
    body.all ? "Semua notifikasi ditandai telah dibaca." : "Notifikasi ditandai telah dibaca."
  );
});

/** Clears the caller's read notifications. */
export const DELETE = wrapRouteHandler(async (req) => {
  const ctx = await requireUser(req);
  const res = await Notification.deleteMany({ userId: ctx.user.id, isRead: true });
  return apiSuccess({ deleted: res.deletedCount }, "Notifikasi yang sudah dibaca dihapus.");
});

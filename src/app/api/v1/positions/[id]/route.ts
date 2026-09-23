import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import Position from "@/models/Position";
import { connectToDatabase } from "@/lib/db";

export const DELETE = wrapRouteHandler(async (req, { params }) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk melakukan aksi ini", null, 401);
  }

  const perm = await checkPermission(session.user.id, "settings", "write");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk menghapus jabatan", null, 403);
  }

  const { id } = await params;
  if (!id) {
    return apiError("BAD_REQUEST", "ID jabatan wajib disediakan");
  }

  await connectToDatabase();
  const position = await Position.findById(id);
  if (!position) {
    return apiError("NOT_FOUND", "Jabatan tidak ditemukan");
  }

  await Position.findByIdAndDelete(id);

  await logActivity({
    userId: session.user.id,
    action: "DELETE_POSITION",
    module: "settings",
    before: position.toObject(),
    after: null,
    ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
    userAgent: req.headers.get("user-agent") || "",
  });

  return apiSuccess({ id }, "Berhasil menghapus jabatan");
});

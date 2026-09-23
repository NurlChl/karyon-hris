import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import Division from "@/models/Division";
import "@/models/Employee";
import "@/models/Branch"; // Force load Branch schema to populate branchId
import { connectToDatabase } from "@/lib/db";

export const GET = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk mengakses data ini", null, 401);
  }

  await connectToDatabase();
  const divisions = await Division.find({}).populate("headId", "name employeeId").populate("branchId", "name");
  return apiSuccess(divisions, "Berhasil memuat data divisi");
});

export const POST = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk melakukan aksi ini", null, 401);
  }

  const perm = await checkPermission(session.user.id, "settings", "write");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk mengonfigurasi divisi", null, 403);
  }

  const body = await req.json();
  const { id, name, headId, branchId } = body;

  if (!name) {
    return apiError("BAD_REQUEST", "Nama divisi wajib diisi");
  }

  await connectToDatabase();

  let division;
  let oldData = null;

  if (id) {
    oldData = await Division.findById(id);
    if (!oldData) {
      return apiError("NOT_FOUND", "Divisi tidak ditemukan");
    }
    division = await Division.findByIdAndUpdate(id, { name, headId: headId || null, branchId: branchId || null }, { new: true });
    
    await logActivity({
      userId: session.user.id,
      action: "UPDATE_DIVISION",
      module: "settings",
      before: oldData.toObject(),
      after: division.toObject(),
      ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || "",
    });
  } else {
    division = await Division.create({ name, headId: headId || null, branchId: branchId || null });
    
    await logActivity({
      userId: session.user.id,
      action: "CREATE_DIVISION",
      module: "settings",
      before: null,
      after: division.toObject(),
      ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || "",
    });
  }

  return apiSuccess(division, id ? "Berhasil memperbarui divisi" : "Berhasil menambahkan divisi");
});

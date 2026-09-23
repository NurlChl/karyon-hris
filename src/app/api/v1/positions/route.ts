import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import Position from "@/models/Position";
import "@/models/Division"; // Force load Division schema to populate divisionId
import { connectToDatabase } from "@/lib/db";

export const GET = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk mengakses data ini", null, 401);
  }

  await connectToDatabase();
  const positions = await Position.find({}).populate("divisionId", "name");
  return apiSuccess(positions, "Berhasil memuat data jabatan");
});

export const POST = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk melakukan aksi ini", null, 401);
  }

  const perm = await checkPermission(session.user.id, "settings", "write");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk mengonfigurasi jabatan", null, 403);
  }

  const body = await req.json();
  const { id, name, divisionId, description, jobdesk, requirements, location, type, status } = body;

  if (!name) {
    return apiError("BAD_REQUEST", "Nama jabatan wajib diisi");
  }

  await connectToDatabase();

  let position;
  let oldData = null;

  if (id) {
    oldData = await Position.findById(id);
    if (!oldData) {
      return apiError("NOT_FOUND", "Jabatan tidak ditemukan");
    }
    position = await Position.findByIdAndUpdate(
      id,
      { name, divisionId: divisionId || null, description, jobdesk, requirements, location, type, status },
      { new: true }
    );
    
    await logActivity({
      userId: session.user.id,
      action: "UPDATE_POSITION",
      module: "settings",
      before: oldData.toObject(),
      after: position.toObject(),
      ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || "",
    });
  } else {
    position = await Position.create({
      name,
      divisionId: divisionId || null,
      description: description || "",
      jobdesk: jobdesk || "",
      requirements: requirements || "",
      location: location || "Jakarta",
      type: type || "Full-Time",
      status: status || "active"
    });
    
    await logActivity({
      userId: session.user.id,
      action: "CREATE_POSITION",
      module: "settings",
      before: null,
      after: position.toObject(),
      ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
      userAgent: req.headers.get("user-agent") || "",
    });
  }

  return apiSuccess(position, id ? "Berhasil memperbarui jabatan" : "Berhasil menambahkan jabatan");
});

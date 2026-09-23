import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import Setting from "@/models/Setting";
import { connectToDatabase } from "@/lib/db";

export const GET = wrapRouteHandler(async (req) => {
  await connectToDatabase();

  let setting = await Setting.findOne({ key: "inventory_categories" });
  if (!setting) {
    // Initialize default categories
    const defaults = ["laptop", "phone", "vehicle", "other"];
    setting = await Setting.create({
      key: "inventory_categories",
      value: defaults,
      description: "Daftar kategori barang inventaris GA"
    });
  }

  return apiSuccess(setting.value, "Berhasil memuat kategori inventaris");
});

export const POST = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk mengakses data ini", null, 401);
  }

  // Check RBAC settings write permission
  const perm = await checkPermission(session.user.id, "settings", "write");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk mengonfigurasi kategori", null, 403);
  }

  const body = await req.json();
  const { categories } = body;

  if (!categories || !Array.isArray(categories)) {
    return apiError("BAD_REQUEST", "Data kategori harus berupa array");
  }

  await connectToDatabase();

  let setting = await Setting.findOne({ key: "inventory_categories" });
  let oldVal = null;

  if (setting) {
    oldVal = [...setting.value];
    setting.value = categories;
    await setting.save();
  } else {
    setting = await Setting.create({
      key: "inventory_categories",
      value: categories,
      description: "Daftar kategori barang inventaris GA"
    });
  }

  // Audit Log
  await logActivity({
    userId: session.user.id,
    action: "UPDATE_INVENTORY_CATEGORIES",
    module: "settings",
    before: oldVal ? { categories: oldVal } : null,
    after: { categories },
    ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
    userAgent: req.headers.get("user-agent") || ""
  });

  return apiSuccess(setting.value, "Berhasil memperbarui kategori inventaris");
});

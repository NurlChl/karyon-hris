import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { checkPermission } from "@/lib/rbac";
import { logActivity } from "@/lib/audit/logger";
import { connectToDatabase } from "@/lib/db";
import AuditReport from "@/models/AuditReport";
import Inventory from "@/models/Inventory";
import "@/models/User"; // Ensure User model is loaded

export const GET = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk mengakses data ini", null, 401);
  }

  // Allow both GA/Inventory managers and Audit roles
  const perm = await checkPermission(session.user.id, "inventory", "read");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk melihat riwayat audit", null, 403);
  }

  await connectToDatabase();

  const reports = await AuditReport.find({})
    .populate("auditorId", "name email role")
    .populate("inventoryId", "code name category")
    .sort({ auditDate: -1 })
    .lean();

  return apiSuccess(reports, "Berhasil memuat riwayat laporan audit");
});

export const POST = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk melakukan aksi ini", null, 401);
  }

  // Allow write access to inventory for submitting checks
  const perm = await checkPermission(session.user.id, "inventory", "write");
  if (!perm.allowed) {
    return apiError("FORBIDDEN", "Anda tidak memiliki izin untuk menyimpan laporan audit", null, 403);
  }

  const body = await req.json();
  const { inventoryId, condition, notes, status } = body;

  if (!inventoryId || !condition) {
    return apiError("BAD_REQUEST", "Data id aset dan kondisi wajib diisi");
  }

  await connectToDatabase();

  // Find asset
  const asset = await Inventory.findById(inventoryId);
  if (!asset) {
    return apiError("NOT_FOUND", "Aset inventaris tidak ditemukan");
  }

  const oldCondition = asset.condition;

  // Create audit report record
  const report = await AuditReport.create({
    auditorId: session.user.id,
    inventoryId,
    condition,
    notes: notes || "",
    status: status || "verified",
    auditDate: new Date()
  });

  // Update asset condition
  asset.condition = condition;
  await asset.save();

  // Log activity
  await logActivity({
    userId: session.user.id,
    action: "PHYSICAL_AUDIT_ASSET",
    module: "inventory",
    before: { code: asset.code, condition: oldCondition },
    after: { code: asset.code, condition, notes, reportId: report._id },
    ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
    userAgent: req.headers.get("user-agent") || ""
  });

  return apiSuccess(report, "Berhasil menyimpan laporan audit fisik aset");
});

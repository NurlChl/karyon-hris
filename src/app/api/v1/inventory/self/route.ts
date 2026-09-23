import { auth } from "@/auth";
import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import { logActivity } from "@/lib/audit/logger";
import InventoryAssignment from "@/models/InventoryAssignment";
import Inventory from "@/models/Inventory";
import { connectToDatabase } from "@/lib/db";

// Ensure schemas are registered
import "@/models/Inventory";

export const GET = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk mengakses data ini", null, 401);
  }

  // Check if user has an associated employee record
  if (!session.user.employeeId) {
    return apiError("BAD_REQUEST", "Akun Anda tidak terhubung dengan data karyawan");
  }

  await connectToDatabase();

  const assignments = await InventoryAssignment.find({
    employeeId: session.user.employeeId,
    status: { $in: ["pending_handover", "active"] }
  })
  .populate("inventoryId")
  .sort({ handoverDate: -1 })
  .lean<Array<Record<string, unknown>>>();

  return apiSuccess(assignments, "Berhasil memuat inventaris karyawan");
});

export const POST = wrapRouteHandler(async (req) => {
  const session = await auth();
  if (!session?.user) {
    return apiError("UNAUTHORIZED", "Anda harus login untuk melakukan aksi ini", null, 401);
  }

  if (!session.user.employeeId) {
    return apiError("BAD_REQUEST", "Akun Anda tidak terhubung dengan data karyawan");
  }

  const body = await req.json();
  const { assignmentId, signatureData } = body; // signatureData is base64 string

  if (!assignmentId || !signatureData) {
    return apiError("BAD_REQUEST", "Data ID penugasan dan tanda tangan wajib diisi");
  }

  await connectToDatabase();

  const assignment = await InventoryAssignment.findOne({
    _id: assignmentId,
    employeeId: session.user.employeeId,
    status: "pending_handover"
  });

  if (!assignment) {
    return apiError("NOT_FOUND", "Penugasan inventaris tidak ditemukan atau sudah ditandatangani");
  }

  const oldAsg = { ...assignment.toObject() };

  // Save the signatureData base64 directly or mock storage path
  assignment.signatureUrl = signatureData;
  assignment.status = "active";
  await assignment.save();

  // Audit log
  await logActivity({
    userId: session.user.id,
    action: "SIGN_INVENTORY_BAST",
    module: "inventory",
    before: oldAsg,
    after: assignment.toObject(),
    ip: req.headers.get("x-forwarded-for") || "127.0.0.1",
    userAgent: req.headers.get("user-agent") || ""
  });

  return apiSuccess(assignment, "Berhasil menandatangani BAST inventaris secara digital");
});

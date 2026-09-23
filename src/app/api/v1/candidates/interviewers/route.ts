import { RecordId } from "@/lib/postgres";
import database from "@/lib/postgres";
import { wrapRouteHandler, apiSuccess } from "@/lib/api";
import { requirePermission } from "@/lib/guard";
import User from "@/models/User";
import Role from "@/models/Role";
import "@/models/Employee";

/**
 * People who can be assigned to interview an applicant: every active account
 * except plain staff. The interviewer is notified with a link to the applicant,
 * so the list is limited to accounts that have a reason to open it.
 */
export const GET = wrapRouteHandler(async (req) => {
  await requirePermission(req, "recruitment", "read");

  const roles = await Role.find({ name: { $ne: "STAFF" } })
    .select("_id name")
    .lean<Array<{ _id: RecordId; name: string }>>();
  const roleName = new Map(roles.map((r) => [String(r._id), r.name]));

  const users = await User.find({ roleId: { $in: roles.map((r) => r._id) }, isActive: { $ne: false } })
    .select("email roleId employeeId")
    .populate("employeeId", "name")
    .limit(500)
    .lean<Array<{ _id: RecordId; email: string; roleId: RecordId; employeeId?: { name?: string } | null }>>();

  return apiSuccess(
    users
      .map((u) => ({
        _id: String(u._id),
        name: u.employeeId?.name || u.email,
        email: u.email,
        role: roleName.get(String(u.roleId)) ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "id"))
  );
});

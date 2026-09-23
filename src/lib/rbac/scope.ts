import Employee from "@/models/Employee";
import type { PermissionResult } from ".";

export interface ScopePrincipal {
  employeeId: string | null;
  branchId: string | null;
  divisionId: string | null;
}

export interface ScopeContext {
  user: ScopePrincipal;
  permission: PermissionResult;
}

export interface ScopeFields {
  employee?: string;
  branch?: string;
  division?: string;
}

/** An empty membership set cannot match any document, including unusual ids. */
export const DENIED_SCOPE = { $in: [] };

/**
 * Builds a filter for collections that carry their own organisation fields.
 * Missing scope metadata must fail closed; `{}` would widen the query.
 */
export function scopeFilterForFields(
  ctx: ScopeContext,
  fields: ScopeFields = {}
): Record<string, unknown> {
  const employeeField = fields.employee ?? "employeeId";
  if (!ctx.permission.allowed) return { [employeeField]: DENIED_SCOPE };
  switch (ctx.permission.scope) {
    case "all":
      return {};
    case "branch":
      return fields.branch && ctx.user.branchId
        ? { [fields.branch]: ctx.user.branchId }
        : { [employeeField]: DENIED_SCOPE };
    case "division":
      return fields.division && ctx.user.divisionId
        ? { [fields.division]: ctx.user.divisionId }
        : { [employeeField]: DENIED_SCOPE };
    case "self":
      return { [employeeField]: ctx.user.employeeId ?? DENIED_SCOPE };
    default:
      return { [employeeField]: DENIED_SCOPE };
  }
}

/**
 * Scopes employee-owned collections such as payroll, contracts, leave, and
 * corrections. Those collections do not duplicate division metadata, so the
 * allowed employee ids are resolved from the employee master record first.
 */
export async function employeeRecordScopeFilter(
  ctx: ScopeContext,
  employeeField = "employeeId"
): Promise<Record<string, unknown>> {
  if (!ctx.permission.allowed) return { [employeeField]: DENIED_SCOPE };
  switch (ctx.permission.scope) {
    case "all":
      return {};
    case "self":
      return { [employeeField]: ctx.user.employeeId ?? DENIED_SCOPE };
    case "branch":
    case "division": {
      const organisationField = ctx.permission.scope === "branch" ? "branchId" : "divisionId";
      const organisationId =
        ctx.permission.scope === "branch" ? ctx.user.branchId : ctx.user.divisionId;
      if (!organisationId) return { [employeeField]: DENIED_SCOPE };

      const employeeIds = await Employee.distinct("_id", {
        [organisationField]: organisationId,
      });
      return { [employeeField]: { $in: employeeIds } };
    }
    default:
      return { [employeeField]: DENIED_SCOPE };
  }
}

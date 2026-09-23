import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

/** Roles allowed anywhere under /admin. */
const ADMIN_ROLES = new Set(["SUPERADMIN", "DIREKSI", "HRD", "AUDIT", "GA", "SPV"]);

/**
 * Admin sections that only a subset of admin roles may open. Route handlers
 * re-check permissions from the database; this map only avoids showing a page
 * that would be empty or immediately rejected.
 */
const SECTION_ROLES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin/settings", roles: ["SUPERADMIN", "HRD"] },
  { prefix: "/admin/audit", roles: ["SUPERADMIN", "AUDIT", "DIREKSI"] },
  { prefix: "/admin/payroll", roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"] },
  { prefix: "/admin/employees", roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"] },
  { prefix: "/admin/recruitment", roles: ["SUPERADMIN", "HRD", "DIREKSI"] },
  { prefix: "/admin/vacancies", roles: ["SUPERADMIN", "HRD", "DIREKSI"] },
  { prefix: "/admin/branches", roles: ["SUPERADMIN", "HRD", "GA"] },
  { prefix: "/admin/departments", roles: ["SUPERADMIN", "HRD"] },
  { prefix: "/admin/leave-types", roles: ["SUPERADMIN", "HRD"] },
  { prefix: "/admin/contracts", roles: ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI"] },
];

/** Where a given role lands after signing in. */
function landingFor(role: string | undefined): string {
  if (role && ADMIN_ROLES.has(role)) return "/admin";
  return "/portal/attendance";
}

export const proxy = auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const isLoggedIn = Boolean(req.auth?.user);
  const role = req.auth?.user?.role;
  const mustChangePassword = Boolean(req.auth?.user?.mustChangePassword);

  const isOnAdmin = path.startsWith("/admin");
  const isOnPortal = path.startsWith("/portal");
  const isOnDocs = path === "/docs" || path.startsWith("/docs/");
  const isOnApiDocs = path === "/api-docs" || path.startsWith("/api-docs/");
  const isOnAuthPage =
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/admin") ||
    path.startsWith("/auth/forgot-password");

  // --- Protected areas require a session --------------------------------
  // Everyone lands on the employee login. Sending a signed-out visitor of
  // /admin to the administrator login would publish that address to anyone who
  // tries the obvious URL; administrators type it themselves. The callback is
  // kept only for non-admin areas for the same reason.
  if ((isOnAdmin || isOnPortal || isOnDocs || isOnApiDocs) && !isLoggedIn) {
    const loginUrl = new URL("/auth/login", nextUrl);
    if (!isOnAdmin && !isOnApiDocs) loginUrl.searchParams.set("callbackUrl", path + nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // The API reference describes every endpoint, including administration ones.
  if (isOnApiDocs && isLoggedIn && role !== "SUPERADMIN") {
    return NextResponse.redirect(new URL(landingFor(role), nextUrl));
  }

  // --- First-login password change is mandatory -------------------------
  // Everything except the profile page (where the form lives) is blocked so a
  // shared default password cannot be left in place.
  if (isLoggedIn && mustChangePassword && (isOnAdmin || isOnPortal)) {
    if (!path.startsWith("/portal/profile")) {
      const url = new URL("/portal/profile", nextUrl);
      url.searchParams.set("force_password", "1");
      return NextResponse.redirect(url);
    }
  }

  // --- Admin area role gate ---------------------------------------------
  // Discipline permits custom roles; its APIs enforce the live permission matrix.
  if (isOnAdmin && isLoggedIn && !path.startsWith("/admin/discipline")) {
    if (!role || !ADMIN_ROLES.has(role)) {
      return NextResponse.redirect(new URL("/portal/attendance", nextUrl));
    }
    const section = SECTION_ROLES.find((s) => path.startsWith(s.prefix));
    if (section && !section.roles.includes(role)) {
      const url = new URL("/admin", nextUrl);
      url.searchParams.set("denied", section.prefix.replace("/admin/", ""));
      return NextResponse.redirect(url);
    }
  }

  // --- Signed-in users should not sit on a login page --------------------
  if (isLoggedIn && isOnAuthPage) {
    return NextResponse.redirect(new URL(landingFor(role), nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/portal/:path*",
    "/docs",
    "/api-docs",
    "/auth/login",
    "/auth/admin",
    "/auth/forgot-password",
  ],
};

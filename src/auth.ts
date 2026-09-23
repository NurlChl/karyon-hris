import NextAuth, { CredentialsSignin, DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { sha256 } from "@/lib/crypto";
import User from "@/models/User";
import Employee from "@/models/Employee";
import { connectToDatabase, isDbUnreachable } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/audit/logger";
import { authConfig } from "./auth.config";
import { getEntitlements } from "@/lib/licensing/server";
import {
  clientIp,
  rateLimit,
  rateLimitKeyForIp,
  resetRateLimit,
  RATE_RULES,
} from "@/lib/rate-limit";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      employeeId: string | null;
      branchId?: string | null;
      divisionId?: string | null;
      employeeName?: string | null;
      mustChangePassword?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    credentialStamp?: string;
    id?: string;
    role?: string;
    employeeId?: string | null;
    branchId?: string | null;
    divisionId?: string | null;
    employeeName?: string | null;
    mustChangePassword?: boolean;
  }
}

/**
 * Every failure path returns the same `null`, and the login page shows one
 * generic message. Distinguishing "unknown email" from "wrong password" would
 * turn the form into an account-enumeration oracle.
 *
 * Nothing here logs the submitted email or password — the previous
 * implementation printed both to the server console on every attempt.
 */
/**
 * Raised when sign-in fails because the database is unreachable, not because
 * the credentials were wrong.
 *
 * Auth.js turns every `authorize()` failure into `CredentialsSignin`, so an
 * outage used to reach the user as "email atau kata sandi salah" — sending
 * people off to reset a password that was never the problem. Subclassing keeps
 * the Auth.js contract while carrying a `code` the login page can read.
 */
class DatabaseUnavailableError extends CredentialsSignin {
  code = "db_unavailable";
}

class LoginRateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      if (params.user) token.credentialStamp = params.user.credentialStamp;
      // Every server-side auth() call checks live credentials and employment.
      // Legacy tokens have no stamp and deliberately require a fresh login.
      if (!token.id || typeof token.credentialStamp !== "string") return null;
      await connectToDatabase();
      const current = await User.findById(token.id).populate("roleId", "name");
      if (!current || current.isActive === false || !current.passwordHash ||
          token.credentialStamp !== sha256(current.passwordHash)) return null;
      const role = current.roleId as unknown as { name?: string } | null;
      if (!role?.name) return null;
      const employee = current.employeeId
        ? await Employee.findById(current.employeeId).select("name status branchId divisionId")
        : null;
      if (current.employeeId && (!employee || !["active", "onboarding"].includes(employee.status))) return null;
      token.role = role.name;
      token.employeeId = employee?._id.toString() ?? null;
      token.branchId = employee?.branchId?.toString() ?? null;
      token.divisionId = employee?.divisionId?.toString() ?? null;
      token.employeeName = employee?.name ?? null;
      token.mustChangePassword = Boolean(current.mustChangePassword);
      return token;
    },
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || email.length > 254 || !password || password.length > 1024) return null;

        // Defend both dimensions: an attacker spraying many accounts from one
        // address and an attacker distributing attempts against one account.
        const ip = clientIp(request);
        const { key: ipKey, sharedBucket } = rateLimitKeyForIp(ip, {
          userAgent: request.headers.get("user-agent"),
          language: request.headers.get("accept-language"),
        });
        const ipRule = sharedBucket
          ? { ...RATE_RULES.loginIp, max: RATE_RULES.loginIp.max * 20 }
          : RATE_RULES.loginIp;
        const accountKey = `auth:account:${email}`;
        const ipResult = rateLimit(`auth:ip:${ipKey}`, ipRule);
        const accountResult = rateLimit(accountKey, RATE_RULES.auth);
        if (!ipResult.ok || !accountResult.ok) throw new LoginRateLimitedError();

        try {
          await connectToDatabase();
          const settings = await getSettings();
          const maxAttempts = Number(settings.login_max_attempts) || 5;
          const lockoutMinutes = Number(settings.login_lockout_minutes) || 15;

          const user = await User.findOne({ email }).populate("roleId");

          // Spend comparable time on the unknown-email path so response timing
          // does not reveal whether the account exists.
          if (!user || !user.passwordHash) {
            await bcrypt.compare(password, "$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsa");
            return null;
          }

          if (user.isActive === false) return null;

          if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
            return null;
          }

          const isValid = await bcrypt.compare(password, user.passwordHash);

          if (!isValid) {
            user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
            if (user.failedLoginAttempts >= maxAttempts) {
              user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
              user.failedLoginAttempts = 0;
              void logActivity({
                userId: user._id.toString(),
                action: "ACCOUNT_LOCKED",
                module: "auth",
                after: { lockedUntil: user.lockedUntil },
              });
            }
            await user.save();
            return null;
          }

          // Employee-linked accounts inherit their posting from the employee record.
          let employeeId: string | null = null;
          let branchId: string | null = null;
          let divisionId: string | null = null;
          let employeeName: string | null = null;

          if (user.employeeId) {
            const employee = await Employee.findById(user.employeeId).select(
              "name status branchId divisionId"
            );
            if (!employee) return null;
            if (employee.status !== "active" && employee.status !== "onboarding") {
              return null; // suspended / resigned employees cannot sign in
            }
            employeeId = employee._id.toString();
            employeeName = employee.name;
            branchId = employee.branchId?.toString() ?? null;
            divisionId = employee.divisionId?.toString() ?? null;
          }

          const role = user.roleId as unknown as { name?: string } | null;
          if (!role?.name) return null;

          user.failedLoginAttempts = 0;
          user.lockedUntil = null;
          user.lastLoginAt = new Date();
          await user.save();
          resetRateLimit(accountKey);

          void logActivity({
            userId: user._id.toString(),
            action: "LOGIN",
            module: "auth",
            after: { role: role.name },
          });

          return {
            id: user._id.toString(),
            credentialStamp: sha256(user.passwordHash),
            email: user.email,
            name: employeeName ?? role.name,
            role: role.name,
            employeeId,
            branchId,
            divisionId,
            employeeName,
            mustChangePassword: Boolean(user.mustChangePassword),
          };
        } catch (error) {
          // An outage is not a credential failure. Returning null here would
          // tell the user their password is wrong while the database is simply
          // unreachable, so that case is re-raised with its own code.
          if (isDbUnreachable(error)) {
            console.error("[AUTH] database unreachable during sign-in:", (error as Error).message);
            throw new DatabaseUnavailableError();
          }
          console.error("[AUTH] authorize failed:", (error as Error).message);
          return null;
        }
      },
    }),
    ...(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET ? [{
      id: "corporate-sso",
      name: process.env.OIDC_NAME || "SSO Perusahaan",
      type: "oidc" as const,
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      checks: ["pkce" as const, "state" as const],
      async profile(profile: Record<string, unknown>) {
        const entitlement = await getEntitlements();
        if (!["active", "grace"].includes(entitlement.status) || !entitlement.features.includes("integration.sso")) throw new Error("SSO memerlukan paket Pro aktif.");
        const email = String(profile.email ?? "").trim().toLowerCase();
        if (!email || profile.email_verified === false) throw new Error("Akun SSO harus memiliki email terverifikasi.");
        await connectToDatabase();
        const current = await User.findOne({ email, isActive: { $ne: false } }).populate("roleId", "name");
        if (!current?.passwordHash) throw new Error("Akun SSO belum ditautkan ke pengguna HRIS aktif.");
        const employee = current.employeeId ? await Employee.findById(current.employeeId).select("name status branchId divisionId") : null;
        if (current.employeeId && (!employee || !["active", "onboarding"].includes(employee.status))) throw new Error("Status karyawan tidak aktif.");
        const role = current.roleId as unknown as { name?: string } | null;
        if (!role?.name) throw new Error("Peran pengguna belum diatur.");
        return { id: String(current._id), email, name: employee?.name ?? email, role: role.name, employeeId: employee?._id.toString() ?? null, branchId: employee?.branchId?.toString() ?? null, divisionId: employee?.divisionId?.toString() ?? null, employeeName: employee?.name ?? null, mustChangePassword: false, credentialStamp: sha256(current.passwordHash) };
      },
    }] : []),
  ],
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
});

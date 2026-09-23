"use client";

import React, { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell, PasswordInput } from "@/components/auth/AuthShell";
import { Alert, Button, Field, Input } from "@/components/ui";

function AdminLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      redirect: false,
      email: email.trim(),
      password,
    }).catch(() => null);

    if (!res || res.error) {
      // A database outage is not a credential problem, and telling an
      // administrator their password is wrong during one sends them to reset a
      // password that works. Auth.js carries the specific reason in `code`.
      setError(
        res?.code === "db_unavailable"
          ? "Server basis data sedang tidak dapat dihubungi, jadi login belum bisa diproses. " +
              "Kata sandi Anda tidak bermasalah. Coba lagi beberapa saat lagi, atau periksa " +
              "koneksi basis data bila terus berulang."
          : "Email atau kata sandi salah, atau akun ini tidak memiliki akses administrasi. " +
              "Akun akan terkunci sementara setelah beberapa percobaan gagal."
      );
      setLoading(false);
      return;
    }

    // The proxy sends a non-admin role back to the portal, so this is a hint
    // rather than an authorisation decision.
    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <AuthShell
      badge="Panel Administrasi"
      title="Masuk sebagai pengelola"
      subtitle="Khusus Superadmin, HRD, Direksi, Audit, GA, dan SPV."
      footer={
        <>
          Karyawan biasa?{" "}
          <Link href="/auth/login" className="font-semibold text-primary hover:underline">
            Masuk lewat portal karyawan
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Email administrator" htmlFor="admin-email" required>
          <Input
            id="admin-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@perusahaan.com"
          />
        </Field>

        <Field label="Kata sandi" htmlFor="admin-password" required>
          <PasswordInput id="admin-password" value={password} onChange={setPassword} placeholder="••••••••" />
        </Field>

        <div className="flex justify-end">
          <Link href="/auth/forgot-password" className="text-caption font-semibold text-primary hover:underline">
            Lupa kata sandi?
          </Link>
        </div>

        <Button type="submit" loading={loading} className="w-full justify-center" size="lg">
          {loading ? "Memverifikasi…" : "Masuk ke panel admin"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center bg-background">
          <div className="skeleton w-64 h-40 rounded-xl" />
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}

"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Moon, ShieldCheck, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { ICON_STROKE } from "@/components/ui";

/**
 * Shared chrome for every unauthenticated page.
 *
 * A single centred column on the tinted ground, with the brand mark doing the
 * work a hero image would otherwise do. Nothing decorative competes with the
 * form, which is the only thing anyone is here to use.
 */
export function AuthShell({
  title,
  subtitle,
  badge,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-16 shrink-0 flex items-center justify-between px-5 max-w-5xl mx-auto w-full">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-2.5 py-1.5 -ml-2.5 rounded-[var(--radius-control)] text-body-sm font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={ICON_STROKE} />
          Beranda
        </Link>
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
          className="p-2 rounded-[var(--radius-control)] text-subtle hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
        >
          {theme === "dark" ? (
            <Sun className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
          ) : (
            <Moon className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
          )}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="text-center mb-8">
            <span className="inline-grid place-items-center w-12 h-12 rounded-[14px] bg-primary text-primary-foreground font-semibold text-body mb-5">
              HR
            </span>
            {badge && <p className="eyebrow mb-2.5">{badge}</p>}
            <h1 className="text-display-sm text-heading">{title}</h1>
            <p className="mt-2.5 text-body text-muted leading-relaxed">{subtitle}</p>
          </div>

          <div className="card p-6 sm:p-7">{children}</div>

          {footer && <div className="mt-6 text-center text-body-sm text-muted">{footer}</div>}
        </div>
      </main>

      <footer className="shrink-0 py-6 px-5">
        <p className="flex items-center justify-center gap-2 text-label text-subtle">
          <ShieldCheck className="w-4 h-4" strokeWidth={ICON_STROKE} />
          Aktivitas login dicatat untuk keperluan audit keamanan.
        </p>
      </footer>
    </div>
  );
}

/** Password field with a show/hide toggle that stays keyboard accessible. */
export function PasswordInput({
  value,
  onChange,
  id,
  placeholder,
  autoComplete = "current-password",
  required = true,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full h-11 rounded-[var(--radius-control)] bg-surface border border-line pl-3.5 pr-12 text-body text-foreground placeholder:text-subtle transition-colors hover:border-line-strong focus:border-primary"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        className="absolute right-1 top-1 h-9 w-10 grid place-items-center rounded-lg text-subtle hover:text-foreground hover:bg-surface-2 cursor-pointer transition-colors"
      >
        {visible ? (
          <EyeOff className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
        ) : (
          <Eye className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
        )}
      </button>
    </div>
  );
}

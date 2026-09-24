"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  BookOpen,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { NotificationBell } from "./NotificationBell";
import { cn, ICON_STROKE, type IconType } from "@/components/ui";
import { TIMEZONE } from "@/lib/time";

export interface NavItem {
  name: string;
  href: string;
  icon: IconType;
  /** Roles allowed to see the link. Omit for everyone. */
  roles?: string[];
  permission?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/* ------------------------------------------------------------------ */
/* WIB clock                                                           */
/* ------------------------------------------------------------------ */

function useWibNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Starts null so the server and the first client render agree; the clock
    // appears on the first tick instead of causing a hydration mismatch.
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function fmt(now: Date | null, opts: Intl.DateTimeFormatOptions, fallback: string) {
  return now ? new Intl.DateTimeFormat("id-ID", { timeZone: TIMEZONE, ...opts }).format(now) : fallback;
}

function ClockPanel() {
  const now = useWibNow();
  return (
    <div className="rounded-[var(--radius-control)] bg-surface-2 border border-line px-3.5 py-3">
      <p className="text-title-sm font-semibold text-heading tabular-nums tracking-[-0.02em] leading-none">
        {fmt(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }, "--:--:--")}
        <span className="text-label font-medium text-subtle ml-1.5 tracking-normal">WIB</span>
      </p>
      <p className="text-label text-muted mt-1.5 truncate">
        {fmt(now, { weekday: "long", day: "numeric", month: "long" }, "Memuat…")}
      </p>
    </div>
  );
}

function ClockInline() {
  const now = useWibNow();
  return (
    <span className="hidden md:flex items-baseline gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-line">
      <span className="text-body-sm font-semibold text-foreground tabular-nums">
        {fmt(now, { hour: "2-digit", minute: "2-digit", hour12: false }, "--:--")}
      </span>
      <span className="text-caption font-medium text-subtle">WIB</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Gunakan tampilan terang" : "Gunakan tampilan gelap"}
      title={theme === "dark" ? "Tampilan terang" : "Tampilan gelap"}
      className="p-2 rounded-[var(--radius-control)] text-subtle hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
    >
      {theme === "dark" ? (
        <Sun className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
      ) : (
        <Moon className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
      )}
    </button>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const user = session?.user;

  const initials = useMemo(() => {
    const source = user?.employeeName || user?.name || user?.email || "?";
    return source
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Menu akun"
        className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-full hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground grid place-items-center text-label font-semibold shrink-0">
          {initials || <UserRound className="w-4 h-4" strokeWidth={ICON_STROKE} />}
        </span>
        <span className="hidden lg:block text-left min-w-0">
          <span className="block text-body-sm font-medium text-foreground truncate max-w-36 leading-tight">
            {user?.employeeName || user?.email || "Pengguna"}
          </span>
          <span className="block text-caption text-subtle leading-tight mt-0.5">{user?.role ?? "-"}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-subtle hidden lg:block" strokeWidth={ICON_STROKE} />
      </button>

      {open && (
        <div
          className="card absolute right-0 mt-2 w-64 z-50 animate-fade-up overflow-hidden"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className="px-4 py-3.5 border-b border-line">
            <p className="text-body font-semibold text-heading truncate">
              {user?.employeeName || "Pengguna"}
            </p>
            <p className="text-label text-muted truncate mt-0.5">{user?.email}</p>
            <p className="text-caption text-subtle mt-1.5">Peran {user?.role}</p>
          </div>
          <div className="p-1.5">
            <MenuLink href="/portal/profile" icon={UserRound} onClick={() => setOpen(false)}>
              Profil &amp; keamanan
            </MenuLink>
            <MenuLink href="/docs" icon={BookOpen} onClick={() => setOpen(false)}>
              Panduan penggunaan
            </MenuLink>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-body-sm text-danger hover:bg-danger-soft transition-colors cursor-pointer font-medium"
            >
              <LogOut className="w-4 h-4" strokeWidth={ICON_STROKE} />
              Keluar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  onClick,
  children,
}: {
  href: string;
  icon: IconType;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-body-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
    >
      <Icon className="w-4 h-4" strokeWidth={ICON_STROKE} />
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/**
 * The single layout both the admin CMS and the employee portal render inside.
 *
 * The sidebar is a flat rail: the active item is a tinted pill rather than a
 * filled dark block, which keeps the brand colour meaning "this is where you
 * are" instead of competing with every primary button on the page.
 */
export function AppShell({
  sections,
  brand,
  brandHref,
  children,
}: {
  sections: NavSection[];
  brand: { title: string; subtitle: string };
  brandHref: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = session?.user?.role;
  const [disciplineAccess, setDisciplineAccess] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/v1/discipline?view=access", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        const body = r.ok ? await r.json().catch(() => null) : null;
        if (active) setDisciplineAccess(r.ok && body?.data?.available !== false);
      })
      .catch(() => { if (active) setDisciplineAccess(false); });
    return () => { active = false; };
  }, [role]);

  // Links the current role cannot use are removed rather than shown disabled —
  // a menu that only leads to "access denied" is worse than a shorter menu.
  const visibleSections = useMemo(
    () =>
      sections
        .map((s) => ({ ...s, items: s.items.filter((i) => (!i.roles || !role || i.roles.includes(role)) && (!i.permission || disciplineAccess)) }))
        .filter((s) => s.items.length > 0),
    [sections, role, disciplineAccess]
  );

  useEffect(() => setMobileOpen(false), [pathname]);

  const currentTitle = useMemo(() => {
    for (const s of visibleSections) {
      const hit = s.items.find((i) => i.href === pathname);
      if (hit) return hit.name;
    }
    return brand.title;
  }, [visibleSections, pathname, brand.title]);

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
      {visibleSections.map((section) => (
        <div key={section.label}>
          <p className="eyebrow px-3 mb-2">{section.label}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-control)] text-body-sm transition-colors",
                      active
                        ? "bg-primary-soft text-primary font-semibold"
                        : "text-muted hover:text-foreground hover:bg-surface-2 font-medium"
                    )}
                  >
                    {/* A short rule at the left edge marks the active item even
                        for viewers who cannot distinguish the tint. */}
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary"
                        aria-hidden
                      />
                    )}
                    <Icon
                      className={cn("w-[18px] h-[18px] shrink-0", active ? "text-primary" : "text-subtle")}
                      strokeWidth={ICON_STROKE}
                    />
                    <span className="truncate">{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brandBlock = (
    <Link href={brandHref} className="flex items-center gap-3 min-w-0">
      <span className="w-9 h-9 rounded-[10px] bg-primary text-primary-foreground grid place-items-center font-semibold text-body-sm shrink-0">
        HR
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-body text-heading truncate leading-tight">
          {brand.title}
        </span>
        <span className="block text-caption text-subtle truncate leading-tight mt-0.5">
          {brand.subtitle}
        </span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop rail */}
      <aside className="w-[248px] shrink-0 border-r border-line bg-surface hidden lg:flex flex-col">
        <div className="px-4 h-16 flex items-center border-b border-line">{brandBlock}</div>
        {nav}
        <div className="p-3 border-t border-line">
          <ClockPanel />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          style={{ background: "var(--overlay)" }}
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="w-[280px] max-w-[85vw] h-full bg-surface border-r border-line flex flex-col animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 h-16 flex items-center justify-between gap-2 border-b border-line">
              {brandBlock}
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Tutup menu"
                className="p-1.5 rounded-lg text-subtle hover:text-foreground hover:bg-surface-2 cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={ICON_STROKE} />
              </button>
            </div>
            {nav}
            <div className="p-3 border-t border-line">
              <ClockPanel />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-line bg-surface/85 backdrop-blur-md flex items-center justify-between gap-3 px-4 md:px-6 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden p-2 -ml-1 rounded-[var(--radius-control)] text-muted hover:bg-surface-2 cursor-pointer"
            >
              <Menu className="w-5 h-5" strokeWidth={ICON_STROKE} />
            </button>
            <h1 className="text-body-lg font-semibold text-heading truncate">{currentTitle}</h1>
          </div>

          <div className="flex items-center gap-1.5">
            <ClockInline />
            <NotificationBell />
            <ThemeToggle />
            <span className="w-px h-6 bg-line mx-1 hidden sm:block" aria-hidden />
            <UserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-1 p-5 md:p-7 lg:p-8 min-w-0">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

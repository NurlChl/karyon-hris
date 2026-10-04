"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import { DEFAULT_BRANDING, type AppBranding } from "@/lib/branding/defaults";

const BrandingContext = createContext<AppBranding>(DEFAULT_BRANDING);

/** Provided once by the root layout so every shell renders the same logo without a flash. */
export function BrandingProvider({ value, children }: { value: AppBranding; children: React.ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
export const useBranding = () => useContext(BrandingContext);

/**
 * `full` is the logo with its wordmark (light and dark variants swap with the
 * theme); `mark` is only the symbol, for tight spaces.
 */
export function BrandLogo({ variant = "full", height = 32, className = "" }: { variant?: "full" | "mark"; height?: number; className?: string }) {
  const brand = useBranding();
  /* eslint-disable @next/next/no-img-element -- logo files of unknown size, possibly data URLs from the Pro setting */
  if (variant === "mark") return <img src={brand.mark} alt={brand.name} className={`block shrink-0 object-contain ${className}`} style={{ height, width: "auto" }} />;
  return (
    <>
      <img src={brand.logo} alt={brand.name} className={`block w-auto max-w-[180px] object-contain dark:hidden ${className}`} style={{ height }} />
      <img src={brand.logoDark} alt="" aria-hidden="true" className={`hidden w-auto max-w-[180px] object-contain dark:block ${className}`} style={{ height }} />
    </>
  );
  /* eslint-enable @next/next/no-img-element */
}

/** Logo that links somewhere (home, dashboard), with an optional small caption beside it. */
export function BrandLink({ href, caption, height = 30, className = "" }: { href: string; caption?: string; height?: number; className?: string }) {
  const brand = useBranding();
  return (
    <Link href={href} className={`flex items-center gap-2.5 min-w-0 ${className}`} aria-label={`${brand.name} — ${caption ?? "beranda"}`}>
      <BrandLogo height={height} />
      {caption && <span className="min-w-0 truncate border-l border-line pl-2.5 text-caption font-semibold text-subtle">{caption}</span>}
    </Link>
  );
}

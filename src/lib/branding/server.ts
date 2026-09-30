import "server-only";
import { DEFAULT_BRANDING, type AppBranding } from "./defaults";

/**
 * Community always shows the bundled logo. The Pro distribution replaces this
 * module with one that reads the logo uploaded in Admin → Logo & Tampilan
 * while the license is active.
 */
export async function getBranding(): Promise<AppBranding> {
  return DEFAULT_BRANDING;
}

/** Kept for API parity with the Pro module. */
export function clearBrandingCache() {}

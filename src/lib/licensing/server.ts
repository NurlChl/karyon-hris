import "server-only";
import { COMMUNITY_ENTITLEMENTS, type ProFeature } from "./features";
/** Which build is running: the Pro distribution replaces this module. */
export const EDITION: "community" | "pro" = "community";
/** Community contains no private activation or entitlement implementation. */
export async function getEntitlements(_force=false){return COMMUNITY_ENTITLEMENTS;}
/** Kept for API parity with the Pro module; Community has no lease cache. */
export function clearEntitlementCache(){}
export async function requireProFeature(_feature:ProFeature){const {Forbidden}=await import("@/lib/guard");throw Forbidden("Fitur ini tersedia pada HRIS Pro dengan lisensi aktif. Aktifkan di menu Lisensi & Paket.");}

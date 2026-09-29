"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export type LicenseStatus = "active" | "grace" | "expired" | "unlicensed" | "suspended";

export interface LicenseState {
  edition: "community" | "pro";
  plan: string;
  status: LicenseStatus;
  features: string[];
  expiresAt: string | null;
  graceUntil: string | null;
}

let shared: Promise<LicenseState | null> | null = null;
let sharedAt = 0;
const TTL_MS = 30_000;

/** One request per page load for every component that needs the license. */
function loadLicense(force = false): Promise<LicenseState | null> {
  if (!force && shared && Date.now() - sharedAt < TTL_MS) return shared;
  sharedAt = Date.now();
  shared = api
    .get<LicenseState>("/api/v1/license", { cache: "no-store" })
    .then((res) => res.data ?? null)
    .catch(() => null);
  return shared;
}

export function invalidateLicense() {
  shared = null;
}

/** True when the running build is Pro and the signed lease grants `feature`. */
export function hasFeature(license: LicenseState | null, feature: string) {
  return !!license && license.edition === "pro" && ["active", "grace"].includes(license.status) && license.features.includes(feature);
}

export function useLicense() {
  const [license, setLicense] = useState<LicenseState | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void loadLicense().then((value) => {
      if (!active) return;
      setLicense(value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);
  return { license, loading };
}

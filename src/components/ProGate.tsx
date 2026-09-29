"use client";

import type { ReactNode } from "react";
import { ProFeatureNotice } from "@/components/ProFeatureNotice";
import { Skeleton } from "@/components/ui";
import { hasFeature, useLicense } from "@/lib/use-license";

/**
 * Wraps a Pro page. While the lease grants the feature the page renders as
 * usual; once the license expires, is suspended or is replaced, the page falls
 * back to the Community notice instead of a stream of 403 toasts. Data stays in
 * the database and returns as soon as a valid license is activated again.
 */
export function ProGate({
  feature,
  title,
  description,
  included,
  children,
}: {
  feature: string;
  title: string;
  description: string;
  included: string[];
  children: ReactNode;
}) {
  const { license, loading } = useLicense();
  if (loading) return <Skeleton className="h-48" />;
  if (hasFeature(license, feature)) return <>{children}</>;
  return (
    <ProFeatureNotice
      title={title}
      description={description}
      included={included}
      reason={license?.edition === "pro" ? (license.status === "expired" || license.status === "suspended" ? "expired" : "inactive") : "community"}
    />
  );
}

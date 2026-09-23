"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ErrorState, SkeletonList } from "@/components/ui";
import { Paper, PrintShell } from "@/components/print/PrintShell";
import {
  PayslipDocument,
  type PayslipData,
  type PayslipTemplateShape,
} from "@/components/print/PayslipDocument";
import { api, errorMessage } from "@/lib/client-api";
import { formatPeriod } from "@/lib/time";

export default function PayslipPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 max-w-3xl mx-auto"><SkeletonList rows={3} /></div>}>
      <PayslipPrint />
    </Suspense>
  );
}

function PayslipPrint() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const templateId = search.get("template");
  const autoPrint = search.get("print") === "1";

  const [doc, setDoc] = useState<{ template: PayslipTemplateShape; data: PayslipData } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const qs = new URLSearchParams({ id: params.id });
      if (templateId) qs.set("templateId", templateId);
      const res = await api.get<{ template: PayslipTemplateShape; data: PayslipData }>(
        `/api/v1/payroll/document?${qs}`
      );
      setDoc(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.id, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <ErrorState message={error || "Dokumen tidak tersedia."} onRetry={load} />
      </div>
    );
  }

  return (
    <PrintShell
      backHref="/portal/payroll"
      backLabel="Kembali ke slip gaji"
      title={`Slip gaji ${formatPeriod(doc.data.period)}`}
      subtitle={`${doc.data.employee.name} · ${doc.data.employee.employeeId}`}
      paperSize={doc.template.paperSize}
      autoPrint={autoPrint}
    >
      <Paper
        size={doc.template.paperSize}
        margin={doc.template.margin}
        fontSize={doc.template.baseFontSize}
      >
        <PayslipDocument template={doc.template} data={doc.data} />
      </Paper>
    </PrintShell>
  );
}

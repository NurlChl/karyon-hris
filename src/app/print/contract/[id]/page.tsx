"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Alert, ErrorState, SkeletonList } from "@/components/ui";
import { Paper, PrintShell } from "@/components/print/PrintShell";
import { ContractDocument } from "@/components/print/ContractDocument";
import { api, errorMessage } from "@/lib/client-api";
import { contractTypeLabel } from "@/lib/hr/contracts";

interface ContractDetail {
  contract: { _id: string; contractNumber: string; type: string; customTypeLabel?: string; body: string; employeeId: { name: string } | null };
  values: Record<string, string>;
  branding: {
    companyName: string;
    companyAddress: string;
    showLogo: boolean;
    logoUrl: string;
    logoHeight: number;
    signerName: string;
    signerTitle: string;
  };
}

export default function ContractPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 max-w-3xl mx-auto"><SkeletonList rows={3} /></div>}>
      <ContractPrint />
    </Suspense>
  );
}

function ContractPrint() {
  const params = useParams<{ id: string }>();
  const autoPrint = useSearchParams().get("print") === "1";
  const { data: session } = useSession();
  const [data, setData] = useState<ContractDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get<ContractDetail>(`/api/v1/contracts/${params.id}`);
      setData(res.data ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="p-8 max-w-xl mx-auto"><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div className="p-8 max-w-3xl mx-auto"><SkeletonList rows={4} /></div>;

  const isStaff = session?.user?.role === "STAFF";
  const { contract } = data;

  return (
    <PrintShell
      backHref={isStaff ? "/portal/profile?tab=contract" : `/admin/contracts?open=${contract._id}`}
      backLabel="Kembali"
      title={`Kontrak ${contract.contractNumber}`}
      subtitle={`${contract.employeeId?.name ?? ""} · ${contractTypeLabel(contract.type, contract.customTypeLabel)}`}
      autoPrint={autoPrint && Boolean(contract.body)}
    >
      {!contract.body ? (
        <div className="max-w-[820px] mx-auto">
          <Alert tone="warning" title="Kontrak ini belum punya isi dokumen">
            Kontrak dibuat tanpa template. Pilih template atau tulis isinya dari halaman kontrak, atau unggah berkas yang sudah ditandatangani.
          </Alert>
        </div>
      ) : (
        <Paper size="A4" margin={20} fontSize={12}>
          <ContractDocument content={contract.body} values={data.values} branding={data.branding} />
        </Paper>
      )}
    </PrintShell>
  );
}

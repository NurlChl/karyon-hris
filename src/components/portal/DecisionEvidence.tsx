import Link from "next/link";
import type { DecisionEvidence as Evidence } from "@/lib/hr/policy-evidence";
import { formatRupiah } from "@/lib/time";

export function DecisionEvidence({ evidence }: { evidence?: Evidence | null }) {
  return <section className="space-y-3 rounded-lg border border-line p-4">
    <h3 className="text-title-sm text-heading">Bukti keputusan potongan presensi</h3>
    {!evidence ? <p className="text-body-sm text-muted">Snapshot belum tersedia untuk slip lama atau slip unggahan. Hubungi HR untuk rincian; sistem tidak menghitung ulang bukti historis dari pengaturan terbaru.</p> : <>
      <p className="text-body-sm text-muted">Snapshot {new Date(evidence.capturedAt).toLocaleString("id-ID")} · mesin {evidence.engineVersion}</p>
      <dl className="space-y-2 text-body-sm">
        <div><dt>Keterlambatan</dt><dd>{evidence.policy.lateUnit === "day" ? `${evidence.facts.lateDays} hari terlambat` : evidence.policy.lateUnit === "hour" ? `${evidence.facts.lateMinutes / 60} jam` : `${evidence.facts.lateMinutes} menit`} × {formatRupiah(evidence.policy.latePerMinute)}; batas bulanan {evidence.policy.latePenaltyCap ? formatRupiah(evidence.policy.latePenaltyCap) : "tanpa batas"}{evidence.facts.exemptLate ? "; dikecualikan" : ""} → {formatRupiah(evidence.result.late)}</dd></div>
        <div><dt>Alpha</dt><dd>{evidence.facts.absentDays} hari × {formatRupiah(evidence.policy.absentPerDay)}{evidence.facts.exemptAbsent ? "; dikecualikan" : ""} → {formatRupiah(evidence.result.absent)}</dd></div>
      </dl>
      {!!evidence.convertedDates?.length && <p className="text-body-sm">Menjadi alpha karena terlambat lebih dari {evidence.policy.alphaAfterHours} jam: {evidence.convertedDates.join(", ")}. Tidak dipotong telat lagi.</p>}
      {evidence.capExceeded && <p className="text-body-sm">Potongan sebelum plafon: {formatRupiah(evidence.uncappedLate)}. Pelampauan batas perlu ditinjau HR; tidak berarti sanksi otomatis.</p>}
      <details><summary className="cursor-pointer text-primary">Lihat data sumber dan identitas aturan</summary>
        <p className="text-caption break-all mt-2">Fingerprint aturan: {evidence.rulesFingerprint}. Ini identitas parameter, bukan tanda tangan digital atau bukti persetujuan.</p>
        <ul className="text-body-sm mt-2 space-y-1">{evidence.attendance.map((row) => <li key={row.id}>{row.date}: {row.lateMinutes} menit terlambat · referensi {row.id}</li>)}</ul>
        <p className="text-body-sm mt-2">Tanggal alpha: {evidence.absentDates.join(", ") || "Tidak ada"}</p>
      </details>
    </>}
    <p className="text-caption text-muted">Data tidak sesuai? Ajukan koreksi melalui tab Koreksi Absen. Persetujuan koreksi tidak otomatis mengubah slip yang sudah terbit; HR perlu meninjau dampaknya.</p>
    <Link className="text-primary underline text-body-sm" href="/portal/attendance?tab=corrections">Ajukan / pantau koreksi presensi →</Link>
  </section>;
}

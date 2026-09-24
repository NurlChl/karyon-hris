import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Slip Gaji"
      description="Perhitungan dan penerbitan slip gaji perusahaan."
      included={["Perhitungan payroll dari presensi, lembur, dan potongan", "Profil gaji karyawan dan komponen tunjangan", "Penerbitan slip dan bukti keputusan per karyawan"]}
    />
  );
}

import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Disiplin & SP"
      description="Catat pembinaan, teguran, dan surat peringatan secara berjenjang."
      included={["Kasus disiplin terhubung ke karyawan dan atasan langsung", "Persetujuan berjenjang dengan riwayat keputusan", "Hak akses per peran dan lingkup"]}
    />
  );
}

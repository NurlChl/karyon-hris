import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Riwayat Disiplin Karyawan"
      description="Profil kerja terbatas dan riwayat tindakan disiplin."
      included={["Riwayat kasus per karyawan", "Tautan ke dialog tinjauan kasus"]}
    />
  );
}

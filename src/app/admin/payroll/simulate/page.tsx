import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Ruang Uji Kebijakan"
      description="Bandingkan dampak aturan potongan sebelum diberlakukan."
      included={["Simulasi tarif terlambat dan alpha tanpa mengubah payroll", "Perbandingan nominal dan catatan sumber per periode"]}
    />
  );
}

import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Template Slip Gaji"
      description="Susun tata letak dan komponen slip gaji perusahaan."
      included={["Editor blok slip gaji", "Pratinjau cetak dengan data karyawan"]}
    />
  );
}

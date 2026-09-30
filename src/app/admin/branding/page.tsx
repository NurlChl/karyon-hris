import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Logo & Tampilan"
      description="Tampilkan logo perusahaan Anda di dashboard admin, portal karyawan, halaman masuk, dan halaman karier."
      included={["Unggah logo untuk tema terang dan gelap serta simbol/ikon", "Berlaku untuk semua pengguna tanpa build ulang", "Kembali ke logo bawaan kapan saja"]}
    />
  );
}

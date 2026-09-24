import { ProFeatureNotice } from "@/components/ProFeatureNotice";

export default function ProFeature() {
  return (
    <ProFeatureNotice
      title="Integrasi API"
      description="Hubungkan HRIS dengan sistem lain memakai API key yang dibuat dari dashboard."
      included={["API key dengan scope modul × aksi, tidak melebihi izin pembuatnya", "Dokumentasi API interaktif dan OpenAPI 3.1", "Aktif/nonaktif dan cabut key kapan saja, tercatat di audit"]}
    />
  );
}

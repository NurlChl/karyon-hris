"use client";

import {
  BookOpen,
  Boxes,
  CalendarRange,
  Cake,
  Fingerprint,
  MessageSquareWarning,
  ReceiptText,
  ScrollText,
  Repeat2,
  Target,
  UserRound,
} from "lucide-react";
import { AppShell, type NavSection } from "@/components/shell/AppShell";

/**
 * Employee self-service navigation, grouped by what the person is trying to do
 * rather than by which module the feature belongs to. Icons match the ones used
 * for the same concept on the landing page and in the admin panel.
 */
const sections: NavSection[] = [
  {
    label: "Kehadiran",
    items: [
      { name: "Presensi Mandiri", href: "/portal/attendance", icon: Fingerprint },
      { name: "Izin & Cuti", href: "/portal/leave", icon: CalendarRange },
      { name: "Tukar Libur", href: "/portal/holiday-swap", icon: Repeat2 },
    ],
  },
  {
    label: "Kepegawaian",
    items: [
      { name: "Slip Gaji Saya", href: "/portal/payroll", icon: ReceiptText },
      { name: "Ulang Tahun", href: "/portal/birthdays", icon: Cake },
      { name: "Penilaian Kinerja", href: "/portal/kpi", icon: Target },
      { name: "Inventaris Saya", href: "/portal/inventory", icon: Boxes },
      { name: "Pengaduan", href: "/portal/complaints", icon: MessageSquareWarning },
      { name: "Disiplin & SP", href: "/admin/discipline", icon: ScrollText, permission: "discipline" },
    ],
  },
  {
    label: "Akun",
    items: [
      { name: "Profil & Keamanan", href: "/portal/profile", icon: UserRound },
      { name: "Panduan Penggunaan", href: "/portal/help", icon: BookOpen },
    ],
  },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      sections={sections}
      brand={{ title: "HRIS Portal", subtitle: "Ruang kerja karyawan" }}
      brandHref="/portal/attendance"
    >
      {children}
    </AppShell>
  );
}

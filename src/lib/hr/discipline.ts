export const DISCIPLINE_ACTIONS = ["coaching", "warning", "sp1", "sp2", "sp3", "termination", "resignation", "other"] as const;
export const DISCIPLINE_LABELS: Record<typeof DISCIPLINE_ACTIONS[number], string> = {
  coaching: "Pembinaan", warning: "Teguran", sp1: "SP1", sp2: "SP2", sp3: "SP3", termination: "PHK / pemutusan hubungan kerja", resignation: "Pengunduran diri", other: "Tindakan lain",
};

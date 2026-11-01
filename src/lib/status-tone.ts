// One meaning per color: red = stopped or late, amber = needs a check, emerald = done, blue = moving, violet = planned.
const tones = {
  red: "border-red-300 bg-red-50 text-red-700",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
  blue: "border-blue-300 bg-blue-50 text-blue-800",
  violet: "border-violet-300 bg-violet-100 text-violet-800",
  neutral: "border-border bg-muted text-foreground",
} as const;

const statusTones: Record<string, keyof typeof tones> = {
  OVERDUE: "red", REJECTED: "red", DECLINED: "red",
  APPROVAL_PENDING: "amber", WAITING_PAYMENT: "amber", PARTIALLY_PAID: "amber", REVIEWING: "amber", OCR_PENDING: "amber", ON_HOLD: "amber", WAITING: "amber",
  PAID: "emerald", COMPLETED: "emerald", ACCEPTED: "emerald", CONVERTED: "emerald",
  IN_PROGRESS: "blue", ISSUED: "blue", SENT: "blue", SCHEDULED: "blue", RECEIVED: "blue",
  PLANNING: "violet",
};

export function statusToneClass(status: string) {
  return tones[statusTones[status] || "neutral"];
}

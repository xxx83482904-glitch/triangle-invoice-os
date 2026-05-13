export const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

export const number = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
});

export function formatDate(value?: string | Date | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function monthKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

import { formatMoney, type MoneyFormatOptions } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ value, sign, maximumFractionDigits, notation, tone = "plain", className }: MoneyFormatOptions & {
  value: number;
  tone?: "plain" | "income" | "muted";
  className?: string;
}) {
  return <span className={cn("whitespace-nowrap tabular-nums", tone === "income" && "text-emerald-700 dark:text-emerald-400", tone === "muted" && "text-muted-foreground", className)}>{formatMoney(value, { sign, maximumFractionDigits, notation })}</span>;
}

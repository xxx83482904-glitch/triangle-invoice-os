import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ value, sign, tone = "plain", className }: {
  value: number;
  sign?: "negative" | "always" | "never";
  tone?: "plain" | "income" | "muted";
  className?: string;
}) {
  return <span className={cn("whitespace-nowrap tabular-nums", tone === "income" && "text-emerald-700 dark:text-emerald-400", tone === "muted" && "text-muted-foreground", className)}>{formatMoney(value, { sign })}</span>;
}

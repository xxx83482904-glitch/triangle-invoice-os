import { hiddenAmountLabel } from "@/lib/issued-amount-access";

/** Shown in place of an amount the server did not send (someone else's invoice or estimate). */
export function HiddenAmount({ className }: { className?: string }) {
  return <span role="img" aria-label={hiddenAmountLabel} title={hiddenAmountLabel} className={className}>—</span>;
}

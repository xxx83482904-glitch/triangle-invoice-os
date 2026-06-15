"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Undo2 } from "lucide-react";
import { undoLastAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

type UndoButtonProps = {
  disabled?: boolean;
  compact?: boolean;
};

export function UndoButton({ disabled = false, compact = false }: UndoButtonProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnPath = `${pathname}${query ? `?${query}` : ""}`;

  return (
    <form
      action={undoLastAction}
      onSubmit={(event) => {
        if (!window.confirm("最後の操作を取り消しますか？")) event.preventDefault();
      }}
    >
      <input type="hidden" name="returnPath" value={returnPath} />
      <Button
        type="submit"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        className={compact ? "h-9 w-9 rounded-lg" : "w-full justify-start gap-2 rounded-lg"}
        disabled={disabled}
        title={disabled ? "取り消せる操作がありません" : "最後の操作を取り消す"}
      >
        <Undo2 className="h-4 w-4" />
        {compact ? <span className="sr-only">元に戻す</span> : <span>元に戻す</span>}
      </Button>
    </form>
  );
}

"use client";

import { useActionState, useRef, useState, type RefObject } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { createUserAccountAction } from "./actions";
import { UserAccountFields, type AccountRoleOption } from "./user-account-fields";

type ActionState = { error: string; success?: boolean };

export function UserAccountCreator({ roles }: { roles: AccountRoleOption[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={triggerRef} type="button" className="h-11 w-full sm:w-auto lg:h-9" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <UserPlus className="size-4" />メンバーを追加
    </Button>
    {open ? <CreateUserAccountDialog roles={roles} triggerRef={triggerRef} onClose={() => setOpen(false)} /> : null}
  </>;
}

function CreateUserAccountDialog({ roles, triggerRef, onClose }: {
  roles: AccountRoleOption[]; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  const [state, create, pending] = useActionState(async (previous: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      const result = await createUserAccountAction(previous, formData);
      if (result.success) {
        toast({ title: "追加しました", variant: "success" });
        onClose();
      }
      return result;
    } catch {
      return { error: "追加できませんでした。通信を確認して、もう一度お試しください。" };
    }
  }, { error: "" });

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[85dvh] min-w-0 overflow-y-auto font-normal sm:max-w-xl" showCloseButton={!pending}
      onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
      <DialogHeader className="min-w-0 pr-10">
        <DialogTitle>メンバーを追加</DialogTitle>
        <DialogDescription>追加したメンバーはすぐにログインできます。</DialogDescription>
      </DialogHeader>
      <form action={create} className="min-w-0 space-y-4" aria-busy={pending}>
        <UserAccountFields roles={roles} pending={pending} />
        {state.error ? <p role="alert" className="break-words text-sm text-destructive">{state.error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} className="h-11 lg:h-9" onClick={onClose}>キャンセル</Button>
          <Button type="submit" disabled={pending} className="h-11 lg:h-9">{pending ? "追加中…" : "追加"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

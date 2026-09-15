"use client";

import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Save } from "lucide-react";
import { saveProjectBasicsAction } from "@/app/partners/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CreatableSelect } from "@/components/app/creatable-select";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ProjectBasicInput } from "@/lib/partner-project-edits";

export type ProjectBasicOption = ProjectBasicInput;
export type ClientOption = { id: string; name: string };
const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";

export function EditableProjectSelect({ company, projects, clients, value, onChange, disabled = false }: {
  company: CompanyScope; projects: ProjectBasicOption[]; clients: ClientOption[]; value: string;
  onChange: (project?: ProjectBasicOption) => void; disabled?: boolean;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, ProjectBasicOption>>({});
  const [editor, setEditor] = useState<ProjectBasicOption | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const formStatus = useFormStatus();
  const locked = disabled || pending || formStatus.pending;
  const options = projects.map((p) => overrides[p.id]?.updatedAt > p.updatedAt ? overrides[p.id] : p);
  const selected = options.find((p) => p.id === value);
  return <div className="min-w-0 space-y-1">
    <span className="text-sm">案件名</span>
    <div className="flex min-w-0 gap-1">
      <select name="projectId" aria-label="案件名" required className={selectClass} value={value} disabled={locked} onChange={(e) => onChange(options.find((p) => p.id === e.target.value))}>
        <option value="">案件を選択</option>{options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" title="選択した案件を編集" aria-label="選択した案件を編集" disabled={locked || !selected} onClick={() => { setEditor(selected ? { ...selected } : null); setError(""); }}><Pencil className="size-4" /></Button>
    </div>
    <Dialog open={!!editor} onOpenChange={(open) => { if (!open && !pending) setEditor(null); }}><DialogContent aria-describedby={undefined} showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>案件を編集</DialogTitle></DialogHeader>
      {editor ? <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault(); e.stopPropagation(); setError("");
        startTransition(async () => {
          try {
            const result = await saveProjectBasicsAction(company, editor);
            if (!result.project) { setError(result.error || "保存に失敗しました"); return; }
            const project = result.project;
            setOverrides((old) => ({ ...old, [project.id]: project }));
            onChange(project); setEditor(null); router.refresh(); toast({ title: "案件を更新しました", variant: "success" });
          } catch { setError("通信に失敗しました。入力内容は保持されています"); }
        });
      }}>
        <label className="block space-y-1 text-sm">案件名<Input aria-label="編集する案件名" required maxLength={500} disabled={pending} value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
        <label className="block space-y-1 text-sm">取引先<select aria-label="案件の取引先" required disabled={pending} className={selectClass} value={editor.clientId} onChange={(e) => setEditor({ ...editor, clientId: e.target.value })}>
          <option value="">取引先を選択</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => setEditor(null)}>キャンセル</Button><Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}案件を保存</Button></div>
      </form> : null}
    </DialogContent></Dialog>
  </div>;
}

export function InvoiceProjectFields({ company, projects, clients }: { company: CompanyScope; projects: ProjectBasicOption[]; clients: ClientOption[] }) {
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    <EditableProjectSelect company={company} projects={projects} clients={clients} value={projectId} onChange={(p) => { setProjectId(p?.id || ""); if (p) setClientId(p.clientId); }} />
    <div className="min-w-0 space-y-1"><span className="text-sm">請求先会社名</span><CreatableSelect ariaLabel="請求先会社名" name="clientId" value={clientId} onValueChange={setClientId} options={clients.map((c) => ({ value: c.id, label: c.name }))} placeholder="請求先を選択" create={{ kind: "client", company }} required /></div>
  </div>;
}

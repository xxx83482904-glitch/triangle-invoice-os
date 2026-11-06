"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Building2, Files, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { dirtyFieldCount, draftOrders, initialShipmentDraft, reconcileShipmentDraft, shipmentUpdate, type DetailOption, type ShipmentDraft } from "@/lib/import-detail-draft";
import type { ImportBoardDocument, ImportShipmentMutation, ImportShipmentView } from "@/lib/import-shipment-views";
import { importRequestedDates, importStageTimeline } from "@/lib/import-shipments";
import { operationFailureToast } from "@/lib/operation-feedback";
import { saveImportShipmentAction } from "../actions";
import { AddDocumentsDialog, DocumentTabs, documentTabs, tabDocuments, type DocumentTab } from "./document-tabs";
import { DocumentViewer } from "./document-viewer";
import { OrderPanel } from "./order-panel";
import { SaveBar } from "./save-bar";
import { CostsSection, ShipmentInfoSection } from "./shipment-sections";
import { MobileSchedule, NextSchedule, StagePanel } from "./stage-panel";

export function ShipmentDetail({ view, today, company, canEdit, clients, projects, vendors, unassigned }: {
  view: ImportShipmentView; today: string; company: CompanyScope; canEdit: boolean;
  clients: DetailOption[]; projects: DetailOption[]; vendors: DetailOption[]; unassigned: ImportBoardDocument[];
}) {
  const router = useRouter(), rootRef = useRef<HTMLDivElement>(null), inFlight = useRef(false);
  const [state, setState] = useState(() => initialShipmentDraft(view));
  const reconciled = reconcileShipmentDraft(state, view);
  if (reconciled !== state) setState(reconciled);
  const { draft, baseline } = state;
  const dirtyCount = dirtyFieldCount(baseline, draft);
  const [pending, start] = useTransition(), [error, setError] = useState("");
  const [mobile, setMobile] = useState<"documents" | "orders">("documents");
  const [selectedTab, setSelectedTab] = useState<DocumentTab>(() => documentTabs.find((tab) => tabDocuments(view.documents, tab.kind).length)?.kind ?? "SUPPLIER_INVOICE");
  const [addOpen, setAddOpen] = useState(false);
  const timeline = importStageTimeline(draft.stages, today), requested = importRequestedDates(draftOrders(draft));
  const attachedKinds = view.checklist.filter((entry) => entry.documents.length).length;
  const itemCount = draft.orders.reduce((count, order) => count + order.items.length, 0);
  const back = `/imports?company=${company}`;
  const change = (next: ShipmentDraft) => setState((current) => ({ ...current, draft: next }));
  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const run = (input: ImportShipmentMutation, success: string) => {
    if (inFlight.current || !canEdit) return;
    inFlight.current = true; setError("");
    start(async () => {
      try {
        const result = await saveImportShipmentAction(company, input);
        if (!result.success) throw new Error(result.error);
        if (result.action === "update" || result.action === "reread") setState((current) => ({ ...current, acceptedVersion: result.updatedAt }));
        toast({ title: success, variant: "success" });
        if (result.action === "delete") router.push(back);
        else router.refresh();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "通信に失敗しました。もう一度お試しください。");
        toast(operationFailureToast(failure));
      } finally { inFlight.current = false; }
    });
  };
  const reset = () => {
    if (!dirtyCount || window.confirm("未保存の変更を戻しますか？")) { setState(initialShipmentDraft(view)); setError(""); }
  };
  const reload = () => {
    if (dirtyCount && !window.confirm("未保存の変更を破棄して最新の便を読み込みますか？")) return;
    setState(initialShipmentDraft(view)); setError(""); start(() => router.refresh());
  };
  return <div ref={rootRef} className={`min-w-0 space-y-4 ${canEdit ? "pb-[var(--import-savebar-height,96px)] lg:pb-0" : ""}`}>
    <header className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-1">
      <Link href={back} prefetch={false} className="inline-flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:w-auto"><ArrowLeft aria-hidden className="size-3.5" />輸入便一覧</Link>
      <h1 className="min-w-0 flex-1 break-words lg:max-w-[40%] lg:flex-initial lg:border-l lg:border-[var(--rule)] lg:pl-4">{draft.title || view.title}</h1>
      {canEdit ? <div className="lg:order-last"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={pending} aria-label="この便の操作"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive" onSelect={() => {
          if (window.confirm("この輸入便を削除しますか？付けていた書類は未割当に戻ります。")) run({ action: "delete", id: view.id, version: state.version }, "輸入便を削除しました。");
        }}><Trash2 />この便を削除</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu></div> : null}
      <div className="flex min-w-0 basis-full items-start gap-1.5 text-xs lg:flex-1 lg:basis-auto"><Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /><span className="shrink-0 text-muted-foreground">仕入先</span><span className="min-w-0 break-words rounded bg-[var(--tile)] px-2 py-0.5">{draft.supplierName || "仕入先未設定"}</span></div>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><Files aria-hidden className="size-3.5" />書類 <span className="text-foreground">{attachedKinds}/5種類</span> 添付</span>
    </header>
    <MobileSchedule timeline={timeline} requested={requested} orderCount={draft.orders.length} today={today} />
    <div className="lg:hidden [&_.option-tabs]:w-full [&_.workspace-segmented]:w-full [&_.workspace-segmented]:flex-nowrap [&_.workspace-segmented>button]:min-w-0 [&_.workspace-segmented>button]:flex-1 [&_.workspace-segmented>button]:px-1"><OptionTabs label="便の表示内容" value={mobile} onChange={setMobile} options={[
      ["documents", `書類 ${attachedKinds}/5種類`], ["orders", `注文・工程 ${itemCount}品目`],
    ]} /></div>
    <form id="shipment-detail-form" noValidate className="min-w-0 space-y-4" onSubmit={(event) => {
      event.preventDefault(); if (dirtyCount) run(shipmentUpdate(draft, view.id, state.version), "保存しました");
    }}>
      <StagePanel timeline={timeline} baseline={baseline.stages} requested={requested} orderCount={draft.orders.length} today={today} canEdit={canEdit} pending={pending}
        onChange={(stages) => change({ ...draft, stages })} className={mobile === "documents" ? "hidden lg:flex" : ""} />
      <DocumentTabs documents={view.documents} selected={selectedTab} onChange={setSelectedTab} canEdit={canEdit} pending={pending} onAdd={() => setAddOpen(true)} className={mobile === "documents" ? "flex" : "hidden lg:flex"} />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)]">
        <div className={`min-w-0 space-y-3 ${mobile === "orders" ? "hidden lg:block" : ""}`}>
          {documentTabs.map((tab) => <div key={tab.kind} id={`document-panel-${tab.kind}`} role="tabpanel" aria-labelledby={`document-tab-${tab.kind}`} tabIndex={0} hidden={tab.kind !== selectedTab} className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
            {tab.kind === selectedTab ? <DocumentViewer documents={view.documents} kind={tab.kind} company={company} shipmentId={view.id} canEdit={canEdit} pending={pending} onAdd={() => setAddOpen(true)}
              onDetach={(document) => run({ action: "assign", shipmentId: null, source: document.source, documentId: document.id }, "この便から外しました。金額は保持しています。")} /> : null}
          </div>)}
          {canEdit ? <Button type="button" size="sm" variant="outline" disabled={pending} className="lg:hidden" onClick={() => setAddOpen(true)}><Plus />書類を追加</Button> : null}
        </div>
        <Card variant="section" className="min-w-0 gap-4 p-4 max-lg:contents">
          <fieldset disabled={pending} className={`min-w-0 space-y-4 ${mobile === "documents" ? "hidden lg:block" : ""}`}>
            <legend className="sr-only">注文と便の情報</legend>
            <Card variant="section" className="min-w-0 p-4 lg:contents"><div className="min-w-0 space-y-4 lg:mb-4">
              <OrderPanel orders={draft.orders} clients={clients} project={projects.find((project) => project.value === draft.projectId)} today={today} canEdit={canEdit} onChange={(orders) => change({ ...draft, orders })} />
              <NextSchedule timeline={timeline} today={today} />
            </div></Card>
            <CostsSection draft={draft} baseline={baseline} sources={view.fieldSources} canEdit={canEdit} onChange={change} dirty={Boolean(dirtyCount)} canReread={!pending && Boolean(view.documents.length)}
              onReread={() => run({ action: "reread", id: view.id, version: state.version }, "書類から読み直しました")} />
            <ShipmentInfoSection draft={draft} baseline={baseline} sources={view.fieldSources} canEdit={canEdit} onChange={change} projects={projects} vendors={vendors} />
          </fieldset>
          {canEdit ? <SaveBar dirtyCount={dirtyCount} pending={pending} error={error} onReset={reset} onReload={reload} rootRef={rootRef} /> : null}
        </Card>
      </div>
    </form>
    {canEdit ? <AddDocumentsDialog open={addOpen} onOpenChange={setAddOpen} company={company} shipmentId={view.id} unassigned={unassigned} /> : null}
  </div>;
}

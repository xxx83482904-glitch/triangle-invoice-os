"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ReceiptField, ReceiptReading } from "@/lib/expense-receipt-reading";
import { prepareReceiptFile } from "@/lib/receipt-image";
import type { ExpensePaidWith } from "@/lib/types";
import { cardReceiptAction, expenseAction } from "../actions";
import { CardDetailScreen, CardDoneScreen, CardHomeScreen, CardPickScreen, MissingScreen } from "./card-screens";
import { InstallHint } from "./install-hint";
import { amountOf, cardMatches, claimFields, emptyFields, missing, type CardReceiptView, type CardUseView, type Draft, type FieldKey, type MyCardView, type MyClaim, type Option, type PayKind, type ScreenState, type SheetState } from "./model";
import { BatchScreen, ConfirmScreen, DetailScreen, DoneScreen, HomeScreen, ListScreen, ReadingScreen } from "./screens";
import { DangerSheet, DateSheet, PayKindSheet, PickerSheet, TextSheet, WithdrawSheet } from "./sheets";
import { yen } from "./ui";

const STORAGE_PAID_WITH = "triangle:expense-capture:paid-with";
const readFields: Partial<Record<ReceiptField, FieldKey>> = { spentOn: "spentOn", amount: "amount", payee: "payee", purpose: "purpose", categoryId: "categoryId", paidWith: "paidWith", registrationNumber: "registrationNumber" };
function stored(key: string) { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } }
function store(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } }
const distinct = (values: string[], limit: number) => [...new Set(values.map((row) => row.trim()).filter(Boolean))].slice(0, limit);

type SendResult = { id: string; status?: CardReceiptView["status"]; use?: CardUseView; candidates?: CardUseView[]; updatedAt?: string };

export function CaptureApp({ name, company, today, categories, projects, recentProjectIds, claims, card, initial }: {
  name: string; company: CompanyScope; today: string; categories: Option[]; projects: Option[]; recentProjectIds: string[]; claims: MyClaim[];
  card: MyCardView | null; initial: { view?: "list"; claim?: string };
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const draftsRef = useRef(drafts);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  const [stack, setStack] = useState<ScreenState[]>([{ name: "home" }]);
  const depth = useRef(0);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [bulk, setBulk] = useState(false), [withdrawing, setWithdrawing] = useState(false), [picking, setPicking] = useState(false);
  const reading = useRef(new Set<string>());
  const camera = useRef<HTMLInputElement>(null), library = useRef<HTMLInputElement>(null), retake = useRef<HTMLInputElement>(null);
  const retakeKey = useRef(""), addTarget = useRef<"auto" | "batch">("auto"), addKind = useRef<PayKind>("expense"), addUse = useRef<CardUseView | undefined>(undefined);
  const screen = stack[stack.length - 1];

  // Screens live in the browser history, so the phone's back gesture steps back through them. The depth sits in the
  // URL hash: Next.js rewrites history.state on router.refresh(), but keeps the URL.
  const at = (depthValue: number) => `${window.location.pathname}${window.location.search}${depthValue ? `#${depthValue}` : ""}`;
  const push = useCallback((next: ScreenState) => {
    depth.current += 1; window.history.pushState(null, "", at(depth.current));
    setStack((rows) => [...rows.slice(0, depth.current), next]);
  }, []);
  const replace = useCallback((next: ScreenState) => setStack((rows) => [...rows.slice(0, -1), next]), []);
  const back = useCallback(() => { if (depth.current > 0) window.history.back(); }, []);
  const backTo = useCallback((match: (row: ScreenState) => boolean) => {
    const rows = stack.slice(0, depth.current + 1);
    let index = -1;
    rows.forEach((row, at) => { if (match(row)) index = at; });
    const target = index >= 0 ? index : 0;
    if (target < depth.current) window.history.go(target - depth.current);
  }, [stack]);
  useEffect(() => {
    // A reload mid-flow starts over at home: drafts don't survive it.
    if (window.location.hash) window.history.replaceState(window.history.state, "", at(0));
    const start: ScreenState[] = [{ name: "home" }];
    if (initial.view === "list" || initial.claim) start.push({ name: "list" });
    if (initial.claim && claims.some((row) => row.id === initial.claim)) start.push({ name: "detail", id: initial.claim });
    for (let index = 1; index < start.length; index++) window.history.pushState(null, "", at(index));
    depth.current = start.length - 1;
    setStack(start);
    const pop = () => {
      const level = Math.max(0, Number.parseInt(window.location.hash.slice(1), 10) || 0);
      depth.current = level; setSheet(null);
      setStack((rows) => rows.length > level ? rows.slice(0, level + 1) : rows);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
    // Mount only: later prop changes must not rewrite the history the person is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);

  const update = useCallback((key: string, change: (draft: Draft) => Draft) => setDrafts((rows) => rows.map((row) => row.key === key ? change(row) : row)), []);
  const remove = useCallback((key: string) => setDrafts((rows) => {
    const row = rows.find((item) => item.key === key);
    if (row?.preview.startsWith("blob:")) URL.revokeObjectURL(row.preview);
    return rows.filter((item) => item.key !== key);
  }), []);
  useEffect(() => () => { for (const row of draftsRef.current) if (row.preview.startsWith("blob:")) URL.revokeObjectURL(row.preview); }, []);
  const unsent = drafts.filter((row) => !row.claim);
  useEffect(() => {
    if (!unsent.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent.length]);

  // Read at most two receipts at a time. Only blank fields the person hasn't touched are filled.
  useEffect(() => {
    const waiting = drafts.filter((row) => row.state === "reading" && row.file && !reading.current.has(row.key));
    for (const draft of waiting.slice(0, Math.max(0, 2 - reading.current.size))) {
      reading.current.add(draft.key);
      const data = new FormData(); data.set("company", company); data.set("file", draft.file!);
      void fetch("/api/uploads/expenses/ocr", { method: "POST", body: data, signal: AbortSignal.timeout(100_000) })
        .then(async (response) => {
          const body = await response.json() as Partial<ReceiptReading> & { error?: string };
          if (!response.ok) throw new Error(body.error || "読み取れませんでした");
          return body;
        })
        .then((body) => update(draft.key, (row) => {
          const fields = { ...row.fields }, auto = { ...row.auto };
          const fill = (key: FieldKey, value: string | undefined, source?: Draft["auto"][FieldKey]) => {
            if (!value || row.touched[key] || (fields[key] && key !== "paidWith")) return;
            fields[key] = value as never; if (source) auto[key] = source;
          };
          for (const [field, key] of Object.entries(readFields) as Array<[ReceiptField, FieldKey]>) {
            const raw = body[field as keyof ReceiptReading];
            fill(key, typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : undefined, body.sources?.[field]);
          }
          if (body.taxBreakdown?.rate10) fill("tax10", String(body.taxBreakdown.rate10), "ai");
          if (body.taxBreakdown?.rate8) fill("tax8", String(body.taxBreakdown.rate8), "ai");
          return { ...row, state: row.state === "sending" ? "sending" : "ready", fields, auto, ocrText: body.ocrText || "", warnings: body.warnings || [] };
        }))
        .catch(() => update(draft.key, (row) => ({ ...row, state: row.state === "sending" ? "sending" : "ready", warnings: ["自動で読み取れませんでした。領収書を見ながら入力してください。"] })))
        .finally(() => { reading.current.delete(draft.key); setDrafts((rows) => [...rows]); });
    }
  }, [drafts, company, update]);

  const prepare = async (key: string, original: File) => {
    try {
      const file = await prepareReceiptFile(original);
      update(key, (row) => ({ ...row, file, state: "reading" }));
    } catch (error) {
      update(key, (row) => ({ ...row, state: "ready", manual: true, error: error instanceof Error ? error.message : "読み込めませんでした" }));
    }
  };

  const addFiles = (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const paidWith = (["CASH", "PERSONAL_CARD", "OTHER"].includes(stored(STORAGE_PAID_WITH)) ? stored(STORAGE_PAID_WITH) : "CASH") as ExpensePaidWith;
    const kind = card ? addKind.current : "expense", target = kind === "card" && files.length === 1 ? addUse.current : undefined;
    const created = files.map((file): Draft => ({ key: crypto.randomUUID(), kind, targetUse: target, file, preview: file.type === "application/pdf" ? "" : URL.createObjectURL(file), pdf: file.type === "application/pdf",
      state: "preparing", manual: false, fields: { ...emptyFields(paidWith), ...(target ? { amount: String(Math.round(target.amount)), spentOn: target.date } : {}) },
      auto: {}, touched: {}, ocrText: "", warnings: [], error: "", more: false }));
    setDrafts((rows) => [...rows, ...created]);
    const toBatch = addTarget.current === "batch" || files.length > 1;
    if (toBatch && screen.name !== "batch") { if (screen.name === "done") replace({ name: "batch" }); else push({ name: "batch" }); }
    else if (!toBatch) { const next = { name: "confirm" as const, key: created[0].key, mode: "single" as const }; if (screen.name === "done") replace(next); else push(next); }
    for (const draft of created) void prepare(draft.key, draft.file!);
  };
  const openCamera = (target: "auto" | "batch", kind: PayKind = "expense", use?: CardUseView) => { addTarget.current = target; addKind.current = kind; addUse.current = use; camera.current?.click(); };
  const openLibrary = (kind: PayKind = "expense") => { addTarget.current = "auto"; addKind.current = kind; addUse.current = undefined; library.current?.click(); };
  const openRetake = (key: string) => { retakeKey.current = key; retake.current?.click(); };
  const onRetake = (list: FileList | null) => {
    const file = list?.[0], key = retakeKey.current;
    if (!file || !key) return;
    update(key, (row) => {
      if (row.preview.startsWith("blob:")) URL.revokeObjectURL(row.preview);
      // A new photo of a fresh receipt clears what was read from the old one; an edited claim keeps its values.
      const fields = row.claim ? row.fields : Object.fromEntries(Object.entries(row.fields).map(([field, value]) => [field, row.touched[field as FieldKey] || field === "paidWith" ? value : ""])) as Draft["fields"];
      return { ...row, file, preview: file.type === "application/pdf" ? "" : URL.createObjectURL(file), pdf: file.type === "application/pdf", state: "preparing", manual: Boolean(row.claim),
        fields, auto: row.claim ? row.auto : {}, warnings: [], error: "" };
    });
    void prepare(key, file);
  };

  const change = (key: string, field: FieldKey, value: string) => update(key, (row) => ({ ...row, fields: { ...row.fields, [field]: value }, touched: { ...row.touched, [field]: true }, auto: { ...row.auto, [field]: undefined }, error: "" }));

  const send = async (draft: Draft): Promise<SendResult | null> => {
    const gaps = missing(draft.fields, today);
    if (gaps.length) { update(draft.key, (row) => ({ ...row, error: `${gaps.join("・")}を入力してください` })); return null; }
    update(draft.key, (row) => ({ ...row, state: "sending", error: "" }));
    const data = new FormData();
    data.set("company", company); data.set("ocrText", draft.ocrText);
    if (draft.file) data.set("file", draft.file);
    if (draft.claim) { data.set("claimId", draft.claim.id); data.set("version", draft.claim.updatedAt); }
    for (const [key, value] of Object.entries(draft.fields)) data.set(key, value);
    if (draft.kind === "card" && draft.targetUse) data.set("transactionId", draft.targetUse.id);
    try {
      const response = await fetch(draft.kind === "card" ? "/api/uploads/card-receipts" : "/api/uploads/expenses", { method: "POST", body: data });
      const body = await response.json() as Partial<SendResult> & { error?: string };
      if (!response.ok || !body.id) throw new Error(body.error || "送信できませんでした");
      if (draft.kind === "expense") store(STORAGE_PAID_WITH, draft.fields.paidWith);
      setFresh((rows) => new Set(rows).add(body.id!));
      remove(draft.key);
      return body as SendResult;
    } catch (error) {
      update(draft.key, (row) => ({ ...row, state: "ready", manual: true, error: error instanceof Error ? error.message : "送信できませんでした。通信状況を確認してもう一度押してください" }));
      return null;
    }
  };
  const submitOne = async (draft: Draft, mode: "single" | "edit") => {
    const result = await send(draft);
    if (!result) return;
    router.refresh();
    if (draft.kind === "card") {
      const base = { payee: draft.fields.payee, amount: amountOf(draft.fields), purpose: draft.fields.purpose };
      if (result.status === "CHOOSE" && result.candidates?.length && result.updatedAt)
        replace({ name: "cardPick", receipt: { id: result.id, updatedAt: result.updatedAt, payee: base.payee, amount: base.amount, spentOn: draft.fields.spentOn, candidates: result.candidates } });
      else replace({ name: "cardDone", status: result.status || "WAITING", ...base, use: result.use });
      return;
    }
    if (mode === "edit") { toast({ title: draft.claim?.status === "RETURNED" ? "再提出しました。" : "変更を保存しました。", variant: "success" }); back(); return; }
    replace({ name: "done", count: 1, total: amountOf(draft.fields), label: draft.fields.payee });
  };
  const submitBatch = async () => {
    if (bulk) return;
    setBulk(true);
    const ready = drafts.filter((row) => !row.claim && row.state === "ready" && !missing(row.fields, today).length);
    let count = 0, total = 0;
    for (const draft of ready) if (await send(draft)) { count++; total += amountOf(draft.fields); }
    // Card receipts that matched more than one use are chosen later from the list.
    setBulk(false);
    if (!count) return;
    router.refresh();
    if (count === unsent.length) replace({ name: "done", count, total, label: `${count}枚の領収書` });
    else toast({ title: `${count}件を申請しました。残りの領収書を確認してください。`, variant: "success" });
  };

  const pickUse = async (receipt: { id: string; updatedAt: string; payee: string; amount: number }, use: CardUseView, purpose: string) => {
    if (picking) return;
    setPicking(true);
    const result = await cardReceiptAction(company, { action: "pick", id: receipt.id, version: receipt.updatedAt, transactionId: use.id });
    setPicking(false);
    if (!result.success) { toast({ title: result.error, variant: "destructive" }); return; }
    router.refresh();
    replace({ name: "cardDone", status: "LINKED", payee: receipt.payee, amount: receipt.amount, purpose, use });
  };
  const removeCard = async (id: string) => {
    const receipt = card?.receipts.find((row) => row.id === id);
    if (!receipt || withdrawing) return;
    setWithdrawing(true);
    const result = await cardReceiptAction(company, { action: "remove", id, version: receipt.updatedAt });
    setWithdrawing(false);
    if (!result.success) { toast({ title: result.error, variant: "destructive" }); return; }
    setSheet(null); router.refresh();
    toast({ title: "領収書を削除しました。", variant: "success" });
    backTo((row) => row.name === "list");
  };

  const edit = (claim: MyClaim) => {
    const key = `edit:${claim.id}`;
    setDrafts((rows) => rows.some((row) => row.key === key) ? rows : [...rows, { key, kind: "expense" as const, preview: claim.mimeType.startsWith("image/") ? claim.fileUrl : "", pdf: claim.mimeType === "application/pdf",
      state: "ready", manual: true, fields: claimFields(claim), auto: {}, touched: {}, ocrText: "", warnings: [], error: "", claim, more: false }]);
    push({ name: "confirm", key, mode: "edit" });
  };
  const withdraw = async (id: string) => {
    const claim = claims.find((row) => row.id === id);
    if (!claim || withdrawing) return;
    setWithdrawing(true);
    const result = await expenseAction(company, { action: "withdraw", id, version: claim.updatedAt });
    setWithdrawing(false);
    if (!result.success) { toast({ title: result.error, variant: "destructive" }); return; }
    setSheet(null); remove(`edit:${id}`); router.refresh();
    toast({ title: "申請を取り下げました。", variant: "success" });
    backTo((row) => row.name === "list");
  };

  const mine = useMemo(() => {
    const sum = (status: MyClaim["status"]) => claims.filter((row) => row.status === status).reduce((total, row) => total + row.amount, 0);
    const count = (status: MyClaim["status"]) => claims.filter((row) => row.status === status).length;
    return { waiting: { amount: sum("APPROVED"), count: count("APPROVED") }, submitted: { amount: sum("SUBMITTED"), count: count("SUBMITTED") }, returned: claims.filter((row) => row.status === "RETURNED") };
  }, [claims]);
  const recentProjects = useMemo(() => recentProjectIds.map((id) => projects.find((row) => row.value === id)).filter(Boolean) as Option[], [projects, recentProjectIds]);
  const recentCategories = useMemo(() => distinct(claims.map((row) => row.categoryId), 5).map((id) => categories.find((row) => row.value === id)).filter(Boolean) as Option[], [claims, categories]);

  const sheetDraft = sheet && "key" in sheet ? drafts.find((row) => row.key === sheet.key) : undefined;
  const closeSheet = () => setSheet(null);
  const pick = (field: FieldKey) => (value: string) => { if (sheetDraft) change(sheetDraft.key, field, value); closeSheet(); };

  let view: React.ReactNode = null;
  if (screen.name === "home" && card) {
    view = <CardHomeScreen name={name} card={card} waiting={mine.waiting.amount} returned={mine.returned.length} drafts={unsent.length} install={<InstallHint />}
      onCard={() => openCamera("auto", "card")} onExpense={() => openCamera("auto", "expense")} onLibrary={() => setSheet({ kind: "payKind" })}
      onList={() => push({ name: "list" })} onMissing={() => push({ name: "missing" })}
      onReturned={() => mine.returned.length === 1 ? push({ name: "detail", id: mine.returned[0].id }) : push({ name: "list" })}
      onDrafts={() => unsent.length === 1 ? push({ name: "confirm", key: unsent[0].key, mode: "single" }) : push({ name: "batch" })} />;
  } else if (screen.name === "home") {
    view = <HomeScreen name={name} waiting={mine.waiting} submitted={mine.submitted} returned={mine.returned.length} drafts={unsent.length} install={<InstallHint />}
      onCamera={() => openCamera("auto")} onLibrary={() => openLibrary()} onList={() => push({ name: "list" })}
      onReturned={() => mine.returned.length === 1 ? push({ name: "detail", id: mine.returned[0].id }) : push({ name: "list" })}
      onDrafts={() => unsent.length === 1 ? push({ name: "confirm", key: unsent[0].key, mode: "single" }) : push({ name: "batch" })} />;
  } else if (screen.name === "confirm") {
    const draft = drafts.find((row) => row.key === screen.key);
    if (!draft) view = <HomeFallback onHome={() => backTo((row) => row.name === "home")} />;
    else if (screen.mode === "single" && !draft.claim && !draft.manual && (draft.state === "preparing" || draft.state === "reading"))
      view = <ReadingScreen draft={draft} onManual={() => update(draft.key, (row) => ({ ...row, manual: true }))} onClose={back} />;
    else view = <ConfirmScreen draft={draft} mode={screen.mode} today={today} projects={projects} categories={categories} onBack={back}
      card={card ? { label: card.account.label, matches: cardMatches(card.uses, amountOf(draft.fields), draft.fields.spentOn) } : undefined}
      onSwitchKind={card && !draft.claim ? () => update(draft.key, (row) => ({ ...row, kind: row.kind === "card" ? "expense" : "card", error: "" })) : undefined}
      onChange={(field, value) => change(draft.key, field, value)} onSheet={(kind) => setSheet({ kind, key: draft.key })}
      onToggleMore={() => update(draft.key, (row) => ({ ...row, more: !row.more }))} onRetake={() => openRetake(draft.key)}
      onSubmit={() => void submitOne(draft, screen.mode === "edit" ? "edit" : "single")} onRemove={() => { remove(draft.key); back(); }}
      onWithdraw={() => draft.claim && setSheet({ kind: "withdraw", id: draft.claim.id })} />;
  } else if (screen.name === "batch") {
    view = <BatchScreen drafts={unsent} today={today} sending={bulk} onBack={back} onOpen={(key) => push({ name: "confirm", key, mode: "batch" })}
      onCamera={() => openCamera("batch")} onSubmit={() => void submitBatch()} />;
  } else if (screen.name === "done") {
    view = <DoneScreen count={screen.count} total={screen.total} label={screen.label} onCamera={() => openCamera("auto", "expense")} onList={() => replace({ name: "list" })} onHome={() => backTo((row) => row.name === "home")} />;
  } else if (screen.name === "list") {
    view = <ListScreen claims={claims} fresh={fresh} onBack={back} onOpen={(id) => push({ name: "detail", id })}
      initialKind={card?.receipts.some((row) => fresh.has(row.id)) ? "card" : "expense"}
      card={card ? { receipts: card.receipts, onOpen: (id) => push({ name: "cardDetail", id }) } : undefined} />;
  } else if (screen.name === "cardPick") {
    const receipt = screen.receipt, purpose = card?.receipts.find((row) => row.id === receipt.id)?.purpose || "";
    view = <CardPickScreen receipt={receipt} cardLabel={card?.account.label || ""} pending={picking} onBack={back}
      onPick={(id) => { const use = receipt.candidates.find((row) => row.id === id); if (use) void pickUse(receipt, use, purpose); }}
      onLater={() => replace({ name: "cardDone", status: "CHOOSE", payee: receipt.payee, amount: receipt.amount, purpose })} />;
  } else if (screen.name === "cardDone") {
    view = <CardDoneScreen status={screen.status} payee={screen.payee} amount={screen.amount} purpose={screen.purpose} use={screen.use} cardLabel={card?.account.label || ""}
      missing={card?.missing.filter((row) => row.id !== screen.use?.id).length || 0} onCamera={() => openCamera("auto", "card")}
      onMissing={() => replace({ name: "missing" })} onList={() => replace({ name: "list" })} onHome={() => backTo((row) => row.name === "home")} />;
  } else if (screen.name === "missing") {
    view = card ? <MissingScreen card={card} onBack={back} onShoot={(use) => openCamera("auto", "card", use)} /> : <HomeFallback onHome={() => backTo((row) => row.name === "home")} text="会社カードが登録されていません" />;
  } else if (screen.name === "cardDetail") {
    const receipt = card?.receipts.find((row) => row.id === screen.id);
    view = receipt && card ? <CardDetailScreen receipt={receipt} cardLabel={card.account.label} onBack={back}
      onChoose={() => push({ name: "cardPick", receipt })} onRemove={() => setSheet({ kind: "removeCard", id: receipt.id })} />
      : <HomeFallback onHome={() => backTo((row) => row.name === "list")} text="この領収書は表示できません（削除済みの可能性があります）" />;
  } else {
    const claim = claims.find((row) => row.id === screen.id);
    view = claim ? <DetailScreen claim={claim} onBack={back} onEdit={() => edit(claim)} onWithdraw={() => setSheet({ kind: "withdraw", id: claim.id })} />
      : <HomeFallback onHome={() => backTo((row) => row.name === "list")} text="この申請は表示できません（取り下げ済みの可能性があります）" />;
  }

  const withdrawClaim = sheet?.kind === "withdraw" ? claims.find((row) => row.id === sheet.id) : undefined;
  return <main className="mx-auto w-full max-w-xl">
    <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
    <input ref={library} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
    <input ref={retake} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { onRetake(event.target.files); event.target.value = ""; }} />
    {view}
    {sheetDraft && sheet?.kind === "spentOn" ? <DateSheet value={sheetDraft.fields.spentOn} today={today} onPick={pick("spentOn")} onClose={closeSheet} /> : null}
    {sheetDraft && sheet?.kind === "payee" ? <TextSheet title="お店" value={sheetDraft.fields.payee} placeholder="店名・会社名" maxLength={100} onDone={pick("payee")} onClose={closeSheet}
      suggestions={distinct(claims.map((row) => row.payee), 6)} /> : null}
    {sheetDraft && sheet?.kind === "purpose" ? <TextSheet title="用途" value={sheetDraft.fields.purpose} placeholder="例：打ち合わせのタクシー代" maxLength={200} onDone={pick("purpose")} onClose={closeSheet}
      suggestions={distinct(claims.map((row) => row.purpose), 6)} /> : null}
    {sheetDraft && sheet?.kind === "projectId" ? <PickerSheet title="案件を選ぶ" value={sheetDraft.fields.projectId} empty="共通経費（案件なし）" recent={recentProjects} options={projects} onPick={pick("projectId")} onClose={closeSheet} /> : null}
    {sheetDraft && sheet?.kind === "categoryId" ? <PickerSheet title="科目を選ぶ" value={sheetDraft.fields.categoryId} empty="わからない（経理が設定）" recent={recentCategories} options={categories} onPick={pick("categoryId")} onClose={closeSheet} /> : null}
    {sheet?.kind === "payKind" && card ? <PayKindSheet cardLabel={card.account.label} onClose={closeSheet} onPick={(kind) => { closeSheet(); openLibrary(kind); }} /> : null}
    {sheet?.kind === "removeCard" ? <DangerSheet title="領収書を削除しますか？" body="この領収書を削除します。カード明細に付いていた場合は、明細からも外れます。" action="削除する" pendingLabel="削除しています…"
      pending={withdrawing} onConfirm={() => void removeCard(sheet.id)} onClose={closeSheet} /> : null}
    {withdrawClaim ? <WithdrawSheet payee={withdrawClaim.payee} amount={yen(withdrawClaim.amount)} pending={withdrawing} onConfirm={() => void withdraw(withdrawClaim.id)} onClose={closeSheet} /> : null}
  </main>;
}

function HomeFallback({ onHome, text = "この領収書は申請済みか、外されています" }: { onHome: () => void; text?: string }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
    <p className="text-[17px] text-muted-foreground">{text}</p>
    <button type="button" onClick={onHome} className="h-16 rounded-[20px] border border-input bg-card px-8 text-lg font-medium">戻る</button>
  </div>;
}

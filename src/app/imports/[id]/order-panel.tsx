"use client";

import { useState } from "react";
import { Armchair, BookOpen, Box, Lamp, MoreHorizontal, Package, Pencil, Plus, Shirt, ShoppingBag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import type { DetailItem, DetailOption, DetailOrder } from "@/lib/import-detail-draft";
import { importOrderItemKinds } from "@/lib/import-shipments";
import { amberText, DetailDate, DetailField, detailSelectClass } from "./detail-fields";

const itemIcons = { BAG: ShoppingBag, PRINTED: BookOpen, BOX: Package, TEXTILE: Shirt, LIGHTING: Lamp, FURNITURE: Armchair, OTHER: Box };

export function OrderPanel({ orders, clients, project, today, canEdit, onChange }: {
  orders: DetailOrder[]; clients: DetailOption[]; project?: DetailOption; today: string; canEdit: boolean; onChange: (orders: DetailOrder[]) => void;
}) {
  const [selected, setSelected] = useState(orders[0]?.id ?? "");
  const [editing, setEditing] = useState<string[]>([]);
  const order = orders.find((row) => row.id === selected) ?? orders[0];
  const projectClient = clients.find((client) => client.value === project?.clientId);
  const setOrder = (value: DetailOrder) => onChange(orders.map((row) => row.id === value.id ? value : row));
  const addOrder = () => {
    const id = globalThis.crypto.randomUUID();
    onChange([...orders, { id, items: [] }]); setSelected(id);
  };
  const addItem = () => {
    const id = globalThis.crypto.randomUUID();
    setOrder({ ...order, items: [...order.items, { id, name: "", quantity: "", kind: "OTHER" }] });
    setEditing([...editing, id]);
  };
  const removeOrder = () => {
    if (window.confirm("この注文を削除しますか？注文内の品目も削除されます。保存すると反映されます。")) onChange(orders.filter((row) => row.id !== order.id));
  };
  return <section aria-label="注文情報" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-medium">注文情報</h2>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">この便の注文 {orders.length}件</span>
        {canEdit ? <Button type="button" variant="ghost" size="sm" disabled={orders.length >= 20} onClick={addOrder}><Plus />注文を追加</Button> : null}</div>
    </div>
    {orders.length > 1 ? <div role="group" aria-label="表示する注文" className="flex min-w-0 gap-1 overflow-x-auto rounded-xl bg-[var(--track)] p-1">
      {orders.map((row, index) => <button key={row.id} type="button" aria-pressed={row.id === order.id} onClick={() => setSelected(row.id)}
        className={`min-w-32 flex-1 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring ${row.id === order.id ? "bg-[var(--selected)] shadow-[var(--shadow-soft)]" : "hover:bg-[var(--tile)]"}`}>
        <span className="block max-w-48 truncate text-xs" title={row.orderNumber}>{row.orderNumber || `注文${index + 1}`}</span>
        <span className="block whitespace-nowrap text-[11px] text-muted-foreground">希望納期 <DetailDate value={row.requestedDeliveryDate} today={today} /> ・ {row.items.length}品目</span>
      </button>)}
    </div> : null}
    {!order ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">注文はまだ登録されていません</p> : <>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{order.orderNumber || `注文${orders.indexOf(order) + 1}`}</span>
        {canEdit ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="この注文の操作"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive" onSelect={removeOrder}><Trash2 />この注文を削除</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu> : null}</div>
      <div className="space-y-3">
        <DetailField label="クライアント" caption={!order.clientId && projectClient ? <div className="space-y-1">
          <p>案件「{project?.label}」のクライアント: {projectClient.label}</p>
          {canEdit ? <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-1 text-xs" onClick={() => setOrder({ ...order, clientId: projectClient.value })}>この取引先にする</Button> : null}
        </div> : undefined}>
          {canEdit ? <select aria-label="クライアント" value={order.clientId ?? ""} className={detailSelectClass} onChange={(event) => setOrder({ ...order, clientId: event.target.value })}>
            <option value="">未設定</option>{order.clientId && !clients.some((client) => client.value === order.clientId) ? <option value={order.clientId}>登録済みのクライアント（現在選択不可）</option> : null}
            {clients.map((client) => <option key={client.value} value={client.value}>{client.label}</option>)}
          </select> : <p className="break-words py-1.5 text-sm">{clients.find((client) => client.value === order.clientId)?.label || "未設定"}</p>}
        </DetailField>
        {([["orderNumber", "注文番号", "text"], ["orderedAt", "先方からの発注日", "date"], ["requestedDeliveryDate", "希望納期", "date"]] as const).map(([key, label, type]) => <DetailField key={key} label={label}
          caption={key === "orderedAt" ? "クライアントから注文を受けた日（仕入先への発注日とは別）" : undefined}>
          {canEdit ? <Input aria-label={label} type={type} value={order[key] ?? ""} maxLength={type === "text" ? 100 : undefined} onChange={(event) => setOrder({ ...order, [key]: event.target.value })} />
            : <p className={`py-1.5 text-sm ${type === "date" ? "whitespace-nowrap" : "break-words"}`}>{order[key] ? type === "date" ? formatDate(order[key]) : order[key] : "未入力"}</p>}
        </DetailField>)}
      </div>
      <div className="space-y-2 border-t border-[var(--rule)] pt-4">
        <h3 className="text-sm font-medium">注文内容 <span className="text-xs font-normal text-muted-foreground">{order.items.length}品目</span></h3>
        {!order.items.length ? <p className="py-2 text-xs text-muted-foreground">品目はまだ登録されていません</p> : null}
        <ul className="min-w-0 divide-y divide-[var(--rule)]">
          {order.items.map((item) => <ItemRow key={item.id} item={item} orderDate={order.requestedDeliveryDate} today={today} canEdit={canEdit} editing={editing.includes(item.id)}
            onToggle={() => setEditing(editing.includes(item.id) ? editing.filter((id) => id !== item.id) : [...editing, item.id])}
            onChange={(next) => setOrder({ ...order, items: order.items.map((row) => row.id === item.id ? next : row) })}
            onDelete={() => { if (window.confirm("この品目を削除しますか？保存すると反映されます。")) setOrder({ ...order, items: order.items.filter((row) => row.id !== item.id) }); }} />)}
        </ul>
        {canEdit ? <Button type="button" variant="outline" size="sm" disabled={order.items.length >= 100} onClick={addItem}><Plus />品目を追加</Button> : null}
      </div>
    </>}
  </section>;
}

function ItemRow({ item, orderDate, today, canEdit, editing, onToggle, onChange, onDelete }: {
  item: DetailItem; orderDate?: string; today: string; canEdit: boolean; editing: boolean;
  onToggle: () => void; onChange: (item: DetailItem) => void; onDelete: () => void;
}) {
  const Icon = itemIcons[item.kind ?? "OTHER"];
  return <li className="min-w-0 py-3">
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]"><Icon aria-hidden className="size-4" /></span>
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.name || "品名未入力"}</p>{item.note ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.note}</p> : null}
        {item.requestedDeliveryDate && item.requestedDeliveryDate !== orderDate ? <p className={`text-xs ${amberText}`}>希望納期 <DetailDate value={item.requestedDeliveryDate} today={today} />（注文と別）</p> : null}</div>
      <span className="shrink-0 whitespace-nowrap text-right text-xs"><span className="font-mono">{item.quantity === "" ? "—" : Number(item.quantity).toLocaleString("ja-JP", { maximumFractionDigits: 6 })}</span> {item.unit}</span>
      {canEdit ? <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={`${item.name || "品目"}の${editing ? "編集を閉じる" : "編集"}`} aria-expanded={editing} onClick={onToggle}>{editing ? <X /> : <Pencil />}</Button> : null}
    </div>
    {canEdit && editing ? <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 rounded-xl bg-[var(--field)] p-3">
      {([["name", "品名", "text", 200], ["quantity", "数量", "number", undefined], ["unit", "単位", "text", 20]] as const).map(([key, label, type, maxLength]) => <label key={key} className={`min-w-0 space-y-1 text-xs ${key === "name" ? "col-span-2" : ""}`}>
        <span className="text-muted-foreground">{label}</span><Input type={type} value={item[key] ?? ""} maxLength={maxLength} min={type === "number" ? 0 : undefined} max={type === "number" ? 1e9 : undefined} step={type === "number" ? "any" : undefined} inputMode={type === "number" ? "decimal" : undefined}
          onChange={(event) => onChange({ ...item, [key]: event.target.value })} />
      </label>)}
      <label className="col-span-2 min-w-0 space-y-1 text-xs"><span className="text-muted-foreground">種類</span>
        <select className={detailSelectClass} value={item.kind ?? "OTHER"} onChange={(event) => onChange({ ...item, kind: event.target.value as DetailItem["kind"] })}>
          {importOrderItemKinds.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="col-span-2 min-w-0 space-y-1 text-xs"><span className="text-muted-foreground">メモ</span><Textarea value={item.note ?? ""} maxLength={200} className="min-h-16" onChange={(event) => onChange({ ...item, note: event.target.value })} /></label>
      <label className="col-span-2 min-w-0 space-y-1 text-xs"><span className="text-muted-foreground">希望納期（注文と違う場合だけ）</span><Input type="date" value={item.requestedDeliveryDate ?? ""} onChange={(event) => onChange({ ...item, requestedDeliveryDate: event.target.value })} /></label>
      <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-start text-destructive" onClick={onDelete}><Trash2 />この品目を削除</Button>
    </div> : null}
  </li>;
}

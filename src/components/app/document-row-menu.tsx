"use client";

import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { Ellipsis, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DocumentRow } from "@/lib/documents";

type Props = { row: DocumentRow; onEdit: () => void; onDelete: () => void; disabled?: boolean };
const itemClass = "flex min-h-11 cursor-default items-center gap-2 rounded px-3 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4";
const fileLabel = (row: DocumentRow) => row.kind === "estimate" || (row.kind === "issued" && !row.imported) ? "PDFを開く" : "原本を開く";

export function DocumentContextMenu({ children, row, onEdit, onDelete, disabled }: Props & { children: ReactNode }) {
  return <ContextMenu.Root>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <ContextMenu.Item className={itemClass} onSelect={onEdit}><Pencil />{row.editable ? "編集" : "プレビュー"}</ContextMenu.Item>
      {row.fileUrl ? <ContextMenu.Item className={itemClass} asChild><a href={row.fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />{fileLabel(row)}</a></ContextMenu.Item> : null}
      {row.kind === "issued" && row.editable ? <><ContextMenu.Separator className="my-1 h-px bg-border" /><ContextMenu.Item disabled={disabled} className={itemClass + " text-destructive"} onSelect={onDelete}><Trash2 />削除</ContextMenu.Item></> : null}
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}

export function DocumentMenuButton({ row, onEdit, onDelete, disabled }: Props) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="shrink-0" aria-label={row.title + "の操作"} title="書類の操作"><Ellipsis className="size-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44">
      <DropdownMenuItem className="min-h-11" onSelect={onEdit}><Pencil />{row.editable ? "編集" : "プレビュー"}</DropdownMenuItem>
      {row.fileUrl ? <DropdownMenuItem className="min-h-11" asChild><a href={row.fileUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />{fileLabel(row)}</a></DropdownMenuItem> : null}
      {row.kind === "issued" && row.editable ? <DropdownMenuItem className="min-h-11" disabled={disabled} variant="destructive" onSelect={onDelete}><Trash2 />削除</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}

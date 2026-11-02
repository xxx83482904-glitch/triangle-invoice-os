"use client";

import type { ReactNode } from "react";
import { useListSelection } from "@/hooks/use-list-selection";
import { RowSelectionCheckbox, SelectionToolbar } from "@/components/app/list-selection";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function SelectableRecordsTable({ headers, rows }: { headers: string[]; rows: { id: string; label: string; cells: ReactNode[] }[] }) {
  const selection = useListSelection(rows.map((row) => row.id));
  return <div className="min-w-0 space-y-2">
    <SelectionToolbar selection={selection} />
    <Table className="record-cards record-cards-stack">
      <TableHeader><TableRow><TableHead className="w-11 p-0"><span className="sr-only">選択</span></TableHead>{headers.map((title) => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.id} {...selection.rowProps(row.id)}>
        <TableCell className="record-card-tick p-0"><RowSelectionCheckbox selection={selection} id={row.id} label={`${row.label}を選択`} /></TableCell>
        {row.cells.map((cell, index) => <TableCell key={index} data-label={headers[index]}>{cell}</TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}

import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function RecordsTable({ headers, titleColumn, rows }: { headers: string[]; titleColumn: number; rows: { id: string; cells: ReactNode[] }[] }) {
  return <div className="min-w-0 space-y-2">
    <Table className="record-cards record-cards-stack">
      <TableHeader><TableRow>{headers.map((title) => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.id}>
        {row.cells.map((cell, index) => index === titleColumn ? <TableCell key={index} className="record-card-title">{cell}</TableCell> : <TableCell key={index} data-label={index && headers[index] !== "操作" ? headers[index] : undefined}>{cell}</TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}

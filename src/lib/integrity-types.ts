import type { CompanyScope } from "@/lib/company";

// Shared presentation types; keep server-only fingerprint code out of client bundles.
export const integrityKinds = {
  reconciliation_conflict: { label: "要再確認の照合", description: "照合後に請求書・支払記録・銀行明細のいずれかが変わった照合です。", action: "照合画面で内容を確認し、問題なければ「内容を確認して照合を維持」、違っていれば解除して再照合してください" },
  payment_mismatch: { label: "支払記録と請求額・状態の不整合", description: "支払記録の合計が請求額を超えている、または書類の状態と支払記録の完了状態が一致していません。", action: "書類の支払記録一覧で金額修正・取消を行い、状態を支払記録に合わせてください" },
  mail_processing_mismatch: { label: "郵便処理と支払状況の差", description: "受領請求書または連携郵便物の処理状態が、支払記録の完了状態と異なります。書類整理と支払いは独立した状態です。", action: "書類整理の状況に応じて郵便物の処理状態を確認してください。支払状況と一致させる必要はありません" },
  mail_link: { label: "郵便物の参照切れ・原本欠落", description: "郵便物の参照先が削除・移動されている、または原本ファイルが見つかりません。処理済みや分類とは別のデータ点検です。", action: "郵便物フォルダーで連携の要否を確認し、必要なものは「受領請求書を作り直す」か既存書類へ再連携してください。原本欠落は再アップロードで修復してください" },
  reviewed_guess: { label: "推測のまま確認済み", description: "根拠の弱い推測の科目が、内容確認の記録なしに確認済みになっています（確認ガード導入前のデータ）。", action: "未確認に戻して摘要と科目を見直すか、科目を選び直してから確認済みにしてください" },
  reviewed_undecided: { label: "確認済みだが記帳メモ未確定", description: "確認済みの明細で、請求書要否が「未確定」のまま、または保留が残っています。", action: "記帳詳細で請求書要否を決めるか、保留を解消してください" },
  reconciled_income_not_sales: { label: "照合済み入金が売上系以外の科目", description: "発行請求書と照合済みの入金の科目が未設定、または売上系以外です。前受金・立替精算など正当な場合もあります。", action: "口座・カード明細の提案から売上科目を採用するか、意図した科目であれば確認済みにしてください" },
  paid_without_bank: { label: "支払・入金記録あり・銀行未照合", description: "支払・入金記録があるのに銀行明細と照合されていません。現金・手入力の支払いもあり得ます。", action: "照合画面で既存の支払記録に銀行明細を紐づけてください。旧ステータス変更由来の記録は取消を検討してください" },
  category_spread: { label: "同じ摘要で科目が分散", description: "同じ事業者・方向・摘要の確認済み明細に複数の科目が使われています。", action: "摘要で絞り込んで科目をそろえるか、ルールを登録してください" },
  transfer_half: { label: "振替の片側のみ・資金移動の不整合", description: "振替扱いの明細に資金移動の相手がない、または資金移動の照合に不整合があります。カード精算など相手のない振替もあります。", action: "資金移動の照合を確認し、相手口座の明細と組にするか、扱いを見直してください" },
} as const;
export type IntegrityKind = keyof typeof integrityKinds;
export type IntegritySeverity = "ERROR" | "WARNING" | "INFO";
export const integritySeverityLabels: Record<IntegritySeverity, string> = { ERROR: "要対応", WARNING: "確認", INFO: "参考" };
export type IntegrityLink = { label: string; href: string };
export type IntegrityTarget = { type: "bankTransaction" | "receivedInvoice" | "issuedInvoice" | "mailDocument" | "reconciliation" | "transfer" | "group"; id: string };
export type IntegrityKnown = { id: string; reason: string; createdAt: string; createdById: string; createdByName: string; updatedAt: string; batchId: string };
export type IntegrityReference = { id: string; fingerprint: string };
export type IntegrityIssue = { fingerprint: string; known?: IntegrityKnown; id: string; kind: IntegrityKind; severity: IntegritySeverity; title: string; detail: string; action: string; date: string; links: IntegrityLink[]; target: IntegrityTarget };
export type IntegrityKindSummary = { kind: IntegrityKind; label: string; description: string; action: string; count: number; knownCount: number };
export type IntegrityReport = {
  company: CompanyScope; today: string; generatedAt: string; total: number;
  counts: Record<IntegrityKind, number>; severity: Record<IntegritySeverity, number>;
  cardSettlements: Array<{ provider: string; label: string; count: number }>;
  knownTotal: number; knownCounts: Record<IntegrityKind, number>; totalIncludingKnown: number; knownTruncated: IntegrityKind[];
  kinds: IntegrityKindSummary[]; truncated: IntegrityKind[]; issues: IntegrityIssue[];
};
export type IntegritySummary = Omit<IntegrityReport, "issues">;
export type IntegrityView = { kind: IntegrityKind | "all"; items: IntegrityIssue[]; page: number; pages: number; pageSize: number; filteredTotal: number; knownOnly: boolean; batches: Array<{ kind: IntegrityKind; targets: IntegrityReference[] }> };


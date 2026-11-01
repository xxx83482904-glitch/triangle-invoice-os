import assert from "node:assert/strict";
import test from "node:test";
import { bankClassificationPresentation } from "../src/lib/bank-classification-presentation";
import { bankClassificationLabel, isGuessClassification, type ClassificationLabelRow } from "../src/lib/bank-classification";

const base: ClassificationLabelRow = { categoryId: "expense", reviewed: false, treatment: "NORMAL", classificationSource: "AUTO", classificationConfidence: "GUESS", classificationReason: "合成: 根拠不足の候補", sourceMissing: false };
for (const [name, patch, expected] of [
  ["guess", {}, "推測"],
  ["history retained after saving", { classificationSource: "MANUAL", classificationConfidence: "HISTORY" }, "過去実績"],
  ["inferred", { classificationConfidence: "INFERRED" }, "推定"],
  ["rule", { classificationSource: "RULE", classificationConfidence: "INFERRED" }, "ルール"],
  ["manual", { classificationSource: "MANUAL", classificationConfidence: "INFERRED" }, "手動"],
  ["legacy history", { classificationSource: "HISTORY", classificationConfidence: undefined }, "過去実績"],
  ["legacy low confidence AI", { classificationConfidence: undefined, classificationReason: "AI候補(確度低)" }, "推測"],
  ["acknowledged guess", { classificationSource: "MANUAL", classificationReason: "推測候補を内容確認のうえ確定: 合成根拠" }, "推測"],
] as Array<[string, Partial<ClassificationLabelRow>, string]>) test(`classification basis survives review: ${name}`, () => {
  const row = { ...base, ...patch }, before = structuredClone(row);
  const unreviewed = bankClassificationPresentation(row), reviewed = bankClassificationPresentation({ ...row, reviewed: true });
  assert.equal(unreviewed.basis.label, expected);
  assert.deepEqual(reviewed.basis, unreviewed.basis);
  assert.equal(unreviewed.status.label, "未確認"); assert.equal(reviewed.status.label, "確認済み");
  assert.equal(reviewed.reason, row.classificationReason);
  assert.deepEqual(row, before);
});

test("hold is a separate status, not a replacement for classification evidence", () => {
  const row = { ...base, reviewed: true, classificationConfidence: "HISTORY" as const, bookkeeping: { hold: { reason: "OTHER" as const, question: "合成: 書類待ち" } } };
  const result = bankClassificationPresentation(row);
  assert.equal(result.basis.label, "過去実績"); assert.equal(result.status.label, "保留");
});

test("missing, split, transfer, excluded and absent reasons are explicit", () => {
  for (const [patch, expected] of [
    [{ sourceMissing: true }, "元明細なし"], [{ categoryId: undefined }, "候補なし"],
    [{ treatment: "TRANSFER" }, "振替"], [{ treatment: "EXCLUDED" }, "対象外"],
    [{ bookkeeping: { splits: [{ id: "part", categoryId: "expense", amount: 100, memo: "" }] } }, "科目分割"],
  ] as Array<[Partial<ClassificationLabelRow>, string]>) assert.equal(bankClassificationPresentation({ ...base, ...patch }).basis.label, expected);
  assert.equal(bankClassificationPresentation({ ...base, classificationReason: undefined }).reason, "分類の理由は記録されていません");
});

test("legacy (China) display and guess confirmation guards are unchanged", () => {
  const reviewed = { ...base, reviewed: true };
  assert.equal(bankClassificationLabel(reviewed).label, "分類確定");
  assert.equal(bankClassificationPresentation(reviewed).basis.label, "推測");
  assert.equal(isGuessClassification(reviewed), true);
});

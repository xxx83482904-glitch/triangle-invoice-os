import { describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { calculateRevisedFee } from '../src/calculator';
import { chineseMoney, createQuotation, parseQuotation, quotationTotals, quoteErrors, quoteFilename } from '../src/quotation';
import { generateQuotationPdf } from '../src/quotationPdf';

const draft = () => createQuotation('钛马赫新展厅', calculateRevisedFee(6300), new Date(2026, 9, 12));
describe('quotation amounts and editable drafts', () => {
  it('takes the exact calculator amount and starts without unrelated client data or marks', () => {
    const q = draft(); expect(quotationTotals(q).total).toBe(4143000); expect(quoteErrors(q)).toEqual([]);
    expect(q.client).toBe(''); expect(q.images).toEqual([]); expect(q.seal).toBeNull(); expect(q.signature).toBeNull();
    expect(JSON.stringify(q)).not.toMatch(/TATA|550 元|首次合作优惠/);
  });
  it('keeps a snapshot independent of the calculator and permits commercial adjustments', () => {
    const q = draft(); q.baseFee = '4000000'; q.additionalFee = '80000'; q.discount = '50000';
    expect(quotationTotals(q).total).toBe(4030000); expect(calculateRevisedFee(6300).totalFee).toBe(4143000);
  });
  it('rounds additive tax to 1 RMB, including half-unit values', () => {
    const q = draft(); q.baseFee = '1001'; q.taxMode = 'excluded'; q.taxRate = '50';
    expect(quotationTotals(q)).toMatchObject({ tax: 501, total: 1502 });
  });
  it('extracts included tax without adding it again', () => {
    const q = draft(); q.baseFee = '1060'; q.taxMode = 'included'; q.taxRate = '6';
    expect(quotationTotals(q)).toMatchObject({ tax: 60, total: 1060 });
  });
  it('ignores an inactive tax rate and never derives total from the displayed average', () => {
    const q = draft(); q.taxRate = 'invalid'; q.area = '1800'; q.baseFee = '1383000';
    expect(quotationTotals(q).total).toBe(1383000); expect(quotationTotals(q).average * 1800).toBeCloseTo(1383000);
  });
  it.each(['', '-1', '0', 'Infinity', '1e5'])('rejects invalid area %s', area => {
    const q = draft(); q.area = area; expect(quoteErrors(q)).toContain('area');
  });
  it.each(['-1', '1.2', 'NaN', '1e6', '1000000000000'])('rejects invalid amount %s', value => {
    const q = draft(); q.baseFee = value; expect(quoteErrors(q)).toContain('money');
  });
  it('rejects negative totals, invalid dates, validity and tax rates', () => {
    const q = draft(); q.discount = '5000000'; expect(quoteErrors(q)).toContain('discount');
    q.discount = '0'; q.date = '2026-02-30'; q.validDays = '0'; q.taxMode = 'excluded'; q.taxRate = '101';
    expect(quoteErrors(q)).toEqual(['date', 'validity', 'tax']);
  });
  it('imports edited text, fees, images and disabled stages without loss', () => {
    const q = draft(); q.client = '新客户'; q.notes = '変更した条件'; q.stages[1].enabled = false;
    q.images = [{ name: 'plan.png', caption: '1F', data: 'data:image/png;base64,aGVsbG8=' }];
    const restored = parseQuotation(JSON.stringify(q));
    expect(restored.client).toBe(q.client); expect(restored.notes).toBe(q.notes); expect(restored.images).toEqual(q.images);
    expect(restored.stages[1].enabled).toBe(false); expect(quotationTotals(restored)).toEqual(quotationTotals(q));
  });
  it('rejects malformed drafts and remote or SVG image payloads', () => {
    expect(() => parseQuotation('{}')).toThrow();
    const q = draft(); q.images = [{ name: 'x', caption: '', data: 'https://example.com/private.png' }];
    expect(() => parseQuotation(JSON.stringify(q))).toThrow();
    q.images[0].data = 'data:image/svg+xml;base64,aGVsbG8='; expect(() => parseQuotation(JSON.stringify(q))).toThrow();
  });
  it('sanitizes a saved filename', () => { const q = draft(); q.project = 'a/b:c'; expect(quoteFilename(q, 'pdf')).toBe('2026-10-12_a_b_c_quotation.pdf'); });
});
describe('RMB uppercase words', () => {
  it.each([
    [0, '零元整'], [10, '壹拾元整'], [101, '壹佰零壹元整'], [1001, '壹仟零壹元整'],
    [10001, '壹万零壹元整'], [100000001, '壹亿零壹元整'], [100010001, '壹亿零壹万零壹元整'],
    [4587000, '肆佰伍拾捌万柒仟元整'], [4143000, '肆佰壹拾肆万叁仟元整'],
    [999999999999, '玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元整'],
  ])('%s -> %s', (n, expected) => expect(chineseMoney(n as number)).toBe(expected));
});
describe('actual PDF documents', () => {
  const font = { body: readFileSync('public/fonts/NotoSansSC-Regular.ttf'), regular: readFileSync('public/fonts/Montserrat-Regular.ttf'), bold: readFileSync('public/fonts/Montserrat-Bold.ttf') };
  it('creates an A4 document with embedded text and no mandatory server', async () => {
    const bytes = await generateQuotationPdf(draft(), font);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4); expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28);
    expect(doc.getTitle()).toContain('钛马赫新展厅');
    mkdirSync('../tmp/pdfs', { recursive: true }); writeFileSync('../tmp/pdfs/quotation-standard.pdf', bytes);
  }, 30000);
  it('paginates long text, renders Japanese, edited tax and image attachments', async () => {
    const q = draft(); q.language = 'ja'; q.title = '空間設計業務 お見積書'; q.client = '株式会社テスト 御中';
    q.notes = '長文の見積条件と業務範囲を確認してください。'.repeat(300); q.payment = '契約時50%\n納品時50%';
    q.taxMode = 'excluded'; q.taxRate = '6'; q.additionalFee = '25000'; q.discount = '10000';
    const image = { name: 'test.png', caption: '添付図面のテスト', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=' };
    q.images = [image]; q.seal = image;
    const bytes = await generateQuotationPdf(q, font); const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(4); writeFileSync('../tmp/pdfs/quotation-long.pdf', bytes);
  }, 30000);
  it('refuses invalid values before creating a customer-facing document', async () => {
    const q = draft(); q.baseFee = '-1'; await expect(generateQuotationPdf(q, font)).rejects.toThrow('validation');
  });
  it('keeps independent columns paginated with long edited scope and a large quote', async () => {
    const q = draft(); q.baseFee = '999999999999'; q.number = 'TR-2026-001';
    q.project = '钛马赫新展厅 / 品牌体验中心与空间设计项目';
    q.stages[0].items = Array.from({ length: 24 }, (_, i) => `第${i + 1}项：根据项目实际情况确认设计目标、材料与空间效果，并与委托方完成方案讨论。`).join('\n');
    q.stages[1].items = q.stages[0].items;
    q.stages[0].deliverables = '第一阶段最终成果，完整保留。';
    q.stages[1].deliverables = '第二阶段最终成果，完整保留。';
    const bytes = await generateQuotationPdf(q, font);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(5);
    writeFileSync('../tmp/pdfs/quotation-columns.pdf', bytes);
  }, 30000);
});

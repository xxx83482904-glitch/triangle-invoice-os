import { expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { calculateRevisedFee } from '../src/calculator';
import { createQuotation, parseQuotation, quoteErrors } from '../src/quotation';
import { dateDay, dayDate, ganttRange, scheduleDays, isWorkday, calendarWarning, reorderTask, parseSchedule, rescheduleTask, scheduleErrors, scheduleRange, scheduleTsv, taskSpan } from '../src/schedule';
import { generateSchedulePdf } from '../src/schedulePdf';
import { generateQuotationPdf } from '../src/quotationPdf';
const draft = () => createQuotation('展示空间设计项目', calculateRevisedFee(6300), new Date(2026, 9, 13));
const ready = () => { const q = draft(); q.schedule.tasks.forEach((t, i) => { t.start = dayDate(dateDay('2026-11-01')! + i * 14); t.end = dayDate(dateDay(t.start)! + 20); t.owner = 'THE TRIANGLE'; t.note = '提交成果后由委托方确认'; }); q.schedule.notes = '各阶段可并行推进。具体日期经双方确认后执行。'; return q; };
const fonts = () => ({ body: readFileSync('public/fonts/NotoSansSC-Regular.ttf'), regular: readFileSync('public/fonts/Montserrat-Regular.ttf'), bold: readFileSync('public/fonts/Montserrat-Bold.ttf') });
it.each(['', '2026-02-29', '2026-02-30', '2026-13-01', '1899-12-31', '2200-01-01', '2026-1-1'])('rejects invalid schedule date %s', v => expect(dateDay(v)).toBeNull());
it('uses inclusive UTC calendar days across leap days and DST', () => { expect(dateDay('2024-03-01')! - dateDay('2024-02-28')!).toBe(2); expect(dateDay('2026-03-09')! - dateDay('2026-03-07')!).toBe(2); });
it('starts without invented dates and migrates old drafts', () => { const q = draft(); expect(q.schedule.includeInQuotation).toBe(false); expect(q.schedule.tasks.every(t => !t.start && !t.end)).toBe(true); const { schedule: _, ...old } = q; expect(parseQuotation(JSON.stringify(old)).schedule).toEqual(q.schedule); });
it('round-trips dates and reordered rows without changing fees', () => { const q = ready(); q.schedule.tasks.reverse(); const restored = parseQuotation(JSON.stringify(q)); expect(restored.schedule.tasks.map(t => t.name)).toEqual(q.schedule.tasks.map(t => t.name)); expect(restored.baseFee).toBe('4143000'); expect(restored.schedule.tasks[0].start).toBe(q.schedule.tasks[0].start); });
it('rejects malformed imports and excessive rows', () => { const q = draft(); expect(() => parseSchedule({ ...q.schedule, tasks: [null] }, [])).toThrow(); expect(() => parseSchedule({ ...q.schedule, tasks: Array(41).fill(q.schedule.tasks[0]) }, [])).toThrow(); });
it('allows overlapping and one-day tasks, rejects reversed and excessive spans', () => { const q = ready(); const t = q.schedule.tasks[0]; t.end = t.start; const range = scheduleRange(q.schedule)!; expect(taskSpan(t, range).days).toBe(1); expect(scheduleErrors(q.schedule, 'ja')).toEqual([]); t.end = '2020-01-01'; expect(scheduleErrors(q.schedule, 'ja').length).toBe(1); t.end = '2199-01-01'; expect(scheduleRange(q.schedule)).toBeNull(); });
it('requires complete dates only when attaching the schedule', () => { const q = draft(); expect(quoteErrors(q)).toEqual([]); q.schedule.includeInQuotation = true; expect(quoteErrors(q)).toContain('schedule'); expect(quoteErrors(ready())).toEqual([]); });
it('exports exact dates and escapes Excel formula text', () => { const q = ready(); q.schedule.tasks[0].name = '=HYPERLINK(test)'; expect(scheduleTsv(q.schedule, 'ja')).toContain("'=HYPERLINK(test)\t2026-11-01\t2026-11-21\t21"); });
it('moves a bar without changing duration, other rows, notes or fees', () => { const q = ready(), original = JSON.stringify(q); const s = rescheduleTask(q.schedule, q.schedule.tasks[0].id, 'move', 7); expect(s.tasks[0].start).toBe('2026-11-08'); expect(s.tasks[0].end).toBe('2026-11-28'); expect(s.tasks[1]).toEqual(q.schedule.tasks[1]); expect(s.notes).toBe(q.schedule.notes); expect(JSON.stringify(q)).toBe(original); });
it.each(['start', 'end'] as const)('resizes the %s edge in days and cannot invert a task', mode => { const q = ready(); const t = q.schedule.tasks[0]; const changed = rescheduleTask(q.schedule, t.id, mode, mode === 'start' ? 100 : -100).tasks[0]; expect(changed.start).toBe(changed.end); expect(mode === 'start' ? changed.end : changed.start).toBe(mode === 'start' ? t.end : t.start); });
it('clamps shifts at project span and supported calendar limits', () => { const q = ready(); const t = q.schedule.tasks[0]; for (const delta of [-999999, 999999]) { const s = rescheduleTask(q.schedule, t.id, 'move', delta); expect(scheduleErrors(s, 'ja')).toEqual([]); expect(dateDay(s.tasks[0].end)! - dateDay(s.tasks[0].start)!).toBe(20); } q.schedule.tasks = [{ ...t, start: '1900-01-01', end: '1900-01-10' }]; expect(rescheduleTask(q.schedule,t.id,'move',-10)).toBe(q.schedule); q.schedule.tasks = [{ ...t, start: '2199-12-20', end: '2199-12-31' }]; expect(rescheduleTask(q.schedule,t.id,'move',10)).toBe(q.schedule); });
it('supports partial drafts and ignores non-finite movement', () => { const q = ready(); q.schedule.tasks[1].start = ''; const s = rescheduleTask(q.schedule,q.schedule.tasks[0].id,'move',1); expect(s.tasks[0].start).toBe('2026-11-02'); expect(rescheduleTask(s,s.tasks[0].id,'move',NaN)).toBe(s); expect(rescheduleTask(s,s.tasks[1].id,'move',1)).toBe(s); });
it('provides a chart for undated drafts and pads a one-day task', () => { const q = draft(); expect(ganttRange(q.schedule,'2026-11-01').days).toBeGreaterThan(55); q.schedule.tasks[0].start = '2026-11-01'; q.schedule.tasks[0].end = '2026-11-01'; const r = ganttRange(q.schedule,'2026-11-01'); expect(r.days).toBeGreaterThan(55); expect(r.start).toBeLessThan(dateDay('2026-11-01')!); expect(r.end).toBeGreaterThan(dateDay('2026-11-01')!); });
it('creates landscape standalone and appended PDFs, retaining quotation pages', async () => { const q = ready(), f = fonts(); const bytes = await generateSchedulePdf(q, f); const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1); expect(pdf.getPage(0).getWidth()).toBeGreaterThan(pdf.getPage(0).getHeight()); mkdirSync('../tmp/pdfs', { recursive: true }); writeFileSync('../tmp/pdfs/schedule-sample.pdf', bytes); writeFileSync('../tmp/pdfs/schedule-draft.json', JSON.stringify(q)); q.schedule.includeInQuotation = true; const attached = await generateQuotationPdf(q, f); const all = await PDFDocument.load(attached); expect(all.getPageCount()).toBe(5); expect(all.getPage(0).getWidth()).toBeLessThan(all.getPage(0).getHeight()); expect(all.getPage(4).getWidth()).toBeGreaterThan(all.getPage(4).getHeight()); writeFileSync('../tmp/pdfs/schedule-attached.pdf', attached); }, 30000);
it('paginates 40 tasks, multiline notes and long metadata without losing content', async () => { const q = ready(); q.schedule.tasks = Array.from({ length: 40 }, (_, i) => ({ ...q.schedule.tasks[0], id: String(i), name: `阶段${i + 1}`, note: i === 0 ? '行\n'.repeat(119) : '备注' })); q.project = '项目名称'.repeat(125); q.schedule.notes = '确认\n'.repeat(400); const bytes = await generateSchedulePdf(q, fonts()); expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(8); writeFileSync('../tmp/pdfs/schedule-long.pdf', bytes); }, 30000);

it('migrates existing schedule drafts and rejects invalid calendar settings', () => {
  const { dayMode, holidayCountry, includeMakeupDays, ...old } = ready().schedule;
  expect(parseSchedule(old, []).dayMode).toBe('calendar');
  for (const patch of [{ dayMode: 'wrong' }, { holidayCountry: 'US' }, { includeMakeupDays: 'yes' }]) expect(() => parseSchedule({ ...old, ...patch }, [])).toThrow();
});
it('counts Japan substitute holidays, citizen holidays and weekends inclusively', () => {
  const s = { ...ready().schedule, dayMode: 'business' as const, holidayCountry: 'JP' as const };
  expect(scheduleDays(s, '2026-05-01', '2026-05-07')).toBe(2);
  expect(scheduleDays(s, '2026-09-19', '2026-09-24')).toBe(1);
  expect(scheduleDays(s, '2027-03-20', '2027-03-23')).toBe(1);
  expect(scheduleDays(s, '2026-11-03', '2026-11-03')).toBe(0);
  expect(scheduleDays(s, '2026-11-02', '2026-11-02')).toBe(1);
});
it('counts China full holiday breaks and optional compensating working weekends', () => {
  const s = { ...ready().schedule, dayMode: 'business' as const, holidayCountry: 'CN' as const };
  expect(scheduleDays(s, '2026-10-01', '2026-10-10')).toBe(3);
  expect(scheduleDays({ ...s, includeMakeupDays: false }, '2026-10-01', '2026-10-10')).toBe(2);
  expect(scheduleDays(s, '2026-02-14', '2026-02-23')).toBe(1);
  for (const d of ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']) expect(isWorkday(s, dateDay(d)!)).toBe(true);
});
it('never guesses holidays for an unsupported year, including across year boundaries', () => {
  const q = ready(); q.schedule.dayMode = 'business';
  expect(scheduleDays(q.schedule, '2026-12-30', '2027-01-02')).toBeNull();
  expect(calendarWarning(q.schedule, 'ja')).toContain('2027');
  expect(scheduleErrors(q.schedule, 'zh').length).toBeGreaterThan(0);
  q.schedule.dayMode = 'calendar'; expect(scheduleErrors(q.schedule, 'ja')).toEqual([]);
  expect(scheduleDays(q.schedule, '2026-12-30', '2027-01-02')).toBe(4);
});
it('reorders by identity without changing dates, rejects moving past either end', () => {
  const s = ready().schedule, first = s.tasks[0];
  expect(reorderTask(s, first.id, -1)).toBe(s);
  const next = reorderTask(s, first.id, 1);
  expect(next.tasks[1]).toBe(first); expect(s.tasks[0]).toBe(first);
  expect(reorderTask(next, first.id, -1)).toEqual(s);
});
it('round-trips calendar settings and exports the selected business-day convention', () => {
  const q = ready(); q.schedule.dayMode = 'business'; q.schedule.holidayCountry = 'JP'; q.schedule.includeMakeupDays = false;
  expect(parseQuotation(JSON.stringify(q)).schedule).toEqual(q.schedule);
  expect(scheduleTsv(q.schedule, 'ja')).toContain('営業日（日本の祝日除外）');
  expect(scheduleTsv(q.schedule, 'ja')).toContain('2026-11-01\t2026-11-21\t14');
});
it('generates a business-day PDF with Japan holidays', async () => {
  const q = ready(); q.schedule.dayMode = 'business'; q.schedule.holidayCountry = 'JP';
  const bytes = await generateSchedulePdf(q, fonts());
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  writeFileSync('../tmp/pdfs/schedule-business.pdf', bytes);
  writeFileSync('../tmp/pdfs/schedule-business-draft.json', JSON.stringify(q));
}, 30000);

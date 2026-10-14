import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Quotation } from './quotation';
import { addPageFooters, loadQuoteFont, type QuotationFonts } from './pdfAssets';
import { dateDay, dayDate, scheduleExportNotes, scheduleDays, calendarLabel, restBands, scheduleErrors, scheduleRange, scheduleTicks, taskSpan } from './schedule';

export function scheduleDocumentErrors(q: Quotation): string[] {
  return [...scheduleErrors(q.schedule, q.language), ...(!q.project.trim() || !q.issuer.trim() || dateDay(q.date) === null ? [q.language === 'ja' ? '案件名・発行会社・有効な発行日を入力してください。' : '请填写项目名称、出具公司及有效的出具日期。'] : [])];
}

export function appendSchedulePages(pdf: PDFDocument, q: Quotation, fonts: { body: PDFFont; regular: PDFFont; bold: PDFFont }) {
  if (scheduleDocumentErrors(q).length) throw new Error('validation');
  const s = q.schedule, range = scheduleRange(s)!;
  const j = (ja: string, zh: string) => q.language === 'ja' ? ja : zh;
  const W = 841.89, H = 595.28, L = 42, R = W - L, bottom = 78;
  const ink = rgb(.08, .08, .08), gray = rgb(.45, .45, .45), line = rgb(.85, .85, .85);
  let page: PDFPage, y = 0;
  function draw(value: string, x: number, top: number, size = 9, face = fonts.body, muted = false) {
    if (value) page.drawText(value, { x, y: top - size, size, font: face, color: muted ? gray : ink });
  }
  function wrap(value: string, width: number, size = 9): string[] {
    const lines: string[] = [];
    for (const p of value.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
      let current = '';
      for (const c of p) {
        if (current && fonts.body.widthOfTextAtSize(current + c, size) > width) {
          const split = current.search(/[A-Za-z]+$/);
          if (/[A-Za-z]/.test(c) && split > 0) { lines.push(current.slice(0, split).trimEnd()); current = current.slice(split); }
          else { lines.push(current); current = ''; }
        }
        current += c;
      }
      lines.push(current);
    }
    return lines;
  }
  function newPage() {
    page = pdf.addPage([W, H]); y = H - 35;
    draw('PROJECT SCHEDULE', L, y, 10, fonts.bold); draw(q.date, R - 75, y, 9, fonts.regular); y -= 28;
  }
  function flow(value: string, size = 9, leading = 14) {
    for (const text of wrap(value, R - L, size)) {
      if (y - leading < bottom) newPage();
      draw(text, L, y, size); y -= leading;
    }
  }
  const chartX = 320, chartW = R - chartX;
  function tableHeader() {
    if (y - 70 < bottom) newPage();
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: .7, color: ink });
    y -= 12;
    draw(j('工程', '阶段'), L + 5, y, 8);
    draw(s.dayMode === 'business' ? j('開始 → 終了 / 営業日', '开始 → 结束 / 工作日') : j('開始 → 終了 / 暦日', '开始 → 结束 / 自然日'), 185, y, 8);
    scheduleTicks(range).forEach(t => draw(t.label, chartX + t.position * chartW + 2, y, 7, fonts.regular, true));
    y -= 23;
  }
  newPage();
  flow(s.title, 18, 25); y -= 5;
  flow(q.project, 12, 18);
  flow(q.issuer, 9, 14);
  if (q.client.trim()) flow(`${j('宛先', '委托方')}：${q.client}`);
  flow(`${dayDate(range.start)} — ${dayDate(range.end)}  /  ${scheduleDays(s, dayDate(range.start), dayDate(range.end))} ${calendarLabel(s, q.language)}`, 9, 18);
  if (s.dayMode === 'business') flow(j('日付の横軸は暦日。薄い背景は休業日で、日数から除外しています。', '日期横轴按自然日显示。浅色背景为休息日，已从天数中扣除。'), 8, 16);
  const holidays = restBands(s, range);
  y -= 10; tableHeader();
  s.tasks.forEach((task, index) => {
    const span = taskSpan(task, range);
    const name = wrap(`${String(index + 1).padStart(2, '0')}  ${task.name}`, 130);
    const labels = name.map(text => ({ text, size: 9, muted: false }));
    const count = Math.max(labels.length, 1);
    let offset = 0;
    while (offset < count) {
      if (y - 48 < bottom) { newPage(); tableHeader(); }
      const capacity = Math.max(1, Math.floor((y - bottom - 18) / 13));
      const take = Math.min(count - offset, capacity);
      const height = Math.max(48, take * 13 + 18);
      labels.slice(offset, offset + take).forEach((t, i) => draw(t.text, L + 5, y - 10 - i * 13, t.size, fonts.body, t.muted));
      draw(task.start, 185, y - 10, 8, fonts.regular);
      draw(`→ ${task.end}`, 185, y - 23, 8);
      draw(`${scheduleDays(s, task.start, task.end)} ${j('日', '天')}${offset ? j(' / 続き', ' / 续') : ''}`, 185, y - 36, 8, fonts.body, true);
      holidays.forEach(b => page.drawRectangle({ x: chartX + b.offset * chartW, y: y - height, width: b.width * chartW, height, color: rgb(.94, .94, .92) }));
      scheduleTicks(range).forEach(t => page.drawLine({ start: { x: chartX + t.position * chartW, y }, end: { x: chartX + t.position * chartW, y: y - height }, thickness: .4, color: line }));
      const barX = chartX + span.offset * chartW, barW = Math.max(.7, span.width * chartW);
      page.drawRectangle({ x: barX, y: y - 30, width: Math.min(barW, R - barX), height: 10, color: ink });
      y -= height;
      page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: .4, color: line });
      offset += take;
    }
  });
  const notes = scheduleExportNotes(s);
  if (notes.length) {
    y -= 14; if (y - 32 < bottom) newPage();
    flow(j('備考', '备注'), 10, 16);
    notes.forEach(note => { flow(note, 8.5, 12); y -= 2; });
  }
}

export async function generateSchedulePdf(q: Quotation, fontBytes?: QuotationFonts) {
  if (scheduleDocumentErrors(q).length) throw new Error('validation');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const bytes = fontBytes ?? await loadQuoteFont();
  const [body, regular, bold] = await Promise.all([bytes.body, bytes.regular, bytes.bold].map(b => pdf.embedFont(b, { subset: true })));
  const supported = new Set(body.getCharacterSet());
  for (const ch of JSON.stringify({ project: q.project, issuer: q.issuer, client: q.client, schedule: { ...q.schedule, tasks: q.schedule.tasks.map(({ owner: _owner, ...task }) => task) } })) {
    if (ch.codePointAt(0)! >= 32 && !supported.has(ch.codePointAt(0)!)) throw new Error(`glyph:${ch}`);
  }
  pdf.setTitle(`${q.schedule.title} - ${q.project}`); pdf.setAuthor(q.issuer); pdf.setCreator('THE TRIANGLE.JP');
  appendSchedulePages(pdf, q, { body, regular, bold }); addPageFooters(pdf, regular);
  return pdf.save();
}

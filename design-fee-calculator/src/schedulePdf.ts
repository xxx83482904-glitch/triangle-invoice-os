import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Quotation } from './quotation';
import { addPageFooters, loadQuoteFont, type QuotationFonts } from './pdfAssets';
import { dateDay, dayDate, scheduleExportNotes, scheduleDays, calendarLabel, restBands, scheduleErrors, scheduleRange, timelineAxis, taskSpan } from './schedule';

export function scheduleDocumentErrors(q: Quotation): string[] {
  return [...scheduleErrors(q.schedule, q.language), ...(!q.project.trim() || !q.issuer.trim() || dateDay(q.date) === null ? [q.language === 'ja' ? '案件名・発行会社・有効な発行日を入力してください。' : '请填写项目名称、出具公司及有效的出具日期。'] : [])];
}

export function appendSchedulePages(pdf: PDFDocument, q: Quotation, fonts: { body: PDFFont; regular: PDFFont; bold: PDFFont }) {
  if (scheduleDocumentErrors(q).length) throw new Error('validation');
  const s = q.schedule, range = scheduleRange(s)!, axis = timelineAxis(range);
  const j = (ja: string, zh: string) => q.language === 'ja' ? ja : zh;
  const W = 841.89, H = 595.28, L = 48, R = W - L, bottom = 72;
  const ink = rgb(.08, .08, .08), gray = rgb(.43, .43, .43), line = rgb(.88, .88, .88);
  const chartX = 270, chartW = R - chartX;
  let page!: PDFPage, y = 0;
  function draw(value: string, x: number, top: number, size = 9, face = fonts.body, muted = false) {
    if (value) page.drawText(value, { x, y: top - size, size, font: face, color: muted ? gray : ink });
  }
  function rule(top: number, left = L, right = R, strong = false) {
    page.drawLine({ start: { x: left, y: top }, end: { x: right, y: top }, thickness: strong ? .7 : .35, color: strong ? ink : line });
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
    page = pdf.addPage([W, H]); y = H - 34;
    draw('PROJECT SCHEDULE', L, y, 8, fonts.bold);
    draw(`${j('発行日', '出具日期')}  ${q.date.replaceAll('-', '.')}`, R - 118, y, 8, fonts.body, true);
    y -= 24;
  }
  function flow(value: string, size = 9, leading = 14, width = R - L) {
    for (const text of wrap(value, width, size)) {
      if (y - leading < bottom) newPage();
      draw(text, L, y, size); y -= leading;
    }
  }
  function tableHeader() {
    if (y - 96 < bottom) newPage();
    rule(y, L, R, true);
    draw(j('工程', '阶段'), L, y - 10, 9);
    draw(j('開始日 — 終了日', '开始日期 — 结束日期'), L, y - 27, 7.5, fonts.body, true);
    axis.bands.forEach(b => {
      const x = chartX + b.position * chartW, width = b.width * chartW;
      page.drawRectangle({ x, y: y - 23, width, height: 22, color: rgb(.974, .974, .974) });
      const label = width >= fonts.regular.widthOfTextAtSize(b.label, 8) + 10 ? b.label : b.label.includes('.') ? b.label.slice(-2) : b.label;
      if (width >= fonts.regular.widthOfTextAtSize(label, 8) + 4) draw(label, x + 2, y - 7, 8, fonts.regular);
      page.drawLine({ start: { x, y }, end: { x, y: y - 23 }, thickness: .35, color: line });
    });
    axis.ticks.forEach(t => {
      const x = chartX + t.position * chartW;
      if (x + fonts.regular.widthOfTextAtSize(t.label, 7) + 3 <= R) draw(t.label, x + 3, y - 29, 7, fonts.regular, true);
    });
    y -= 45; rule(y);
  }
  newPage();
  const metaTop = y, headerPage = page;
  const total = scheduleDays(s, dayDate(range.start), dayDate(range.end));
  draw(`${j('期間', '周期')} · ${s.tasks.length} ${j('工程', '阶段')} · ${total} ${s.dayMode === 'business' ? j('営業日', '工作日') : j('日', '天')}`, 559, metaTop, 8, fonts.body, true);
  draw(`${dayDate(range.start).replaceAll('-', '.')} — ${dayDate(range.end).replaceAll('-', '.')}`, 559, metaTop - 16, 10, fonts.regular);
  const modeLines = wrap(calendarLabel(s, q.language), R - 559, 7.5);
  modeLines.forEach((text, i) => draw(text, 559, metaTop - 35 - i * 11, 7.5, fonts.body, true));
  if (s.dayMode === 'business') draw(j('薄い背景：休業日 / 横軸：暦日', '浅灰背景：休息日 / 横轴：自然日'), 559, metaTop - 35 - modeLines.length * 11, 7.5, fonts.body, true);
  flow(s.title, 16, 23, 456);
  flow(q.project, 11, 17, 456);
  flow(q.issuer, 8, 13, 456);
  if (q.client.trim()) flow(`${j('宛先', '委托方')}：${q.client}`, 8, 13, 456);
  if (page === headerPage) y = Math.min(y, metaTop - 43 - (modeLines.length + (s.dayMode === 'business' ? 1 : 0)) * 11);
  y -= 18;
  const holidays = restBands(s, range);
  tableHeader();
  s.tasks.forEach((task, index) => {
    const span = taskSpan(task, range), labels = wrap(task.name, chartX - L - 42, 9);
    let offset = 0;
    while (offset < labels.length) {
      if (y - 48 < bottom) { newPage(); tableHeader(); }
      const capacity = Math.max(1, Math.floor((y - bottom - 28) / 11));
      const take = Math.min(labels.length - offset, capacity), height = Math.max(48, take * 11 + 28);
      draw(String(index + 1).padStart(2, '0'), L, y - 11, 8, fonts.regular, true);
      labels.slice(offset, offset + take).forEach((text, i) => draw(text, L + 25, y - 9 - i * 11, 9));
      draw(`${task.start.replaceAll('-', '.')} — ${task.end.replaceAll('-', '.')}${offset ? j(' / 続き', ' / 续') : ''}`, L + 25, y - height + 17, 7, fonts.body, true);
      holidays.forEach(b => page.drawRectangle({ x: chartX + b.offset * chartW, y: y - height, width: b.width * chartW, height, color: rgb(.965, .965, .965) }));
      axis.bands.slice(1).forEach(b => page.drawLine({ start: { x: chartX + b.position * chartW, y }, end: { x: chartX + b.position * chartW, y: y - height }, thickness: .5, color: line }));
      axis.ticks.forEach(t => page.drawLine({ start: { x: chartX + t.position * chartW, y }, end: { x: chartX + t.position * chartW, y: y - height }, thickness: .3, color: line }));
      const barX = chartX + span.offset * chartW, barW = Math.min(Math.max(.7, span.width * chartW), R - barX), center = y - height / 2;
      page.drawRectangle({ x: barX, y: center - 5, width: barW, height: 10, color: ink });
      for (const x of [barX, barX + barW]) page.drawLine({ start: { x, y: center - 7 }, end: { x, y: center + 7 }, thickness: .6, color: ink });
      const duration = `${scheduleDays(s, task.start, task.end)} ${s.dayMode === 'business' ? j('営業日', '工作日') : j('日', '天')}`;
      const labelX = Math.max(chartX + 2, Math.min(barX + 4, R - fonts.body.widthOfTextAtSize(duration, 7.5)));
      draw(duration, labelX, center + 20, 7.5, fonts.body, true);
      y -= height; rule(y); offset += take;
    }
  });
  const notes = scheduleExportNotes(s);
  if (notes.length) {
    y -= 19; if (y - 32 < bottom) newPage();
    draw('NOTES', L, y, 7, fonts.bold, true); y -= 15;
    flow(j('備考', '备注'), 9, 15);
    notes.forEach(note => { flow(note, 8, 11); y -= 2; });
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

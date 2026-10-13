import type { Language } from './pricing';

export type ScheduleTask = { id: string; name: string; start: string; end: string; owner: string; note: string };
export type Schedule = { includeInQuotation: boolean; title: string; notes: string; tasks: ScheduleTask[] };
export const MAX_TASKS = 40;
const DAY = 86_400_000;
export function dateDay(value: string): number | null {
  if (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY : null;
}
export const dayDate = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
export function createSchedule(stages: { title: string; enabled: boolean }[]): Schedule {
  return { includeInQuotation: false, title: '设计进度计划', notes: '', tasks: stages.filter(s => s.enabled).slice(0, MAX_TASKS).map((s, i) => ({ id: `schedule-${i}`, name: s.title.slice(0, 120), start: '', end: '', owner: '', note: '' })) };
}
export function parseSchedule(raw: unknown, stages: { title: string; enabled: boolean }[]): Schedule {
  if (raw === undefined) return createSchedule(stages);
  if (!raw || typeof raw !== 'object') throw new Error('schedule');
  const s = raw as Schedule;
  if (typeof s.includeInQuotation !== 'boolean' || typeof s.title !== 'string' || s.title.length > 200 || typeof s.notes !== 'string' || s.notes.length > 2000 || !Array.isArray(s.tasks) || s.tasks.length > MAX_TASKS) throw new Error('schedule');
  return { includeInQuotation: s.includeInQuotation, title: s.title, notes: s.notes, tasks: s.tasks.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error('schedule');
    for (const [key, max] of [['name', 120], ['start', 10], ['end', 10], ['owner', 80], ['note', 240]] as const) {
      if (typeof t[key] !== 'string' || t[key].length > max) throw new Error('schedule');
    }
    return { id: `schedule-${i}`, name: t.name, start: t.start, end: t.end, owner: t.owner, note: t.note };
  }) };
}
export function scheduleErrors(s: Schedule, lang: Language): string[] {
  const j = (ja: string, zh: string) => lang === 'ja' ? ja : zh;
  const errors: string[] = [];
  if (!s.title.trim()) errors.push(j('スケジュール表の表題を入力してください。', '请填写进度表标题。'));
  if (!s.tasks.length || s.tasks.length > MAX_TASKS) errors.push(j(`工程は1〜${MAX_TASKS}件にしてください。`, `请填写1至${MAX_TASKS}个阶段。`));
  s.tasks.forEach((t, i) => {
    if (!t.name.trim()) errors.push(j(`工程${i + 1}：工程名を入力してください。`, `阶段${i + 1}：请填写名称。`));
    const start = dateDay(t.start), end = dateDay(t.end);
    if (start === null || end === null) errors.push(j(`工程${i + 1}：1900〜2199年の有効な開始日・終了日を入力してください。`, `阶段${i + 1}：请填写1900至2199年的有效开始、结束日期。`));
    else if (end < start) errors.push(j(`工程${i + 1}：終了日を開始日以降にしてください。`, `阶段${i + 1}：结束日期不得早于开始日期。`));
  });
  if (!errors.length) {
    const starts = s.tasks.map(t => dateDay(t.start)!), ends = s.tasks.map(t => dateDay(t.end)!);
    if (Math.max(...ends) - Math.min(...starts) + 1 > 3660) errors.push(j('全体の期間は3,660日以内にしてください。', '总工期不得超过3,660天。'));
  }
  return errors;
}
export function scheduleRange(s: Schedule) {
  if (scheduleErrors(s, 'ja').length) return null;
  const start = Math.min(...s.tasks.map(t => dateDay(t.start)!));
  const end = Math.max(...s.tasks.map(t => dateDay(t.end)!));
  return { start, end, days: end - start + 1 };
}
export function taskSpan(t: ScheduleTask, range: { start: number; days: number }) {
  const start = dateDay(t.start)!, end = dateDay(t.end)!;
  return { offset: (start - range.start) / range.days, width: (end - start + 1) / range.days, days: end - start + 1 };
}
/** Compact date labels for the PDF, including inclusive end dates. */
export function scheduleTicks(range: { start: number; days: number }) {
  const count = Math.min(8, range.days);
  return Array.from({ length: count }, (_, i) => {
    const offset = Math.floor(i * range.days / count);
    return { position: offset / range.days, label: dayDate(range.start + offset).slice(5).replace('-', '/') };
  });
}
export function scheduleTsv(s: Schedule, lang: Language) {
  const cell = (v: string) => { const clean = v.replace(/[\r\n\t]+/g, ' '); return /^[\s]*[=+\-@]/.test(clean) ? `'${clean}` : clean; };
  const header = lang === 'ja' ? ['工程', '開始日', '終了日', '日数（暦日）', '担当', '備考'] : ['阶段', '开始日期', '结束日期', '天数（自然日）', '负责人', '备注'];
  return [header, ...s.tasks.map(t => [t.name, t.start, t.end, dateDay(t.start) !== null && dateDay(t.end) !== null ? String(dateDay(t.end)! - dateDay(t.start)! + 1) : '', t.owner, t.note])].map(row => row.map(cell).join('\t')).join('\n');
}

export type ScheduleDragMode = 'move' | 'start' | 'end';
/** Move in whole calendar days, clamping both the date limits and total project span. */
export function rescheduleTask(s: Schedule, id: string, mode: ScheduleDragMode, delta: number): Schedule {
  const task = s.tasks.find(t => t.id === id);
  if (!task || !Number.isFinite(delta)) return s;
  const start = dateDay(task.start), end = dateDay(task.end);
  if (start === null || end === null || end < start) return s;
  const others = s.tasks.filter(t => t.id !== id).flatMap(t => {
    const a = dateDay(t.start), b = dateDay(t.end); return a !== null && b !== null && b >= a ? [a, b] : [];
  });
  const low = Math.max(dateDay('1900-01-01')!, others.length ? Math.max(...others) - 3659 : -Infinity);
  const high = Math.min(dateDay('2199-12-31')!, others.length ? Math.min(...others) + 3659 : Infinity);
  if (low > high) return s;
  let a = start, b = end, step = Math.round(delta);
  if (mode === 'move') { step = Math.max(low - start, Math.min(high - end, step)); a += step; b += step; }
  else if (mode === 'start') a = Math.max(low, end - 3659, Math.min(end, start + step));
  else b = Math.min(high, start + 3659, Math.max(start, end + step));
  if (a < low || b > high || b < a || b - a > 3659 || (a === start && b === end)) return s;
  return { ...s, tasks: s.tasks.map(t => t.id === id ? { ...t, start: dayDate(a), end: dayDate(b) } : t) };
}

/** Partial drafts remain editable: valid rows can be moved before all rows are dated. */
export function ganttRange(s: Schedule, anchor: string) {
  const dated = s.tasks.flatMap(t => { const a = dateDay(t.start), b = dateDay(t.end); return a !== null && b !== null && b >= a ? [a, b] : []; });
  const first = dated.length ? Math.min(...dated) : dateDay(anchor)!;
  const partial = dated.length < s.tasks.length * 2;
  const last = dated.length ? Math.max(...dated, ...(partial ? [first + 55] : [])) : first + 55;
  const padding = Math.max(3, Math.min(14, Math.ceil((last - first + 1) * .08)));
  const start = Math.max(dateDay('1900-01-01')!, first - padding);
  const end = Math.min(dateDay('2199-12-31')!, last + padding);
  return { start, end, days: end - start + 1 };
}

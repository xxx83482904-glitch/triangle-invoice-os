import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Language } from './pricing';
import { dateDay, dayDate, ganttRange, rescheduleTask, MAX_TASKS, reorderTask, reorderTaskTo, scheduleDays, calendarLabel, restBands, timelineAxis, type Schedule, type ScheduleDragMode } from './schedule';

type RowDrag = { pointer: number; id: string; source: Schedule; y: number; target: number; scroll: HTMLElement; frame: number };
type Drag = { pointer: number; x: number; pixels: number; source: Schedule; preview: Schedule; id: string; mode: ScheduleDragMode; delta: number };
export default function ScheduleGantt({ value, onChange, lang, onEdit }: { value: Schedule; onChange: (s: Schedule) => void; lang: Language; onEdit: (id: string) => void }) {
  const j = (ja: string, zh: string) => lang === 'ja' ? ja : zh;
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const [zoom, setZoom] = useState('fit');
  const [preview, setPreview] = useState<Schedule | null>(null);
  const [status, setStatus] = useState({ text: '', snapshot: '' });
  const [history, setHistory] = useState<{ before: Schedule; after: Schedule }[]>([]);
  const dragging = useRef<Drag | null>(null);
  const rowDragging = useRef<RowDrag | null>(null);
  const [rowDrop, setRowDrop] = useState<{ id: string; target: number } | null>(null);
  useEffect(() => () => { if (rowDragging.current) cancelAnimationFrame(rowDragging.current.frame); }, []);
  function cancelRow() {
    if (rowDragging.current) cancelAnimationFrame(rowDragging.current.frame);
    rowDragging.current = null; setRowDrop(null);
  }
  function trackRow() {
    const d = rowDragging.current; if (!d) return;
    const box = d.scroll.getBoundingClientRect();
    const edge = 48, top = Math.max(0, box.top), bottom = Math.min(window.innerHeight, box.bottom);
    if (d.y < top + edge) d.scroll.scrollTop -= Math.min(16, (top + edge - d.y) / 3);
    else if (d.y > bottom - edge) d.scroll.scrollTop += Math.min(16, (d.y - box.bottom + edge) / 3);
    locateRow(d);
    d.frame = requestAnimationFrame(trackRow);
  }
  function locateRow(d: RowDrag) {
    const rows = [...d.scroll.querySelectorAll<HTMLElement>('[data-gantt-task]')];
    let distance = Infinity, target = d.target;
    rows.forEach((row, i) => { const r = row.getBoundingClientRect(), gap = Math.abs(d.y - (r.top + r.height / 2)); if (gap < distance) { distance = gap; target = i; } });
    if (target !== d.target) { d.target = target; setRowDrop({ id: d.id, target }); }
  }
  function beginRow(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (!e.isPrimary || e.button !== 0 || e.currentTarget.matches(':disabled')) return;
    e.preventDefault(); cancelRow(); e.currentTarget.focus({ preventScroll: true });
    const target = value.tasks.findIndex(t => t.id === id);
    rowDragging.current = { pointer: e.pointerId, id, source: value, y: e.clientY, target, scroll: e.currentTarget.closest('.gantt-scroll') as HTMLElement, frame: 0 };
    setRowDrop({ id, target }); e.currentTarget.setPointerCapture(e.pointerId); trackRow();
  }
  function finishRow(e: PointerEvent<HTMLButtonElement>) {
    const d = rowDragging.current; if (!d || d.pointer !== e.pointerId) return;
    d.y = e.clientY; locateRow(d);
    const next = reorderTaskTo(d.source, d.id, d.target); cancelRow(); commit(next);
    setStatus({ text: j(`工程を${d.target + 1}番目に移動しました。`, `阶段已移至第${d.target + 1}行。`), snapshot: JSON.stringify(next) });
  }
  const range = ganttRange(value, anchor), shown = preview ?? value;
  const holidays = restBands(value, range);
  const undo = history.at(-1), canUndo = undo && JSON.stringify(undo.after) === JSON.stringify(value);
  const axis = timelineAxis(range);
  function commit(next: Schedule) {
    if (next === value || JSON.stringify(next) === JSON.stringify(value)) return;
    setHistory(old => [...(canUndo ? old : []), { before: value, after: next }].slice(-20)); onChange(next);
  }
  function editText(id: string, key: 'name', text: string) {
    onChange({ ...value, tasks: value.tasks.map(t => t.id === id ? { ...t, [key]: text } : t) });
  }
  function addTask() {
    if (value.tasks.length >= MAX_TASKS) return;
    const id = crypto.randomUUID();
    commit({ ...value, tasks: [...value.tasks, { id, name: '', start: '', end: '', owner: '', note: '' }] });
    requestAnimationFrame(() => document.getElementById(`gantt-name-${id}`)?.focus());
  }
  function begin(e: PointerEvent<HTMLButtonElement>, id: string, mode: ScheduleDragMode) {
    if (!e.isPrimary || e.button !== 0 || e.currentTarget.matches(':disabled')) return;
    e.preventDefault();
    const track = e.currentTarget.closest('.gantt-track') as HTMLElement;
    dragging.current = { pointer: e.pointerId, x: e.clientX, pixels: track.getBoundingClientRect().width / range.days, source: value, preview: value, id, mode, delta: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    const delta = Math.round((e.clientX - d.x) / d.pixels);
    if (d.delta === delta) return;
    d.delta = delta; d.preview = rescheduleTask(d.source, d.id, d.mode, delta); setPreview(d.preview);
  }
  function finish(e: PointerEvent<HTMLButtonElement>) {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    dragging.current = null; setPreview(null); commit(d.preview);
    const t = d.preview.tasks.find(t => t.id === d.id)!;
    setStatus({ text: `${t.name}: ${t.start} → ${t.end}`, snapshot: JSON.stringify(d.preview) });
  }
  function cancel() { dragging.current = null; setPreview(null); }
  function control(id: string, mode: ScheduleDragMode) {
    return {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => begin(e, id, mode), onPointerMove: move, onPointerUp: finish,
      onPointerCancel: cancel, onLostPointerCapture: cancel,
      onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'Escape') { cancel(); return; }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); const next = rescheduleTask(value, id, mode, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1)); commit(next);
        const t = next.tasks.find(t => t.id === id)!; setStatus({ text: `${t.name}: ${t.start} → ${t.end}`, snapshot: JSON.stringify(next) });
      },
    };
  }
  const unplanned = value.tasks.some(t => dateDay(t.start) === null || dateDay(t.end) === null || t.end < t.start);
  return <section className="gantt-editor" aria-label={j('ガントチャート編集', '编辑甘特图')}>
    <div className="gantt-toolbar"><div><h3>{j('工程スケジュール', '项目进度')}</h3><p className="small-note">{j('左の取っ手を上下にドラッグして並べ替え。横棒は左右に動かして日程を調整。', '上下拖动左侧把手排列阶段，左右拖动横条调整日期。')}</p></div><div className="gantt-tools"><button className="button" type="button" disabled={value.tasks.length >= MAX_TASKS} onClick={addTask}>＋ {j('工程を追加', '添加阶段')}</button>
      <label>{j('表示', '视图')}<select aria-label={j('ガントチャートの表示倍率', '甘特图缩放')} value={zoom} onChange={e => setZoom(e.target.value)}><option value="fit">{j('全体', '全览')}</option><option value="12">{j('週単位', '按周')}</option><option value="28">{j('日単位', '按日')}</option></select></label>
      <button type="button" className="button" disabled={!canUndo || !!preview || !!rowDrop} onClick={() => { if (canUndo) { onChange(undo.before); setHistory(old => old.slice(0, -1)); setStatus({ text: j('直前のチャート操作を元に戻しました。', '已撤销上一次图表操作。'), snapshot: JSON.stringify(undo.before) }); } }}>{j('元に戻す', '撤销')}</button>
    </div></div>
    {unplanned && <div className="gantt-empty-hint"><span>{j('日付が未設定の工程は、チャートの空欄をクリック・タップして7日間の横棒を配置できます。', '未设日期的阶段可点击图表空白处，放置7天横条。')}</span>{value.tasks.every(t => !t.start && !t.end) && <label>{j('表示する基準日', '显示起始日期')}<input type="date" min="1900-01-01" max="2199-12-31" value={anchor} onChange={e => { if (dateDay(e.target.value) !== null) setAnchor(e.target.value); }} /></label>}</div>}
    <div className="gantt-overview"><span>{dayDate(range.start).replaceAll('-', '.')} — {dayDate(range.end).replaceAll('-', '.')}</span><span>{shown.tasks.length} {j('工程', '阶段')}<i />{calendarLabel(value, lang)}</span></div>
    <div className="gantt-scroll" tabIndex={0} role="region" aria-label={j('工程別スケジュール表', '阶段进度表')}>
      <div className="gantt-sheet" style={{ width: zoom === 'fit' ? '100%' : Math.min(100000, Math.max(860, 280 + range.days * Number(zoom))) }}>
        <div className="gantt-row gantt-heading"><div className="gantt-name"><span>{j('工程', '阶段')}</span><small>{j('工程名を直接編集', '直接编辑阶段名称')}</small></div><div className="gantt-axis">
          <div className="gantt-months">{axis.bands.map(b => <span key={b.label} title={b.label} className={b.width <= .075 ? 'is-short' : undefined} style={{ left: `${b.position * 100}%`, width: `${b.width * 100}%` }}>{b.width > .075 ? b.label : b.width > .025 && b.label.includes('.') ? b.label.slice(-2) : ''}</span>)}</div>
          <div className="gantt-weeks">{axis.ticks.map(t => <span key={t.position} style={{ left: `${t.position * 100}%` }}>{t.label}</span>)}</div>
        </div></div>
        {shown.tasks.map((t, i) => {
          const start = dateDay(t.start), end = dateDay(t.end), valid = start !== null && end !== null && end >= start;
          const days = valid ? scheduleDays(shown, t.start, t.end) : null;
          const sourceIndex = rowDrop ? shown.tasks.findIndex(task => task.id === rowDrop.id) : -1;
          const dropClass = rowDrop?.target === i && sourceIndex !== i ? (sourceIndex < i ? ' drop-after' : ' drop-before') : '';
          return <div className={`gantt-row${dropClass}${rowDrop?.id === t.id ? ' row-dragging' : ''}`} data-gantt-task={t.id} key={t.id}>
            <div className="gantt-name gantt-task-fields">
              <div className="gantt-row-actions"><button type="button" className="gantt-row-grip" aria-label={`${i + 1} ${j('工程を上下にドラッグ', '上下拖动阶段')}`} title={j('上下にドラッグ／↑ ↓で並べ替え', '上下拖动／↑ ↓排列')} disabled={value.tasks.length < 2}
                  onPointerDown={e => beginRow(e, t.id)} onPointerMove={e => { const d = rowDragging.current; if (d?.pointer === e.pointerId) { d.y = e.clientY; locateRow(d); } }} onPointerUp={finishRow} onPointerCancel={cancelRow} onLostPointerCapture={cancelRow}
                  onKeyDown={e => { if (e.key === 'Escape') { cancelRow(); return; } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); commit(reorderTask(value, t.id, e.key === 'ArrowUp' ? -1 : 1)); } }}>⠿</button><span>{String(i + 1).padStart(2, '0')}</span>
              </div>
              <textarea rows={2} id={`gantt-name-${t.id}`} className="gantt-inline-name" aria-label={`${i + 1} ${j('ガント工程名', '甘特图阶段名称')}`} placeholder={j('工程名を入力', '输入阶段名称')} maxLength={120} value={t.name} onChange={e => editText(t.id, 'name', e.target.value)} />
              <div className="gantt-date-line"><button type="button" className="gantt-details" onClick={() => onEdit(t.id)}>{valid ? `${t.start.replaceAll('-', '.')} → ${t.end.slice(t.start.slice(0, 4) === t.end.slice(0, 4) ? 5 : 0).replaceAll('-', '.')}` : j('日付を設定', '设置日期')}<span aria-hidden="true">↗</span></button><span className="gantt-duration">{valid ? `${days ?? '—'}${value.dayMode === 'business' ? j('営業日', '工作日') : j('日', '天')}` : '—'}</span></div>
            </div>
            <div className="gantt-track">
              {axis.bands.slice(1).map(band => <span key={band.label} className="gantt-gridline is-month" aria-hidden="true" style={{ left: `${band.position * 100}%` }} />)}
              {axis.ticks.map(tick => <span key={tick.position} className="gantt-gridline" aria-hidden="true" style={{ left: `${tick.position * 100}%` }} />)}
              {holidays.map((band, n) => <span key={n} className="gantt-rest" aria-hidden="true" style={{ left: `${band.offset * 100}%`, width: `${band.width * 100}%` }} />)}
              {valid ? <div className={`gantt-bar${preview && dragging.current?.id === t.id ? ' is-dragging' : ''}`} style={{ left: `${(start - range.start) / range.days * 100}%`, width: `${(end - start + 1) / range.days * 100}%` }}>
                <button type="button" className="gantt-handle gantt-start" aria-label={`${i + 1} ${j('開始日を変更', '调整开始日期')}`} title={j('開始日をドラッグ／← →で1日ずつ', '拖动开始日期／← →调整1天')} {...control(t.id, 'start')}><span /></button>
                <button type="button" className="gantt-move" aria-label={`${i + 1} ${j('工程を移動', '移动阶段')}`} title={`${t.name}: ${t.start} → ${t.end}`} {...control(t.id, 'move')}><span>{String(i + 1).padStart(2, '0')}<b>{days ?? '—'}{value.dayMode === 'business' ? j('営業日', '工作日') : j('日', '天')}</b></span></button>
                <button type="button" className="gantt-handle gantt-end" aria-label={`${i + 1} ${j('終了日を変更', '调整结束日期')}`} title={j('終了日をドラッグ／← →で1日ずつ', '拖动结束日期／← →调整1天')} {...control(t.id, 'end')}><span /></button>
              </div> : <button type="button" className="gantt-place" aria-label={`${i + 1} ${j('チャートに工程を配置', '在图表中放置阶段')}`} onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const offset = e.detail === 0 ? 0 : Math.max(0, Math.min(range.days - 1, Math.floor((e.clientX - rect.left) / rect.width * range.days)));
                const day = range.start + offset;
                commit({ ...value, tasks: value.tasks.map(task => task.id === t.id ? { ...task, start: dayDate(day), end: dayDate(Math.min(dateDay('2199-12-31')!, day + 6)) } : task) });
              }}>＋ {j('クリック・タップして配置', '点击放置')}</button>}
            </div>
          </div>;
        })}
      </div>
    </div>
    {value.dayMode === 'business' && <p className="small-note">{j('薄い背景は休業日。日数は休業日を除外します。横軸とドラッグは暦日単位のため、移動先により営業日数が変わります。', '浅色背景为休息日，天数已扣除休息日。横轴和拖动按自然日，移动后工作日天数可能变化。')}</p>}
    <details className="gantt-help"><summary>{j('操作方法', '操作说明')}</summary><p className="small-note">{j('横にスクロールできます。横棒・取っ手を選択して ← → でも1日ずつ移動（Shiftで7日）。Escでドラッグを取消。', '可横向滚动。选中横条或把手后按 ← → 调整1天（Shift为7天），Esc取消拖动。')}</p></details>
    <p className="gantt-status" role="status" aria-live="polite">{rowDrop ? j(`${rowDrop.target + 1}番目へ移動・離して確定`, `移动至第${rowDrop.target + 1}行，松开确认`) : preview && dragging.current ? (() => { const t = preview.tasks.find(t => t.id === dragging.current!.id)!; return `${t.start} → ${t.end}`; })() : status.snapshot === JSON.stringify(value) ? status.text : ''}</p>
  </section>;
}

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { Language } from './pricing';
import { copyText } from './export';
import { holidayCalendars } from './holidayCalendars';
import ScheduleGantt from './ScheduleGantt';
import { MAX_TASKS, calendarWarning, scheduleErrors, scheduleTsv, type Schedule, type ScheduleTask } from './schedule';

export default function ScheduleEditor({ value: s, onChange, lang, onGenerate, documentReady }: { value: Schedule; onChange: (s: Schedule) => void; lang: Language; onGenerate: () => void; documentReady: boolean }) {
  const j = (ja: string, zh: string) => lang === 'ja' ? ja : zh;
  const [copyStatus, setCopyStatus] = useState('');
  const [manual, setManual] = useState('');
  const errors = scheduleErrors(s, lang);
  const cards = useRef(new Map<string, HTMLDetailsElement>());
  function edit(id: string) { const card = cards.current.get(id); if (card) { card.open = true; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  const change = (i: number, key: keyof ScheduleTask, v: string) => onChange({ ...s, tasks: s.tasks.map((t, n) => n === i ? { ...t, [key]: v } : t) });
  function move(i: number, direction: number) {
    const tasks = [...s.tasks]; [tasks[i], tasks[i + direction]] = [tasks[i + direction], tasks[i]]; onChange({ ...s, tasks });
  }
  return <div className="quote-section-body schedule-editor">
    <p className="small-note">{j('工程名と日付を編集できます。開始日と終了日を含み、日数の表示方式を選べます。工程の重複も設定できます。', '可编辑阶段名称和日期。包含起止日，可选择天数计算方式；可安排并行阶段。')}</p>
    <label className="quote-field"><span>{j('スケジュール表の表題', '进度表标题')}</span><input maxLength={200} value={s.title} onChange={e => onChange({ ...s, title: e.target.value })} /></label>
    <div className="schedule-calendar-controls">
      <label>{j('日数の表示', '天数显示')}<select value={s.dayMode} onChange={e => onChange({ ...s, dayMode: e.target.value as Schedule['dayMode'] })}><option value="calendar">{j('暦日', '自然日')}</option><option value="business">{j('営業日', '工作日')}</option></select></label>
      {s.dayMode === 'business' && <>
        <label>{j('祝日カレンダー', '节假日日历')}<select value={s.holidayCountry} onChange={e => onChange({ ...s, holidayCountry: e.target.value as Schedule['holidayCountry'] })}><option value="JP">{j('日本', '日本')}</option><option value="CN">{j('中国', '中国')}</option></select></label>
        {s.holidayCountry === 'CN' && <label className="quote-checkbox"><input type="checkbox" checked={s.includeMakeupDays} onChange={e => onChange({ ...s, includeMakeupDays: e.target.checked })} />{j('振替出勤日を営業日に含める', '调休上班日计入工作日')}</label>}
      </>}
    </div>
    {s.dayMode === 'business' && <p className="small-note">{j('土日と祝日を除外。対応年：', '排除周末及节假日。已收录年份：')}{holidayCalendars[s.holidayCountry].years.join(' / ')} · <a href={holidayCalendars[s.holidayCountry].source} target="_blank" rel="noreferrer">{j('公式の祝日データ', '官方节假日数据')}</a></p>}
    {calendarWarning(s, lang) && <p className="schedule-calendar-warning" role="alert">{calendarWarning(s, lang)}</p>}
    <div className="schedule-export-bar"><div><strong>{j('スケジュール単独PDF', '单独导出进度表PDF')}</strong><p className="small-note">{j('横向きA4で保存します。見積金額・図面・印影は含みません。', '保存为A4横向PDF，不包含报价金额、图纸或印章。')}</p></div><button className="button primary" type="button" disabled={!!errors.length || !documentReady} onClick={onGenerate}>{j('単独PDFをエクスポート', '导出独立PDF')}</button></div>
    <ScheduleGantt value={s} onChange={onChange} lang={lang} onEdit={edit} />
    <h3 className="schedule-details-title">{j('工程の詳細', '阶段详情')}</h3>
    {s.tasks.map((t, i) => <details className="schedule-task" key={t.id} ref={el => { if (el) cards.current.set(t.id, el); else cards.current.delete(t.id); }}><summary>{String(i + 1).padStart(2, '0')} {t.name || j('新しい工程', '新阶段')}<small>{t.start && t.end ? `${t.start} → ${t.end}` : j('日付未設定', '未设置日期')}</small></summary>
      <div className="schedule-task-top"><span className="eyebrow">{String(i + 1).padStart(2, '0')}</span><div className="quote-attachment-actions">
        <button type="button" className="button" aria-label={`${i + 1} ${j('工程を上へ', '阶段上移')}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
        <button type="button" className="button" aria-label={`${i + 1} ${j('工程を下へ', '阶段下移')}`} disabled={i === s.tasks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
        <button type="button" className="button" aria-label={`${i + 1} ${j('工程を削除', '删除阶段')}`} onClick={() => onChange({ ...s, tasks: s.tasks.filter((_, n) => n !== i) })}><X size={15} />{j('削除', '删除')}</button>
      </div></div>
      <div className="quote-fields">
        <label className="quote-field wide"><span>{j('工程名', '阶段名称')} {i + 1}</span><input maxLength={120} value={t.name} onChange={e => change(i, 'name', e.target.value)} /></label>
        {(['start', 'end'] as const).map(key => <label className="quote-field" key={key}><span>{key === 'start' ? j('開始日', '开始日期') : j('終了日', '结束日期')} {i + 1}</span><input type="date" min="1900-01-01" max="2199-12-31" value={t[key]} onChange={e => change(i, key, e.target.value)} /></label>)}
      </div>
    </details>)}
    <button className="button" type="button" disabled={s.tasks.length >= MAX_TASKS} onClick={() => { const id = crypto.randomUUID(); onChange({ ...s, tasks: [...s.tasks, { id, name: j('新しい工程', '新阶段'), start: '', end: '', owner: '', note: '' }] }); requestAnimationFrame(() => edit(id)); }}><Plus size={15} />{j('工程を追加', '添加阶段')}</button>
    <details className="schedule-export-notes" open={!!s.notes || s.tasks.some(t => t.note.trim())}><summary>{j('エクスポート時の備考欄', '导出时的备注栏')}</summary><p className="small-note">{j('PDFとExcelでは、ガントの下に備考欄としてまとめます。', 'PDF及Excel会在甘特图下方集中显示备注。')}</p>
    {s.tasks.some(t => t.note.trim()) && <div className="schedule-existing-notes">{s.tasks.map((t, i) => t.note.trim() ? <label className="quote-field" key={t.id}><span>{String(i + 1).padStart(2, '0')} {t.name}</span><textarea rows={2} maxLength={240} value={t.note} onChange={e => change(i, 'note', e.target.value)} /></label> : null)}</div>}
    <label className="quote-field schedule-notes"><span>{j('スケジュール全体の備考', '整体进度备注')}</span><textarea rows={3} maxLength={2000} value={s.notes} onChange={e => onChange({ ...s, notes: e.target.value })} /></label>
    </details>
    <label className="quote-checkbox"><input type="checkbox" checked={s.includeInQuotation} onChange={e => onChange({ ...s, includeInQuotation: e.target.checked })} />{j('見積書PDFの末尾にスケジュール表を添付', '在报价PDF末尾附上进度表')}</label>
    {errors.length > 0 && <details className="small-note"><summary>{j('PDF出力前の入力確認', '导出PDF前完善信息')} ({errors.length})</summary><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></details>}
    {!documentReady && <p className="small-note">{j('PDF出力には「案件・書類情報」の案件名・発行日と発行会社も必要です。', '导出PDF还需要项目名称、有效出具日期及出具公司。')}</p>}
    <div className="quote-toolbar">
      <button className="button primary" type="button" disabled={!!errors.length || !documentReady} onClick={onGenerate}>{j('単独PDFをエクスポート', '导出独立PDF')}</button>
      <button className="button" type="button" disabled={!!errors.length} onClick={async () => { const text = scheduleTsv(s, lang); if (await copyText(text)) { setCopyStatus(j('コピーしました。', '已复制。')); setManual(''); } else { setManual(text); setCopyStatus(''); } }}>{j('Excel用にコピー', '复制到Excel')}</button>
    </div><p className="small-note" role="status">{copyStatus}</p>
    {manual && <label className="quote-field"><span>{j('選択してコピーしてください', '请选择并复制')}</span><textarea readOnly value={manual} onFocus={e => e.target.select()} /></label>}
  </div>;
}

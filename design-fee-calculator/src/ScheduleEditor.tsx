import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { Language } from './pricing';
import { copyText } from './export';
import { MAX_TASKS, dayDate, scheduleErrors, scheduleRange, scheduleTicks, scheduleTsv, taskSpan, type Schedule, type ScheduleTask } from './schedule';

export default function ScheduleEditor({ value: s, onChange, lang, onGenerate, documentReady }: { value: Schedule; onChange: (s: Schedule) => void; lang: Language; onGenerate: () => void; documentReady: boolean }) {
  const j = (ja: string, zh: string) => lang === 'ja' ? ja : zh;
  const [copyStatus, setCopyStatus] = useState('');
  const [manual, setManual] = useState('');
  const errors = scheduleErrors(s, lang), range = scheduleRange(s);
  const change = (i: number, key: keyof ScheduleTask, v: string) => onChange({ ...s, tasks: s.tasks.map((t, n) => n === i ? { ...t, [key]: v } : t) });
  function move(i: number, direction: number) {
    const tasks = [...s.tasks]; [tasks[i], tasks[i + direction]] = [tasks[i + direction], tasks[i]]; onChange({ ...s, tasks });
  }
  return <div className="quote-section-body schedule-editor">
    <p className="small-note">{j('工程・日付・担当・備考を編集できます。日数は開始日と終了日を含む暦日です。工程の重複も設定できます。', '可编辑阶段、日期、负责人及备注。天数按自然日计算，包含起止日；可安排并行阶段。')}</p>
    <label className="quote-field"><span>{j('スケジュール表の表題', '进度表标题')}</span><input maxLength={200} value={s.title} onChange={e => onChange({ ...s, title: e.target.value })} /></label>
    {s.tasks.map((t, i) => <div className="schedule-task" key={t.id}>
      <div className="schedule-task-top"><span className="eyebrow">{String(i + 1).padStart(2, '0')}</span><div className="quote-attachment-actions">
        <button type="button" className="button" aria-label={`${i + 1} ${j('工程を上へ', '阶段上移')}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
        <button type="button" className="button" aria-label={`${i + 1} ${j('工程を下へ', '阶段下移')}`} disabled={i === s.tasks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
        <button type="button" className="button" aria-label={`${i + 1} ${j('工程を削除', '删除阶段')}`} onClick={() => onChange({ ...s, tasks: s.tasks.filter((_, n) => n !== i) })}><X size={15} />{j('削除', '删除')}</button>
      </div></div>
      <div className="quote-fields">
        <label className="quote-field wide"><span>{j('工程名', '阶段名称')} {i + 1}</span><input maxLength={120} value={t.name} onChange={e => change(i, 'name', e.target.value)} /></label>
        {(['start', 'end'] as const).map(key => <label className="quote-field" key={key}><span>{key === 'start' ? j('開始日', '开始日期') : j('終了日', '结束日期')} {i + 1}</span><input type="date" min="1900-01-01" max="2199-12-31" value={t[key]} onChange={e => change(i, key, e.target.value)} /></label>)}
        <label className="quote-field wide"><span>{j('担当', '负责人')} {i + 1}</span><input maxLength={80} value={t.owner} onChange={e => change(i, 'owner', e.target.value)} /></label>
        <label className="quote-field wide"><span>{j('備考', '备注')} {i + 1}</span><textarea rows={2} maxLength={240} value={t.note} onChange={e => change(i, 'note', e.target.value)} /></label>
      </div>
    </div>)}
    <button className="button" type="button" disabled={s.tasks.length >= MAX_TASKS} onClick={() => onChange({ ...s, tasks: [...s.tasks, { id: crypto.randomUUID(), name: '', start: '', end: '', owner: '', note: '' }] })}><Plus size={15} />{j('工程を追加', '添加阶段')}</button>
    <label className="quote-field schedule-notes"><span>{j('スケジュール全体の備考', '整体进度备注')}</span><textarea rows={3} maxLength={2000} value={s.notes} onChange={e => onChange({ ...s, notes: e.target.value })} /></label>
    <label className="quote-checkbox"><input type="checkbox" checked={s.includeInQuotation} onChange={e => onChange({ ...s, includeInQuotation: e.target.checked })} />{j('見積書PDFの末尾にスケジュール表を添付', '在报价PDF末尾附上进度表')}</label>
    {errors.length > 0 && <div className="small-note"><p>{j('プレビュー・PDF出力には以下を入力してください。', '预览及导出PDF前，请完善以下信息。')}</p><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
    {range && <><p className="small-note">{dayDate(range.start)} — {dayDate(range.end)} / {range.days} {j('暦日', '自然日')}</p><div className="schedule-scroll" tabIndex={0} role="region" aria-label={j('工程別スケジュール表', '阶段进度表')}><table className="schedule-table"><thead><tr><th>{j('工程 / 期間', '阶段 / 日期')}</th><th className="schedule-scale">{scheduleTicks(range).map(t => <span key={t.position} style={{ left: `${t.position * 100}%` }}>{t.label}</span>)}</th></tr></thead><tbody>{s.tasks.map(t => { const span = taskSpan(t, range); return <tr key={t.id}><th scope="row">{t.name}<small>{t.start} → {t.end} · {span.days}{j('日', '天')}</small>{t.owner && <small>{t.owner}</small>}</th><td><div className="schedule-track"><span style={{ left: `${span.offset * 100}%`, width: `${span.width * 100}%` }} /></div></td></tr>; })}</tbody></table></div></>}
    {!documentReady && <p className="small-note">{j('PDF出力には「案件・書類情報」の案件名・発行日と発行会社も必要です。', '导出PDF还需要项目名称、有效出具日期及出具公司。')}</p>}
    <div className="quote-toolbar">
      <button className="button primary" type="button" disabled={!!errors.length || !documentReady} onClick={onGenerate}>{j('スケジュールPDFを作成', '生成进度表PDF')}</button>
      <button className="button" type="button" disabled={!!errors.length} onClick={async () => { const text = scheduleTsv(s, lang); if (await copyText(text)) { setCopyStatus(j('コピーしました。', '已复制。')); setManual(''); } else { setManual(text); setCopyStatus(''); } }}>{j('Excel用にコピー', '复制到Excel')}</button>
    </div><p className="small-note" role="status">{copyStatus}</p>
    {manual && <label className="quote-field"><span>{j('選択してコピーしてください', '请选择并复制')}</span><textarea readOnly value={manual} onFocus={e => e.target.select()} /></label>}
  </div>;
}

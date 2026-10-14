import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileSpreadsheet, X } from 'lucide-react';
import { calculateCurrentFee, calculateRevisedFee, parseInput, projectType, simulationCount, simulationRows } from './calculator';
import { chineseQuotation, copyText, MAX_COPY_ROWS, number, resultText, tableText } from './export';
import { messages } from './i18n';
import { pricing, type Language } from './pricing';
import { createQuotation, type Quotation } from './quotation';

const QuotationEditor = lazy(() => import('./QuotationEditor'));

const PAGE_SIZE = 50;
const APP_RELEASE = '2026.10.14.4';

export default function App() {
  const [lang, setLang] = useState<Language>('ja');
  const [name, setName] = useState('');
  const [area, setArea] = useState('6300');
  const [typeId, setTypeId] = useState('retail');
  const [additional, setAdditional] = useState('');
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState('');
  const [manual, setManual] = useState('');
  const [initialSection, setInitialSection] = useState<'schedule' | undefined>();
  const [quote, setQuote] = useState<Quotation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const t = messages[lang];
  const type = projectType(typeId);
  const parsedArea = parseInput(area, 'area');
  const parsedAdditional = parseInput(additional, 'additional');
  const computed = useMemo(() => {
    if (parsedArea.value === undefined || parsedAdditional.value === undefined) return { result: null, legacy: null, rangeError: false };
    try {
      return { result: calculateCurrentFee(parsedArea.value, typeId, parsedAdditional.value),
        legacy: calculateRevisedFee(parsedArea.value, typeId, parsedAdditional.value), rangeError: false };
    } catch { return { result: null, legacy: null, rangeError: true }; }
  }, [parsedArea.value, parsedAdditional.value, typeId]);
  const { result, legacy } = computed;
  const rowCount = result ? simulationCount(result.area) : 0;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rowCount / PAGE_SIZE) - 1));
  const rows = useMemo(() => result ? Array.from(simulationRows(result.area, typeId, currentPage * PAGE_SIZE, PAGE_SIZE)) : [], [result, typeId, currentPage]);
  const areaError = parsedArea.error ? t.errors[parsedArea.error] : parsedArea.value !== undefined && parsedArea.value > pricing.currentBands.at(-1)!.upTo ? t.undefinedNote : computed.rangeError ? t.errors.range : '';
  const additionalError = parsedAdditional.error ? t.errors[parsedAdditional.error] : '';

  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'ja'; }, [lang]);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(''), 2500);
    return () => clearTimeout(timeout);
  }, [copied]);
  useEffect(() => {
    if (manual) { dialog.current?.showModal(); copyField.current?.select(); }
  }, [manual]);

  async function copy(kind: 'result' | 'chinese' | 'table' | 'excel') {
    if (!result) return;
    const text = kind === 'result' ? resultText(name, typeId, result, lang)
      : kind === 'chinese' ? chineseQuotation(name, typeId, result)
      : tableText(result.area, typeId, lang, kind === 'excel');
    if (await copyText(text)) { setCopied(kind); }
    else { setManual(text); }
  }
  const copyIcon = (kind: string) => copied === kind ? <Check size={16} /> : <Copy size={16} />;
  const fee = (value: number) => <>{number(value)} <span className="unit">RMB</span></>;
  function openQuotation(section?: 'schedule') {
    setInitialSection(section);
    if (!result) return;
    setQuote(createQuotation(name, result));
    window.scrollTo(0, 0);
  }

  return (
    <div className="app-shell">
      <header className="site-header flex items-center justify-between gap-4">
        <a className="wordmark" href="https://the-triangle.jp/" target="_blank" rel="noreferrer" aria-label="THE TRIANGLE.JP">THE <strong>TRIANGLE.JP</strong></a>
        <div className="language-switch flex items-center" aria-label="Language">
          <button type="button" lang="ja" aria-pressed={lang === 'ja'} onClick={() => setLang('ja')}>日本語</button>
          <span aria-hidden="true">/</span>
          <button type="button" lang="zh-CN" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>简体中文</button>
        </div>
      </header>

      {quote ? <Suspense fallback={<p className="intro-text">Loading…</p>}><QuotationEditor initialSection={initialSection} initial={quote} lang={lang} onBack={() => setQuote(null)} /></Suspense> : <main>
        <div className="intro flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div><h1 className="eyebrow">DESIGN FEE CALCULATOR</h1><p className="intro-text">{t.intro}</p></div>
          <div className="quotation-entry">
            <button type="button" className="button primary" disabled={!result} onClick={() => openQuotation()}>{lang === 'ja' ? '見積書を作成' : '制作报价单'} →</button>
            <button type="button" className="button" disabled={!result} onClick={() => openQuotation('schedule')}>{lang === 'ja' ? 'スケジュール表を作成' : '制作进度表'} →</button>
            <p className="small-note">{lang === 'ja' ? 'PDF出力・図面添付・印影' : '导出PDF・附加图纸・印章'}</p>
            <span className="edition">{lang === 'ja' ? '更新版' : '更新版本'} {APP_RELEASE}</span>
          </div>
        </div>

        <div className="calculator-grid">
          <section className="input-panel" aria-labelledby="input-heading">
            <h2 id="input-heading" className="section-heading"><span>01</span>{t.inputs}</h2>
            <div className="field"><label htmlFor="project-name">{t.name}</label><input id="project-name" value={name} maxLength={200} onChange={e => setName(e.target.value)} autoComplete="off" /></div>
            <div className="field"><label htmlFor="area">{t.area}</label><div className="input-unit"><input id="area" inputMode="decimal" value={area} onChange={e => { setArea(e.target.value); setPage(0); }} aria-invalid={!!areaError} aria-describedby={areaError ? 'area-error' : undefined} autoComplete="off" spellCheck={false} /><span>㎡</span></div>{areaError && <p id="area-error" className="error" role="alert">{areaError}</p>}</div>
            <div className="field"><label htmlFor="project-type">{t.type}</label><div className="select-wrap"><select id="project-type" value={typeId} onChange={e => setTypeId(e.target.value)}>{pricing.projectTypes.map(item => <option value={item.id} key={item.id}>{item.label[lang]}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div><p className="field-hint flex justify-between"><span>{t.coefficient}</span><span className="numeric">× {type.coefficient.toFixed(2)}</span></p></div>
            <div className="field last-field"><label htmlFor="additional">{t.additional}<span className="optional">{t.optional}</span></label><div className="input-unit"><input id="additional" inputMode="numeric" value={additional} placeholder="0" onChange={e => setAdditional(e.target.value)} aria-invalid={!!additionalError} aria-describedby="additional-hint" autoComplete="off" /><span>RMB</span></div><p id="additional-hint" className={additionalError ? 'error' : 'field-hint'} role={additionalError ? 'alert' : undefined}>{additionalError || t.additionalHint}</p></div>
          </section>

          <section className="result-panel" aria-labelledby="result-heading">
            <div className="flex items-center justify-between gap-2"><h2 id="result-heading" className="section-heading"><span>02</span>{t.result}</h2><span className="model-label">{t.model}</span></div>
            <div className="result-main" aria-live="polite" aria-atomic="true">
              <p className="total-label">{t.total}</p>
              <div className="grand-total"><span>{result ? number(result.totalFee) : '—'}</span><span className="currency">RMB</span></div>
              <p className="project-caption">{name.trim() || t.unnamed}<span> / </span>{result ? `${number(result.area)} ㎡` : '— ㎡'}</p>
              <dl className="result-lines">
                <div><dt>{t.base}</dt><dd>{result ? fee(result.baseFee) : '—'}</dd></div>
                <div><dt>{t.average}</dt><dd>{result ? <>{number(result.averageRate, 1)} <span className="unit">RMB/㎡</span></> : '—'}</dd></div>
                <div><dt>{t.additional}</dt><dd>{result ? fee(result.additionalFee) : '—'}</dd></div>
              </dl>
            </div>
            <p className="result-note">{result ? (result.band.rate !== undefined ? `${t.rate}：${number(result.band.rate)} RMB/㎡ × ${number(result.area)}㎡ × ${result.coefficient.toFixed(2)}` : `${t.fixed}：${number(result.band.fixedFee)} RMB`) : areaError || t.empty}</p>
            <p className="small-note">{t.averageNote}</p>
            <div className="copy-actions grid sm:grid-cols-2 gap-2">
              <button type="button" className="button primary" disabled={!result} onClick={() => void copy('result')}>{copyIcon('result')}{copied === 'result' ? t.copied : t.copyResult}</button>
              <button type="button" className="button" disabled={!result} onClick={() => void copy('chinese')}>{copyIcon('chinese')}{copied === 'chinese' ? t.copied : t.copyChinese}</button>
            </div>
            <button type="button" className="button quote-launch" style={{ width: '100%', marginTop: 10 }} disabled={!result} onClick={() => openQuotation()}>{lang === 'ja' ? 'この計算結果から見積書を作成' : '根据计算结果制作报价单'} →</button>
            <details className="disclosure breakdown">
              <summary>{t.breakdown}<ChevronDown size={16} /></summary>
              {result ? <div className="disclosure-content">
                <dl className="detail-lines">
                  {result.band.fixedFee !== undefined ? <div><dt>{t.fixed}（{number(result.band.upTo)}㎡{t.included}）</dt><dd>{fee(result.band.fixedFee)}</dd></div> : <>
                    <div><dt>{number(result.area)}㎡ × {number(result.band.rate)} RMB/㎡</dt><dd>{fee(result.subtotal)}</dd></div>
                    <div><dt>{t.coefficient}</dt><dd>× {result.coefficient.toFixed(2)}</dd></div>
                    <div><dt>{t.adjusted}</dt><dd>{fee(result.adjustedAmount)}</dd></div>
                  </>}
                  <div><dt>{t.base}<small>{t.rounded}</small></dt><dd>{fee(result.baseFee)}</dd></div>
                </dl><p className="small-note">{t.floorNote}</p>
              </div> : <p className="small-note disclosure-content">{t.empty}</p>}
            </details>
          </section>
        </div>

        <details className="disclosure legacy">
          <summary><span>{t.legacy}</span><ChevronDown size={18} /></summary>
          <div className="disclosure-content">
            {result && legacy ? <>
              <div className="legacy-grid"><div><p>{t.legacyTitle}</p><strong>{fee(result.totalFee)}</strong></div><div><p>{t.revisedTitle}</p><strong>{fee(legacy.totalFee)}</strong></div><div><p>{t.difference}</p><strong>{legacy.totalFee - result.totalFee > 0 ? '+' : ''}{fee(legacy.totalFee - result.totalFee)}</strong></div></div>
              <p className="small-note">{result.band.fixedFee !== undefined ? `${t.fixed}：${number(result.band.fixedFee)} RMB` : `${t.rate}：${number(result.band.rate)} RMB/㎡ × ${number(result.area)}㎡ × ${type.coefficient.toFixed(2)}`}</p>
            </> : <p className="unavailable">{result ? t.undefinedNote : t.empty}</p>}
            <p className="small-note">{t.legacyNote}</p><p className="small-note">{t.legacyExtras}</p>
          </div>
        </details>

        <section className="simulation-section" aria-labelledby="simulation-heading">
          <div className="simulation-header flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
            <div><h2 id="simulation-heading" className="section-heading"><span>03</span>{t.simulation}</h2><p className="small-note">{t.simulationNote}</p></div>
            <div className="table-actions flex gap-2">
              <button type="button" className="button" disabled={!result || rowCount > MAX_COPY_ROWS} onClick={() => void copy('table')}>{copyIcon('table')}{copied === 'table' ? t.copied : t.copyTable}</button>
              <button type="button" className="button" disabled={!result || rowCount > MAX_COPY_ROWS} onClick={() => void copy('excel')}>{copied === 'excel' ? <Check size={16} /> : <FileSpreadsheet size={16} />}{copied === 'excel' ? t.copied : t.copyExcel}</button>
            </div>
          </div>
          {rowCount > MAX_COPY_ROWS && <p className="small-note">{t.exportLimit}</p>}
          <table className="simulation-table">
            <caption className="sr-only">{t.simulation} — {type.label[lang]} × {type.coefficient.toFixed(2)}</caption>
            <thead><tr><th scope="col">{t.area}<span>㎡</span></th><th scope="col">{t.average}<span>RMB/㎡</span></th><th scope="col">{t.total}<span>RMB</span></th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.area} className={currentPage === 0 && index === 0 ? 'current-row' : ''}><td><span className="numeric">{number(row.area)}</span>{currentPage === 0 && index === 0 && <span className="current-label">{t.selected}</span>}</td><td>{number(row.averageRate, 1)}</td><td>{number(row.totalFee)}</td></tr>)}{!result && <tr><td colSpan={3} className="empty-cell">{t.empty}</td></tr>}</tbody>
          </table>
          <div className="table-footer flex items-center justify-between gap-4"><p className="small-note">{t.currencyNote}</p>{rowCount > PAGE_SIZE ? <div className="pagination flex items-center gap-2"><button type="button" aria-label={t.previous} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rowCount)} / {number(rowCount)}</span><button type="button" aria-label={t.next} disabled={(currentPage + 1) * PAGE_SIZE >= rowCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div> : <span className="small-note">{rowCount} {t.rows}</span>}</div>
        </section>

        <details className="disclosure model-details">
          <summary>{t.settings}<ChevronDown size={18} /></summary>
          <div className="disclosure-content model-grid"><div><h3>{t.modelName}</h3><p className="small-note">{t.settingsNote}</p><p className="small-note">{t.floorNote}</p></div><dl className="detail-lines">{pricing.currentBands.map((band, index) => <div key={band.upTo}><dt>{index ? `${number(pricing.currentBands[index - 1].upTo)}㎡${t.over}〜` : ''}{number(band.upTo)}㎡{t.included}</dt><dd>{band.fixedFee !== undefined ? fee(band.fixedFee) : <>{number(band.rate)} <span className="unit">RMB/㎡</span></>}</dd></div>)}</dl></div>
        </details>
      </main>}

      <footer className="site-footer flex flex-col sm:flex-row sm:justify-between gap-4"><div><p className="footer-brand">THE TRIANGLE.JP</p><p>{t.estimateNote}</p></div><span>DESIGN FEE / {pricing.version}<br />APP {APP_RELEASE}</span></footer>
      <div className="toast" role="status" aria-live="polite">{copied && <><Check size={16} />{t.copied}</>}</div>
      <dialog ref={dialog} className="copy-dialog" onClose={() => setManual('')}>
        <div className="flex items-center justify-between"><h2>{t.manualCopy}</h2><button type="button" className="icon-button" aria-label={t.close} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
        <p className="small-note">{t.copyFailed}</p><textarea ref={copyField} value={manual} readOnly aria-label={t.manualCopy} />
        <button type="button" className="button primary" onClick={() => { copyField.current?.focus(); copyField.current?.select(); }}>{t.selectAll}<ArrowDown size={16} /></button>
      </dialog>
    </div>
  );
}

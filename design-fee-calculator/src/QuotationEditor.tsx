import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Download, FileText, Plus, RefreshCw, Upload, X } from 'lucide-react';
import { CHINA_ISSUER, createChinaSeal, chineseMoney, clarifyRenderingScope, documentLabels, isPdfDrawing, parseQuotation, quotationTotals, quoteErrors, quoteFilename, type Quotation, type QuoteImage, type QuoteAttachment } from './quotation';
import type { Language } from './pricing';
import './quotation.css';

const STORAGE = 'triangle-quotation-v1';
function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function readImage(file: File): Promise<QuoteImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12_000_000) throw new Error('image');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    if (img.width * img.height > 40_000_000) throw new Error('image');
    const ratio = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * ratio); canvas.height = Math.round(img.height * ratio);
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('image');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL(file.type, .85);
    if (data.length > 2_000_000) { canvas.width = Math.round(canvas.width / 2); canvas.height = Math.round(canvas.height / 2); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); data = canvas.toDataURL(file.type, .8); }
    if (data.length > 2_000_000) throw new Error('image');
    return { name: file.name.slice(0, 300), caption: '', data };
  } finally { URL.revokeObjectURL(url); }
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`quote-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}</label>;
}

function DrawingPreview({ item }: { item: QuoteAttachment }) {
  const [url, setUrl] = useState('');
  const data = item.data, pdf = isPdfDrawing(item);
  useEffect(() => {
    if (!pdf) { setUrl(''); return; }
    const binary = atob(data.slice(data.indexOf(',') + 1));
    const next = URL.createObjectURL(new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'application/pdf' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data, pdf]);
  return isPdfDrawing(item)
    ? <div className="quote-pdf-drawing"><FileText size={28} /><span>PDF · {item.pages} p.</span><a className="button" href={url} target="_blank" rel="noreferrer">{item.name}</a></div>
    : <img src={item.data} alt={item.caption || item.name} />;
}

export default function QuotationEditor({ initial, lang, onBack }: { initial: Quotation; lang: Language; onBack: () => void }) {
  const j = (ja: string, zh: string) => lang === 'ja' ? ja : zh;
  const [starting] = useState(() => {
    try { const saved = localStorage.getItem(STORAGE); if (saved) return { quote: parseQuotation(saved), restored: true }; } catch { /* A broken stored draft must not block opening. */ }
    return { quote: initial, restored: false };
  });
  const [q, setQ] = useState<Quotation>(starting.quote);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState(starting.restored ? j('前回の下書きを復元しました。新しい計算結果を使う場合は「計算結果を再取込」を押してください。', '已恢复上次草稿。如需使用新的计算结果，请点击“重新载入计算结果”。') : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; draft: string; filename: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const serialized = JSON.stringify(q);
  const clarified = clarifyRenderingScope(q);
  const hasLegacyRenderingCopy = JSON.stringify(clarified) !== serialized;
  const isCurrentPdf = pdf?.draft === serialized;
  const t = documentLabels[q.language];
  const errors = quoteErrors(q);
  let totals: ReturnType<typeof quotationTotals> | null = null;
  try { totals = quotationTotals(q); } catch { /* shown in the validation summary */ }
  const num = (v: number, digits = 0) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const errorText: Record<string, string> = {
    required: j('表題・案件名・発行会社を入力してください。', '请填写标题、项目名称和出具公司。'),
    date: j('有効な発行日を入力してください。', '请输入有效的出具日期。'), validity: j('有効期間は1〜3650日で入力してください。', '有效期应为1至3650天。'),
    area: j('設計面積は0より大きい数値を入力してください。', '设计面积必须大于0。'), money: j('金額は0〜999,999,999,999の整数で入力してください。', '金额须为0至999,999,999,999的整数。'),
    discount: j('減額が基本設計費と追加費の合計を超えています。', '减额不能超过基础设计费与附加设计费的合计。'), tax: j('税率は0〜100%（小数4桁以内）で入力してください。', '税率应为0至100%（最多4位小数）。'),
  };
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(STORAGE, serialized); setStorageError(false); } catch { setStorageError(true); } }, 500);
    return () => clearTimeout(timer);
  }, [serialized]);
  useEffect(() => { return () => { if (pdf) URL.revokeObjectURL(pdf.url); }; }, [pdf]);
  function set<K extends keyof Quotation>(key: K, value: Quotation[K]) {
    setQ(old => ({ ...old, [key]: value,
      ...(key === 'issuer' && value !== CHINA_ISSUER && old.seal?.data === createChinaSeal().data ? { seal: null } : {}),
    })); setNotice(''); setError('');
  }
  function input(key: keyof Quotation, label: string, opts: { multiline?: boolean; wide?: boolean; numeric?: boolean; type?: string } = {}) {
    return <Field label={label} wide={opts.wide}>{opts.multiline
      ? <textarea rows={4} maxLength={20000} value={q[key] as string} onChange={e => set(key, e.target.value)} />
      : <input type={opts.type || 'text'} inputMode={opts.numeric ? 'decimal' : undefined} maxLength={opts.numeric ? 20 : 500} value={q[key] as string} onChange={e => set(key, e.target.value)} />}</Field>;
  }
  async function generate() {
    if (errors.length || busy) return;
    setBusy(true); setError('');
    try {
      const { generateQuotationPdf } = await import('./quotationPdf');
      const bytes = await generateQuotationPdf(q);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      setPdf({ url, draft: serialized, filename: quoteFilename(q, 'pdf') });
      setNotice(j('PDFを作成しました。内容を確認して保存してください。', 'PDF已生成，请确认内容后保存。'));
    } catch (e) {
      const message = (e as Error).message;
      setError(message.startsWith('glyph:') ? j(`PDFで使用できない文字があります：${message.slice(6)}。置き換えてください。`, `PDF不支持此字符：${message.slice(6)}。请替换。`) : j('PDFを作成できませんでした。通信状態と画像を確認して再試行してください。', 'PDF生成失败，请检查网络和图片后重试。'));
    } finally { setBusy(false); }
  }
  async function importDraft(file?: File) {
    if (!file) return;
    try { if (file.size > 12_000_000) throw new Error(); const next = parseQuotation(await file.text()); setQ(next); setNotice(j('下書きを読み込みました。', '已载入草稿。')); setError(''); }
    catch { setError(j('この下書きファイルは読み込めません。形式・サイズを確認してください。', '无法读取草稿，请检查格式和文件大小。')); }
  }
  async function addImages(files: FileList | null, kind: 'images' | 'seal' | 'signature') {
    if (!files?.length) return;
    if (kind === 'images' && q.images.length + files.length > 12) { setError(j('図面は12ファイルまでです。', '最多可添加12个图纸文件。')); return; }
    setBusy(true); setError('');
    try {
      const items: QuoteAttachment[] = [];
      for (const file of Array.from(files)) {
        if (kind === 'images' && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
          const { readPdfDrawing } = await import('./quotationAttachments');
          items.push(await readPdfDrawing(file));
        } else items.push(await readImage(file));
      }
      const next = { ...q, [kind]: kind === 'images' ? [...q.images, ...items] : items[0] };
      if (JSON.stringify(next).length > 11_000_000) throw new Error('total-size');
      setQ(next);
      setNotice(j('添付しました。PDFを再作成すると反映されます。', '已添加附件，重新生成PDF后生效。'));
    }
    catch (e) {
      const code = (e as Error).message;
      setError(code === 'total-size' ? j('添付の合計サイズが大きすぎます。PDFを圧縮するか、図面を減らしてください。', '附件总大小过大，请压缩PDF或减少图纸。')
        : code.startsWith('pdf') ? j('PDFは1ファイル8MB・50ページ以内です。パスワード保護のない有効なPDFを選んでください。', '每个PDF须在8MB、50页以内，请选择无密码保护的有效PDF。')
        : j('画像はPNG/JPEG、1枚12MB以下で追加してください。', '请使用每张不超过12MB的PNG/JPEG图片。'));
    }
    finally { setBusy(false); }
  }
  function imageUpload(kind: 'images' | 'seal' | 'signature', label: string) {
    return <label className="button quote-upload"><Upload size={15} />{label}<input aria-label={label} type="file" accept={kind === 'images' ? '.pdf,application/pdf,image/png,image/jpeg' : 'image/png,image/jpeg'} multiple={kind === 'images'} disabled={busy} onChange={e => { void addImages(e.target.files, kind); e.target.value = ''; }} /></label>;
  }
  return <main className="quotation-editor">
    <div className="quote-top"><button className="button" onClick={() => { try { localStorage.setItem(STORAGE, serialized); } catch { /* The visible save warning remains available after reopening. */ } onBack(); }} disabled={busy}><ArrowLeft size={16} />{j('計算機に戻る', '返回计算器')}</button><span className="eyebrow">QUOTATION STUDIO</span></div>
    <h1>{j('見積書をつくる。', '制作项目报价。')}</h1>
    <p className="intro-text">{j('THE TRIANGLEの書式で、案件に合わせた見積書を。図面と印影を添えてPDFにまとめます。', '使用THE TRIANGLE版式制作项目报价，可附上图纸与印章并生成PDF。')}</p>
    {(q.project !== initial.project || q.area !== initial.area || q.baseFee !== initial.baseFee || q.additionalFee !== initial.additionalFee) && <p className="small-note">{j('この下書きには、現在の計算結果と異なる案件情報・金額があります。「計算結果を再取込」で更新できます。', '当前草稿的项目信息或金额与计算器不同，可通过“重新载入计算结果”更新。')}</p>}
    <div className="quote-toolbar">
      <button className="button" disabled={busy} onClick={() => { download(new Blob([serialized], { type: 'application/json' }), quoteFilename(q, 'json')); setNotice(j('編集用の下書きを保存しました。', '已保存可编辑草稿。')); }}><Download size={16} />{j('下書き保存', '保存草稿')}</button>
      <button className="button" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{j('下書き読込', '载入草稿')}</button>
      <input ref={importRef} type="file" accept=".json,application/json" className="sr-only" onChange={e => { void importDraft(e.target.files?.[0]); e.target.value = ''; }} />
      <button className="button" disabled={busy} onClick={() => { setQ(old => ({ ...old, project: initial.project, area: initial.area, baseFee: initial.baseFee, additionalFee: initial.additionalFee, discount: '0' })); setNotice(j('案件名・面積・金額を計算機から取り込みました。税・本文は保持しています。', '已从计算器更新项目名、面积与费用，税务和正文保持不变。')); }}><RefreshCw size={16} />{j('計算結果を再取込', '重新载入计算结果')}</button>
      <button className="button" disabled={busy} onClick={() => { download(new Blob([serialized], { type: 'application/json' }), quoteFilename(q, 'json')); setQ({ ...structuredClone(initial), seal: q.issuer === initial.issuer ? q.seal : null }); setNotice(j('前の下書きを保存し、新規作成しました。同じ発行会社の印影は引き継いでいます。', '已保存旧草稿并新建；同一出具公司的印章予以保留。')); }}><Plus size={16} />{j('下書きを保存して新規作成', '保存草稿并新建')}</button>
    </div>
    <p className={storageError ? 'error' : 'small-note'}>{storageError ? j('端末への自動保存ができません。下書き保存でファイルを保存してください。', '自动保存失败，请将草稿保存为文件。') : j('このブラウザーに自動保存します。図面・印影を含む入力内容はサーバーへ送信しません。案件別の保管には「下書き保存」を使用してください。', '自动保存在此浏览器；输入内容及图片不上传服务器。请用“保存草稿”分项目归档。')}</p>
    {hasLegacyRenderingCopy && <div className="quote-copy-update"><p className="small-note">{j('保存済みの下書きに、完成予想図と別途CG制作の区分が曖昧な旧文面があります。通常の完成予想図は基本設計費に含み、範囲外の特別なCG・映像制作のみ別途と明記できます。', '草稿中的旧条款尚未区分常规效果图与额外CG制作。可明确：常规效果图包含在基础设计费内，超出服务范围的特殊CG或影像制作另计。')}</p><button className="button" disabled={busy} onClick={() => { setQ(clarified); setNotice(j('完成予想図の費用区分を更新しました。金額は変更していません。', '已更新效果图费用范围，报价金额不变。')); }}>{j('確認済みの文面修正を適用', '应用已确认的条款修订')}</button></div>}
    <div className="quote-layout">
      <fieldset className="quote-form" disabled={busy}>
        <details className="quote-section" open><summary>01 {j('案件・書類情報', '项目与文件信息')}</summary><div className="quote-fields">
          <Field label={j('書類の見出し言語', '文件标签语言')}><select value={q.language} onChange={e => set('language', e.target.value as Language)}><option value="zh">简体中文</option><option value="ja">日本語</option></select></Field>
          {input('title', j('表題', '标题'))}{input('number', j('見積番号（任意）', '报价编号（可选）'))}{input('date', j('発行日', '出具日期'), { type: 'date' })}
          {input('client', j('宛先・担当者（任意）', '委托方及联系人（可选）'), { wide: true })}{input('project', j('案件名', '项目名称'), { wide: true })}
          {input('service', j('サービス内容', '服务内容'))}{input('period', j('業務期間（任意）', '服务周期（可选）'))}
          {input('area', j('設計面積（㎡）', '设计面积（㎡）'), { numeric: true })}{input('designer', j('担当デザイナー', '主设计师'))}
          {input('areaNote', j('面積内訳・対象フロア（任意）', '面积明细及楼层（可选）'), { multiline: true, wide: true })}
          <p className="small-note wide">{j('言語切替は項目見出しに適用します。表題と本文は自由に編集してください。初期本文は参考資料を基にした中国語です。', '语言切换仅影响栏目标签；标题和正文可自由编辑。初始正文以参考文件为基础，采用中文。')}</p>
        </div></details>
        <details className="quote-section" open><summary>02 {j('添付図面', '附件图纸')} ({q.images.length})</summary><div className="quote-section-body">
          <p className="small-note">{j('PDF・PNG・JPEGを12ファイルまで添付できます。PDFは8MB・50ページ以内、画像は12MB以内。選んだ順に見積書の末尾へ追加します。PDFは原本の用紙サイズ・向きを保ちます。', '可添加最多12个PDF、PNG或JPEG文件。PDF每个限8MB、50页，图片限12MB。按显示顺序附在报价末尾，PDF保留原始纸张尺寸和方向。')}</p>{imageUpload('images', j('図面をアップロード', '上传图纸'))}
          <div className="quote-image-grid">{q.images.map((img, i) => <div key={i}><DrawingPreview item={img} /><p className="small-note quote-file-name">{String(i + 1).padStart(2, '0')} / {img.name}</p><input aria-label={`${j('図面名・説明', '图纸名称与说明')} ${i + 1}`} placeholder={j('図面名・説明', '图纸名称与说明')} maxLength={300} value={img.caption} onChange={e => set('images', q.images.map((old, n) => n === i ? { ...old, caption: e.target.value } : old))} /><div className="quote-attachment-actions">{[-1, 1].map(direction => <button key={direction} className="button" aria-label={`${i + 1} ${direction < 0 ? j('前へ', '前移') : j('後ろへ', '后移')}`} disabled={i + direction < 0 || i + direction >= q.images.length} onClick={() => { const items = [...q.images]; [items[i], items[i + direction]] = [items[i + direction], items[i]]; set('images', items); }}>{direction < 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>)}<button className="button" aria-label={`${j('削除', '删除')} ${img.name}`} onClick={() => set('images', q.images.filter((_, n) => n !== i))}><X size={14} />{j('削除', '删除')}</button></div></div>)}</div>
        </div></details>
        <details className="quote-section"><summary>03 {j('業務内容・成果物', '服务内容与交付成果')}</summary><div className="quote-section-body">
          <p className="small-note">{j('チェックした段階だけを掲載します。業務内容は1行1項目で入力。掲載の変更で金額は変わりません。', '仅包含勾选阶段。服务内容每行一项；改变范围不会自动改变金额。')}</p>
          {q.stages.map((stage, index) => <div className="quote-stage" key={stage.id}>
            <label className="quote-checkbox"><input type="checkbox" checked={stage.enabled} onChange={e => set('stages', q.stages.map((s, i) => i === index ? { ...s, enabled: e.target.checked } : s))} />{stage.title || j('新しい段階', '新增阶段')}</label>
            <div className="quote-fields">{(['title', 'goal', 'items', 'deliverables'] as const).map((key, n) => <Field key={key} wide label={[j('段階名', '阶段名称'), j('段階の目的', '阶段目标'), j('業務内容（1行1項目）', '服务内容（每行一项）'), j('成果物', '交付成果')][n]}><textarea rows={key === 'items' ? 6 : 2} maxLength={20000} value={stage[key]} onChange={e => set('stages', q.stages.map((s, i) => i === index ? { ...s, [key]: e.target.value } : s))} /></Field>)}</div>
          </div>)}
          <button className="button" disabled={q.stages.length >= 20} onClick={() => set('stages', [...q.stages, { id: crypto.randomUUID(), enabled: true, title: '', goal: '', items: '', deliverables: '' }])}><Plus size={15} />{j('段階を追加', '添加阶段')}</button>
        </div></details>
        <details className="quote-section" open><summary>04 {j('見積金額・税', '报价金额与税费')}</summary><div className="quote-fields">
          {input('baseFee', j('基本設計費（RMB）', '基础设计费（RMB）'), { numeric: true })}{input('additionalFee', j('追加設計費（RMB）', '附加设计费（RMB）'), { numeric: true })}{input('discount', j('金額調整・減額（RMB）', '费用调整・减额（RMB）'), { numeric: true })}
          <Field label={j('税の扱い', '税务处理')}><select value={q.taxMode} onChange={e => set('taxMode', e.target.value as Quotation['taxMode'])}><option value="unspecified">{j('未指定・要確認', '未指定・待确认')}</option><option value="excluded">{j('税別（税額を加算）', '未税（另加税额）')}</option><option value="included">{j('税込（内税）', '含税（税额已计入）')}</option></select></Field>
          {q.taxMode !== 'unspecified' && input('taxRate', j('税率（%）', '税率（%）'), { numeric: true })}
          <p className="small-note wide">{j('1RMB単位。見積金額の編集は計算機の料金モデルを変更しません。平均単価から総額を逆算しません。', '金额以1元为单位。编辑报价不会修改计算器费率；不会用平均单价反算总额。')}</p>
        </div></details>
        <details className="quote-section"><summary>05 {j('別途費用・見積条件', '不包含项目与报价条件')}</summary><div className="quote-fields">
          {input('validDays', j('見積有効期間（日）', '报价有效期（天）'), { numeric: true })}
          {input('exclusions', j('別途費用・除外項目', '不包含项目'), { multiline: true, wide: true })}{input('notes', j('見積条件・備考', '报价说明'), { multiline: true, wide: true })}{input('payment', j('支払条件（任意）', '付款条件（可选）'), { multiline: true, wide: true })}
        </div></details>
        <details className="quote-section" open><summary>06 {j('発行者・印影・署名', '出具方、印章与签名')}</summary><div className="quote-fields">
          {input('issuer', j('発行会社', '出具公司'), { wide: true })}{input('address', j('住所', '地址'), { multiline: true, wide: true })}{input('contact', j('連絡先（任意）', '联系方式（可选）'), { wide: true })}{input('representative', j('発行者名', '负责人姓名'))}
          <p className="small-note wide">{j('印影は中国法人（上海多三角）のものを使用します。不要な場合は削除できます。署名は任意です。', '使用上海多三角的中国公司印章，不需要时可删除。签名为可选项。')}</p>
          {!q.seal && q.issuer === CHINA_ISSUER && <div className="wide"><button type="button" className="button" disabled={busy} onClick={() => set('seal', createChinaSeal())}>{j('中国法人の印影を使用', '使用中国公司印章')}</button></div>}
          {(['seal', 'signature'] as const).map(kind => <div key={kind}>{imageUpload(kind, kind === 'seal' ? j('中国法人の印影を変更', '更换中国公司印章') : j('署名を追加', '添加签名'))}{q[kind] && <div className="quote-mark"><img src={q[kind]!.data} alt={kind === 'seal' ? j('中国法人の印影', '中国公司印章') : j('署名', '签名')} /><button className="button" onClick={() => set(kind, null)}><X size={14} />{j('削除', '删除')}</button></div>}</div>)}
        </div></details>
      </fieldset>
      <aside className="quote-summary">
        <p className="eyebrow">QUOTATION / RMB</p><h2>{q.project || '—'}</h2>
        <p className="quote-summary-label">{j('見積総額', '报价总额')}</p><p className="quote-summary-total">{totals ? num(totals.total) : '—'}<small>RMB</small></p>
        {totals && <><dl className="result-lines"><div><dt>{j('基本設計費', '基础设计费')}</dt><dd>{num(totals.base)}</dd></div><div><dt>{j('追加設計費', '附加设计费')}</dt><dd>{num(totals.additional)}</dd></div><div><dt>{j('減額', '减额')}</dt><dd>−{num(totals.discount)}</dd></div>{q.taxMode !== 'unspecified' && <div><dt>{q.taxMode === 'included' ? j('内税', '已含税') : j('税額', '税额')}</dt><dd>{num(totals.tax)}</dd></div>}</dl><p className="small-note">{chineseMoney(totals.total)}</p></>}
        {q.taxMode === 'unspecified' && <p className="small-note">{j('税の扱いは未指定です。PDFにも「要確認」と表示します。', '税务处理尚未指定，PDF中将注明“待确认”。')}</p>}
        {errors.length > 0 && <ul className="error" role="alert">{errors.map(e => <li key={e}>{errorText[e] || e}</li>)}</ul>}
        <button className="button primary quote-generate" disabled={busy || !!errors.length} onClick={() => void generate()}><FileText size={17} />{busy ? j('作成中…', '正在生成…') : j('PDFを作成・プレビュー', '生成并预览PDF')}</button>
        <p className="small-note">{j('初回は日本語・中国語フォントの読込に数秒かかります。', '首次需数秒加载中日文字体。')}</p>
        {pdf && isCurrentPdf && <a className="button quote-generate" href={pdf.url} download={pdf.filename}><Download size={17} />{j('PDFを保存', '保存PDF')}</a>}
        {pdf && !isCurrentPdf && <p className="small-note">{j('編集内容を反映するにはPDFを再作成してください。', '内容已修改，请重新生成PDF。')}</p>}
        {error && <p className="error" role="alert">{error}</p>}<p role="status" className="small-note">{notice}</p>
        <p className="small-note">{j('発行前に宛先・業務範囲・税・金額を確認してください。', '出具前请确认委托方、服务范围、税务及金额。')}</p>
      </aside>
    </div>
    {pdf && isCurrentPdf && <section className="quote-preview"><div className="quote-preview-header"><h2>{j('PDFプレビュー', 'PDF预览')}</h2><a className="button" href={pdf.url} target="_blank" rel="noreferrer">{j('別タブで開く', '在新标签页打开')}</a></div><p className="small-note">{j('表示されない端末では「別タブで開く」または「PDFを保存」を使用してください。', '如无法预览，请选择“在新标签页打开”或“保存PDF”。')}</p><iframe title={`${t.fees} PDF`} src={pdf.url} /></section>}
  </main>;
}

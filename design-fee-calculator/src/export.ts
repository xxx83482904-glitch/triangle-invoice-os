import { messages } from './i18n';
import { projectType, simulationCount, simulationRows, type FeeResult } from './calculator';
import type { Language } from './pricing';

export const number = (value: number, digits?: number) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 20,
}).format(value);

export function resultText(name: string, typeId: string, result: FeeResult, lang: Language) {
  const t = messages[lang];
  return [
    'THE TRIANGLE.JP | Design Fee Calculator',
    `${t.name}: ${name.trim() || t.unnamed}`,
    `${t.area}: ${number(result.area)} ㎡`,
    `${t.type}: ${projectType(typeId).label[lang]}`,
    `${t.coefficient}: ${result.coefficient.toFixed(2)}`,
    `${t.model}: ${t.modelName}`,
    `${t.base}: ${number(result.baseFee)} RMB`,
    `${t.average}: ${number(result.averageRate, 1)} RMB/㎡`,
    `${t.additional}: ${number(result.additionalFee)} RMB`,
    `${t.total}: ${number(result.totalFee)} RMB`,
    t.averageNote,
    t.estimateNote,
  ].join('\n');
}

export function chineseQuotation(name: string, typeId: string, result: FeeResult) {
  return [
    'THE TRIANGLE.JP｜设计费用报价',
    `项目名称：${name.trim() || messages.zh.unnamed}`,
    `设计面积：${number(result.area)}㎡`,
    `项目类型：${projectType(typeId).label.zh}（难度系数 ${result.coefficient.toFixed(2)}）`,
    '',
    `计费方式：${messages.zh.modelName}。${messages.zh.floorNote}`,
    `基础设计费：人民币 ${number(result.baseFee)} 元`,
    `平均设计单价：${number(result.averageRate, 1)} RMB/㎡（基础设计费÷设计面积，不含附加设计费）`,
    `附加设计费：人民币 ${number(result.additionalFee)} 元`,
    `设计费总额：人民币 ${number(result.totalFee)} 元`,
    '',
    '以上为设计费概算。设计范围及另行计费服务以双方确认的报价或合同为准。',
  ].join('\n');
}

export const MAX_COPY_ROWS = 20_000;
export function tableText(area: number, typeId: string, lang: Language, excel = false) {
  const t = messages[lang];
  if (simulationCount(area) > MAX_COPY_ROWS) throw new RangeError(t.exportLimit);
  const headers = [`${t.area} (㎡)`, `${t.average} (RMB/㎡)`, `${t.total} (RMB)`];
  const rows = Array.from(simulationRows(area, typeId), row => excel
    ? [String(row.area), number(row.averageRate, 1).replaceAll(',', ''), String(row.totalFee)]
    : [number(row.area), number(row.averageRate, 1), number(row.totalFee)]);
  if (excel) return [headers, ...rows].map(row => row.join('\t')).join('\r\n');
  return [
    `THE TRIANGLE.JP | ${t.simulation}`,
    `${t.type}: ${projectType(typeId).label[lang]} / ${t.coefficient}: ${projectType(typeId).coefficient.toFixed(2)}`,
    t.simulationNote, '', headers.join(' | '), ...rows.map(row => row.join(' | ')),
  ].join('\n');
}

/** HTTPS/localhost clipboard, then synchronous fallback for HTTP NAS/iOS.
 * If both fail the caller shows a selectable manual-copy dialog.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Browser permission can be denied; try the legacy copy path. */ }
  const focused = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px;pointer-events:none';
  document.body.append(textarea);
  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } catch { /* A visible selectable fallback is provided by the UI. */ }
  finally {
    textarea.remove();
    focused?.focus({ preventScroll: true });
  }
  return copied;
}

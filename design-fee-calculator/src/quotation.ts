import Decimal from 'decimal.js';
import type { FeeResult } from './calculator';
import type { Language } from './pricing';
import chinaSeal from './assets/china-seal.json';
import { createSchedule, parseSchedule, scheduleErrors, type Schedule } from './schedule';

export const CHINA_ISSUER = '上海多三角空间设计有限公司';
export function createChinaSeal(): QuoteImage { return { ...chinaSeal }; }

export type ServiceStage = { id: string; title: string; goal: string; items: string; deliverables: string; enabled: boolean };
export type QuoteImage = { name: string; caption: string; data: string };
export type QuotePdfDrawing = QuoteImage & { kind: 'pdf'; pages: number };
export type QuoteAttachment = QuoteImage | QuotePdfDrawing;
export function isPdfDrawing(item: QuoteAttachment): item is QuotePdfDrawing { return 'kind' in item && item.kind === 'pdf'; }
export type Quotation = {
  version: 1; language: Language; title: string; number: string; date: string; validDays: string;
  client: string; project: string; service: string; period: string; area: string; areaNote: string; designer: string;
  baseFee: string; additionalFee: string; discount: string; taxMode: 'unspecified' | 'excluded' | 'included'; taxRate: string;
  stages: ServiceStage[]; exclusions: string; notes: string; payment: string;
  issuer: string; address: string; contact: string; representative: string;
  images: QuoteAttachment[]; seal: QuoteImage | null; signature: QuoteImage | null;
  schedule: Schedule;
};

export const documentLabels = {
  zh: { overview: '项目概要', client: '委托方', project: '项目名称', service: '服务内容', period: '暂定服务周期', area: '设计面积', areaNote: '面积说明', designer: '主设计师', number: '报价编号', date: '出具日期', scope: '室内设计服务内容', goal: '阶段目标', deliverables: '阶段交付成果', exclusions: '相关说明 / 不包含项目', fees: '设计报价', base: '基础设计费', additional: '附加设计费', discount: '费用调整（减额）', subtotal: '设计费小计', average: '平均设计单价', total: '设计费总额', upper: '大写金额', tax: '税额', included: '已含税额', unspecified: '税务处理：待双方确认。', payment: '付款条件', notes: '报价说明', validity: '报价有效期', days: '天（自出具之日起）', averageNote: '平均设计单价＝基础设计费÷设计面积，仅供参考；不作为总额计算依据。', adjustmentNote: '本报价以以下金额为准。', draft: '待确认' },
  ja: { overview: 'プロジェクト概要', client: '宛先', project: 'プロジェクト名', service: 'サービス内容', period: '予定業務期間', area: '設計面積', areaNote: '面積内訳', designer: '担当デザイナー', number: '見積番号', date: '発行日', scope: '設計業務の内容', goal: '段階の目的', deliverables: '成果物', exclusions: '別途費用・含まれない業務', fees: '設計費見積', base: '基本設計費', additional: '追加設計費', discount: '金額調整（減額）', subtotal: '設計費小計', average: '実質平均単価', total: '設計費総額', upper: '人民元大写', tax: '税額', included: '内税額', unspecified: '税の扱い：双方確認のうえ決定。', payment: '支払条件', notes: '見積条件', validity: '有効期間', days: '日間（発行日から）', averageNote: '平均単価＝基本設計費÷設計面積。参考値であり、総額の計算には使用しません。', adjustmentNote: '見積金額は以下のとおりです。', draft: '未定' },
};

const legacyRenderingExclusion = '5. 环境素材及特殊技术费用：包括摄影、插图、渲染及其他特定技术性制作费用。';
const renderingExclusion = '5. 环境素材及特殊技术费用：包括摄影、插图，以及超出本报价所列设计服务范围、经甲方书面确认的特殊CG或影像制作费用。本报价所列常规效果图制作已包含在基础设计费内。';

/** Apply the user-approved clarification only to unchanged reference wording. */
export function clarifyRenderingScope(q: Quotation): Quotation {
  return { ...q,
    stages: q.stages.map(s => ({ ...s, items: s.items.split('\n').map(line => line === '效果图制作' ? '常规效果图制作（包含在基础设计费内）' : line).join('\n') })),
    exclusions: q.exclusions.split('\n').map(line => line === legacyRenderingExclusion ? renderingExclusion : line).join('\n'),
  };
}

const zhStages: ServiceStage[] = [
  { id: 'concept', enabled: true, title: '概念设计阶段（Concept Design）', goal: '明确品牌与空间定位，建立整体设计概念与空间氛围方向，为后续深化提供创意基础。', items: '项目内容及品牌特性调研与分析\n设计方向与空间主题概念构思\n提供讨论用的概念图片\n关键设计元素及材质意向表达\n初步空间功能分区与动线规划\n平面概念方案与逻辑说明\n入口、主要动线及核心展示区概念设计\n灯光概念设计与照明策略说明\n概念设计汇报资料制作（含设计意图、参考图像及空间氛围说明）', deliverables: '概念设计汇报文本（PDF）' },
  { id: 'schematic', enabled: true, title: '方案设计阶段（Schematic Design）', goal: '将概念方案具体化，形成具备功能性、表现力及可行性的空间设计方案。', items: '空间方案深化与设计逻辑说明\n平面图绘制（含动线、功能区比例）\n立面与空间造型设计\n材料、色彩与灯光氛围初步提案\n效果图制作\n重点空间剖析与设计说明\n配合确定法规条例，确认落地可行性\n配合消防许可确认\n方案设计汇报资料制作（含效果图与材料意向）', deliverables: '方案设计汇报文本（PDF）\n平面图纸（CAD/PDF）' },
  { id: 'development', enabled: true, title: '深化扩初阶段（Design Development）', goal: '在方案基础上完成可执行的扩初设计文件，确保施工与设计意图一致。', items: '各层平面、地面、天花系统图绘制\n室内外立面详图、剖面详图绘制\n节点细部深化（栏杆、吧台、造型墙等）\n插座与设备点位图绘制\n原创家具、装置及展陈系统详图\n标识系统定位与安装详图\n材料与五金表制作（含编号与说明）\n灯具布置图（含编号与安装方式）\n灯具选型表（含品牌、型号、参数）\n灯光控制分区图与初步回路建议\n灯光模拟图（关键空间）\n灯具安装示意节点图\n材料样品整理、实物打样与汇总', deliverables: '深化扩初图纸（CAD/PDF）\n材料样品' },
  { id: 'site', enabled: true, title: '现场施工配合阶段（Site Coordination）', goal: '确保施工落地符合设计意图，控制空间品质与细节表现。', items: '确认施工现场，确保施工质量\n材料、工艺及样板审核确认\n灯光现场调试（角度、色温、亮度、场景）\n审核施工单位提交的制作深化图纸是否符合设计意向（根据施工方制作工艺）\n协调施工工艺与设计一致性\n提供关键节点的优化意见与尺寸建议\n配合各专业设计（机电、暖通、给排水）提供相关的意见建议\n定期查看工地是否符合设计要求（经甲乙双方协商）\n参加现场技术协调及工程例会，及时解决施工中出现的设计问题（根据实际情况，到现场或者在线视频会议）\n配合现场验收', deliverables: '灯光设计图纸与选型表\n灯光模拟图（关键空间）\n调试与灯具调整记录' },
];
const zhExclusions = '以下费用不包含在本次报价总金额内，如有需要，可根据项目实际情况另行报价并经甲方书面确认：\n1. 制作施工图费：包括空调，消防，弱电等专业分包图纸，及设计院出图、盖章及相关协调费用。若甲方委托乙方代交由第三方制作，须事先明确费用标准并获得甲方书面同意。\n2. 政府报批与专业咨询类费用：包括设计院盖章费、消防报审与咨询沟通费、结构设计费、工程量精算费等。\n3. 专项设计服务费用：包括但不限于专业舞台灯光、空调及电气设备设计、厨房专业设计服务等。\n4. 音响及品牌标准化施工配合费用：包括音响系统设计费及第三方品牌卖场的标准制作与接口配合费用。\n5. 环境素材及特殊技术费用：包括摄影、插图、渲染及其他特定技术性制作费用。\n6. 广告与形象传播类设计费用：包括与室内装修相关的广告设计、视觉推广、肖像或形象应用服务等。';

export function createQuotation(name: string, result: FeeResult, now = new Date()): Quotation {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return clarifyRenderingScope({ version: 1, language: 'zh', title: '空间设计项目报价单', number: '', date, validDays: '30', client: '', project: name,
    service: '室内装修设计服务', period: '', area: String(result.area), areaNote: '', designer: '吴胜人 KURE Masato',
    baseFee: String(result.baseFee), additionalFee: String(result.additionalFee), discount: '0', taxMode: 'unspecified', taxRate: '0',
    stages: structuredClone(zhStages), exclusions: zhExclusions,
    notes: '以上报价均以人民币计算，不含设计师赴现场配合的差旅费用。\n最终费用将根据实际项目面积及服务范围进行相应调整。', payment: '',
    issuer: CHINA_ISSUER, address: '上海市静安区胶州路273弄60号现所一期', contact: '', representative: '吴胜人', images: [], seal: createChinaSeal(), signature: null, schedule: createSchedule(zhStages) });
}

export const MAX_MONEY = 999_999_999_999;
function amount(raw: string, allowEmpty = true) {
  if (allowEmpty && !raw.trim()) return new Decimal(0);
  if (!/^\d+$/.test(raw.trim())) throw new Error('money');
  const value = new Decimal(raw);
  if (value.gt(MAX_MONEY)) throw new Error('money');
  return value;
}
export function quotationTotals(q: Quotation) {
  const base = amount(q.baseFee, false), additional = amount(q.additionalFee), discount = amount(q.discount);
  if (!/^\d+(\.\d+)?$/.test(q.area) || new Decimal(q.area).lte(0) || new Decimal(q.area).gt(MAX_MONEY)) throw new Error('area');
  const subtotal = base.plus(additional).minus(discount);
  if (subtotal.lt(0)) throw new Error('discount');
  const rate = q.taxMode === 'unspecified' ? new Decimal(0) : /^\d+(\.\d{1,4})?$/.test(q.taxRate) ? new Decimal(q.taxRate) : new Decimal(-1);
  if (rate.lt(0) || rate.gt(100)) throw new Error('tax');
  const tax = (q.taxMode === 'included' ? subtotal.times(rate).div(rate.plus(100)) : subtotal.times(rate).div(100)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const total = q.taxMode === 'excluded' ? subtotal.plus(tax) : subtotal;
  if (total.gt(MAX_MONEY)) throw new Error('money');
  return { base: base.toNumber(), additional: additional.toNumber(), discount: discount.toNumber(), subtotal: subtotal.toNumber(), tax: tax.toNumber(), total: total.toNumber(), average: base.div(q.area).toNumber() };
}

export function chineseMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) throw new Error('money');
  if (!value) return '零元整';
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const small = ['', '拾', '佰', '仟'], big = ['', '万', '亿'];
  let n = value, out = '', groupIndex = 0, pendingZero = false;
  while (n > 0) {
    const group = n % 10000;
    if (!group) pendingZero = !!out;
    else {
      let part = '', zero = false;
      const s = String(group);
      for (let i = 0; i < s.length; i++) {
        const d = Number(s[i]);
        if (!d) { zero = !!part; continue; }
        if (zero) part += '零';
        part += digits[d] + small[s.length - i - 1]; zero = false;
      }
      out = part + big[groupIndex] + (out && pendingZero ? '零' : '') + out;
      // A low-order group below 1000 needs a separating zero from the next group.
      pendingZero = group < 1000;
    }
    n = Math.floor(n / 10000); groupIndex++;
  }
  return out + '元整';
}

export function quoteErrors(q: Quotation): string[] {
  const errors: string[] = [];
  if (!q.title.trim() || !q.project.trim() || !q.issuer.trim()) errors.push('required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date) || Number.isNaN(Date.parse(q.date)) || new Date(q.date).toISOString().slice(0, 10) !== q.date) errors.push('date');
  if (!/^\d+$/.test(q.validDays) || Number(q.validDays) < 1 || Number(q.validDays) > 3650) errors.push('validity');
  try { quotationTotals(q); } catch (e) { errors.push((e as Error).message); }
  if (q.schedule.includeInQuotation && scheduleErrors(q.schedule, q.language).length) errors.push('schedule');
  return errors;
}

/** Whitelist and size-check imports. Never trust a draft to contain executable markup or URLs. */
export function parseQuotation(json: string): Quotation {
  if (json.length > 12_000_000) throw new Error('draft');
  const raw = JSON.parse(json);
  if (!raw || raw.version !== 1 || !['ja', 'zh'].includes(raw.language) || !['unspecified', 'excluded', 'included'].includes(raw.taxMode)) throw new Error('draft');
  const q: Record<string, unknown> = { version: 1, language: raw.language, taxMode: raw.taxMode };
  for (const key of ['title', 'number', 'date', 'validDays', 'client', 'project', 'service', 'period', 'area', 'areaNote', 'designer', 'baseFee', 'additionalFee', 'discount', 'taxRate', 'exclusions', 'notes', 'payment', 'issuer', 'address', 'contact', 'representative']) {
    if (typeof raw[key] !== 'string' || raw[key].length > 20000) throw new Error('draft');
    q[key] = raw[key];
  }
  if (!Array.isArray(raw.stages) || raw.stages.length > 20) throw new Error('draft');
  q.stages = raw.stages.map((s: Record<string, unknown>, i: number) => {
    for (const k of ['title', 'goal', 'items', 'deliverables']) if (typeof s[k] !== 'string' || (s[k] as string).length > 20000) throw new Error('draft');
    if (typeof s.enabled !== 'boolean') throw new Error('draft');
    return { id: `stage-${i}`, title: s.title, goal: s.goal, items: s.items, deliverables: s.deliverables, enabled: s.enabled };
  });
  function image(v: unknown): QuoteImage | null {
    if (v === null) return null;
    const x = v as QuoteImage;
    if (!x || typeof x.name !== 'string' || x.name.length > 300 || typeof x.caption !== 'string' || x.caption.length > 300 || typeof x.data !== 'string' || x.data.length > 2_000_000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(x.data)) throw new Error('draft');
    return { name: x.name, caption: x.caption, data: x.data };
  }
  if (!Array.isArray(raw.images) || raw.images.length > 12) throw new Error('draft');
  q.images = raw.images.map((value: unknown) => {
    const x = value as QuotePdfDrawing;
    if (x?.kind === 'pdf') {
      if (typeof x.name !== 'string' || x.name.length > 300 || typeof x.caption !== 'string' || x.caption.length > 300
        || typeof x.data !== 'string' || x.data.length > 10_700_000 || !/^data:application\/pdf;base64,JVBERi0[A-Za-z0-9+/]+=*$/.test(x.data)
        || !Number.isInteger(x.pages) || x.pages < 1 || x.pages > 50) throw new Error('draft');
      return { kind: 'pdf', name: x.name, caption: x.caption, data: x.data, pages: x.pages };
    }
    const img = image(value); if (!img) throw new Error('draft'); return img;
  });
  q.seal = image(raw.seal); q.signature = image(raw.signature);
  q.schedule = parseSchedule(raw.schedule, q.stages as ServiceStage[]);
  return q as Quotation;
}

export function quoteFilename(q: Quotation, extension: string) {
  return `${q.date}_${q.project}_${q.number || 'quotation'}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) + '.' + extension;
}

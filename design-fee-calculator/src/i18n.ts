import { pricing } from './pricing';

const format = (value: number) => value.toLocaleString('en-US');
const minimum = format(pricing.minimumFee);
const included = format(pricing.includedArea);
const currentLimit = format(pricing.currentBands.at(-1)!.upTo);
const step = format(pricing.simulationStep);

export const messages = {
  ja: {
    intro: '面積と用途から、設計費の目安を算出します。',
    inputs: 'プロジェクト条件', result: '設計費計算結果', name: 'プロジェクト名', area: '設計面積', type: 'プロジェクト種別',
    additional: '追加設計費', optional: '任意', additionalHint: '未入力は0元。1RMB単位で入力。',
    base: '基本設計費', average: '実質平均単価', total: '設計費総額', coefficient: '難易度係数',
    model: '改定モデル', modelName: '最低料金＋段階加算方式', modelNote: '追加面積にのみ各区分の単価を適用。',
    averageNote: '平均単価は基本設計費÷設計面積。追加設計費は含みません。',
    copyResult: '計算結果をコピー', copyChinese: '中国語の見積文をコピー', copyTable: '比較表をコピー', copyExcel: 'Excel用にコピー',
    copied: 'コピーしました', copyFailed: '自動コピーが使えません。下のテキストを選択してコピーしてください。',
    manualCopy: 'コピー用テキスト', close: '閉じる', selectAll: 'すべて選択',
    simulation: '面積別シミュレーション', simulationNote: `入力面積から${step}㎡ずつ減算。同じ難易度係数を適用し、追加設計費は含みません。`,
    selected: '入力面積', rows: '件', previous: '前へ', next: '次へ',
    legacy: '現行料金表との比較', legacyTitle: `現行基準（${pricing.version}）`, revisedTitle: '改定モデル', difference: '差額（改定 − 現行）',
    legacyNote: `現行方式：${format(pricing.currentBands[0].upTo)}㎡以下は${format(pricing.currentBands[0].fixedFee!)}元固定。${format(pricing.currentBands[0].upTo)}㎡超は該当区分の単価×面積全体×係数（最低料金の再適用なし）。区分境界で料金が下がる元の計算をそのまま再現しています。`,
    legacyExtras: '両方式に同じ追加設計費を含めて比較します。',
    undefinedFee: '現行料金は未定義', undefinedNote: `${currentLimit}㎡超の現行単価は未定義のため、旧料金と差額は算出しません。`,
    rate: '設計単価', fixed: '固定料金', breakdown: '計算の内訳', minimum: '最低料金', progressive: '段階加算額',
    adjusted: '係数適用後', rounded: '最低料金保証・1RMB単位に四捨五入',
    extraArea: '追加面積', marginal: '追加面積の単価', amount: '加算額',
    settings: '料金モデルについて', settingsNote: '各単価は区分内の追加面積にのみ適用します。実質平均単価を掛けて計算する方式ではありません。',
    floorNote: `${included}㎡までの最低料金を起点に段階加算。難易度係数を掛け、最低${minimum}元を保証し、1RMB単位で四捨五入した後に追加設計費を加算します。`,
    included: '以下', over: '超', empty: '有効な面積と追加設計費を入力すると、計算結果が表示されます。',
    unnamed: '名称未入力', currencyNote: 'すべての金額は人民元（RMB）',
    estimateNote: '設計費の概算です。設計範囲・別途業務は個別に確認してください。',
    exportLimit: '一括コピーは20,000行まで対応しています。面積を小さくしてご利用ください。',
    errors: { required: '設計面積を入力してください。', invalid: '有効な数値を入力してください。', positive: '面積は0より大きく、追加設計費は0以上で入力してください。', whole: '追加設計費は1RMB単位の整数で入力してください。', range: '計算できる数値の範囲を超えています。' },
  },
  zh: {
    intro: '输入面积与项目类型，即时计算设计费用。',
    inputs: '项目条件', result: '设计费用计算结果', name: '项目名称', area: '设计面积', type: '项目类型',
    additional: '附加设计费', optional: '选填', additionalHint: '留空按0元计算，以1RMB为单位输入。',
    base: '基础设计费', average: '平均设计单价', total: '设计费总额', coefficient: '难度系数',
    model: '修订方案', modelName: '最低费用＋阶梯累加', modelNote: '各档单价仅适用于该档新增面积。',
    averageNote: '平均设计单价＝基础设计费÷设计面积，不含附加设计费。',
    copyResult: '复制计算结果', copyChinese: '复制中文报价文本', copyTable: '复制面积对照表', copyExcel: '复制到Excel',
    copied: '已复制', copyFailed: '无法自动复制，请选择下方文本并手动复制。',
    manualCopy: '待复制文本', close: '关闭', selectAll: '全选',
    simulation: '面积费用对照', simulationNote: `从输入面积起，每次减少${step}㎡。采用相同难度系数，不含附加设计费。`,
    selected: '输入面积', rows: '项', previous: '上一页', next: '下一页',
    legacy: '与现行收费表比较', legacyTitle: `现行标准（${pricing.version}）`, revisedTitle: '修订方案', difference: '差额（修订 − 现行）',
    legacyNote: `现行方式：${format(pricing.currentBands[0].upTo)}㎡及以下固定${format(pricing.currentBands[0].fixedFee!)}元；超过${format(pricing.currentBands[0].upTo)}㎡按所属档单价×全部面积×系数计算，不再次套用最低费用。保留原计算方式在档位边界可能出现的费用下降。`,
    legacyExtras: '两种方式均包含相同的附加设计费。',
    undefinedFee: '现行费用未定义', undefinedNote: `超过${currentLimit}㎡的现行单价未定义，因此不计算现行费用及差额。`,
    rate: '设计单价', fixed: '固定费用', breakdown: '计算明细', minimum: '最低费用', progressive: '阶梯累加金额',
    adjusted: '应用系数后', rounded: '保证最低费用，并四舍五入至1RMB',
    extraArea: '新增面积', marginal: '新增面积单价', amount: '累加费用',
    settings: '关于收费模型', settingsNote: '各档单价仅用于该档新增面积，请勿用平均设计单价乘以面积计算总额。',
    floorNote: `以${included}㎡以内的最低费用为起点进行阶梯累加。乘以难度系数后，保证最低${minimum}元，四舍五入至1RMB后，再加上附加设计费。`,
    included: '及以下', over: '以上', empty: '请输入有效的面积与附加设计费，以查看计算结果。',
    unnamed: '未命名项目', currencyNote: '所有金额均为人民币（RMB）',
    estimateNote: '此计算为设计费概算，设计范围与另行计费服务需单独确认。',
    exportLimit: '一次最多复制20,000行，请缩小输入面积后再试。',
    errors: { required: '请输入设计面积。', invalid: '请输入有效数字。', positive: '面积须大于0，附加设计费须不小于0。', whole: '附加设计费须为整数，以1RMB为单位。', range: '数值超出可计算范围。' },
  },
} as const;

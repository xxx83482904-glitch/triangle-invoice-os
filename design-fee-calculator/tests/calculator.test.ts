import { describe, expect, it } from 'vitest';
import { calculateCurrentFee, calculateRevisedFee, parseInput, simulationCount, simulationRows, validateConfig } from '../src/calculator';
import { pricing } from '../src/pricing';
import { chineseQuotation, resultText, tableText } from '../src/export';

// Independent fixtures transcribed from the user's specification, not derived from config.
const currentFixture = [
  [150, 0], [170, 1494], [210, 1344], [250, 1206], [300, 1086],
  [360, 1032], [430, 984], [520, 930], [620, 888], [740, 840],
  [900, 822], [1100, 810], [1300, 792], [1500, 774], [1800, 762],
  [2200, 744], [2700, 732], [3200, 714], [3800, 702], [4600, 690],
  [5500, 672], [6600, 660], [7900, 648], [9500, 636], [11400, 624], [13700, 606],
];
const revisedFixture = [
  [150, 1600.0, 240000], [170, 1494.1, 254000], [210, 1342.9, 282000],
  [250, 1240.0, 310000], [300, 1150.0, 345000], [360, 1075.0, 387000],
  [430, 1014.0, 436000], [520, 959.6, 499000], [620, 917.7, 569000],
  [740, 882.4, 653000], [900, 850.0, 765000], [1100, 822.7, 905000],
  [1300, 803.8, 1045000], [1500, 790.0, 1185000], [1800, 768.3, 1383000],
  [2200, 748.6, 1647000], [2700, 732.2, 1977000], [3200, 718.4, 2299000],
  [3800, 702.9, 2671000], [4600, 688.5, 3167000], [5500, 671.8, 3695000],
  [6600, 653.2, 4311000], [7900, 637.8, 5039000], [9500, 624.7, 5935000],
  [11400, 613.9, 6999000], [13700, 604.9, 8287000],
];

describe('Immutable 2026 current model', () => {
  it('contains all 26 original bands exactly', () => {
    expect(pricing.currentBands).toHaveLength(26);
    expect(pricing.currentBands.map(b => [b.upTo, b.rate ?? 0])).toEqual(currentFixture);
    expect(pricing.currentBands[0].fixedFee).toBe(240000);
  });
  it.each(currentFixture)('uses the inclusive upper bound at %s㎡', (bound, rate) => {
    expect(calculateCurrentFee(bound)?.baseFee).toBe(rate ? bound * rate : 240000);
    expect(calculateCurrentFee(bound - 0.01)?.band.upTo).toBe(bound);
    const next = currentFixture.find(row => row[0] > bound);
    expect(calculateCurrentFee(bound + 0.01)?.band.upTo ?? null).toBe(next?.[0] ?? null);
  });
  it.each([[300, 325800], [800, 657600], [3800, 2667600], [6300, 4158000]])('matches %s㎡ example', (area, fee) => {
    expect(calculateCurrentFee(area)?.baseFee).toBe(fee);
  });
  it('does not extrapolate above 13,700㎡', () => {
    expect(calculateCurrentFee(13700.0001)).toBeNull();
    expect(calculateCurrentFee(20000, 'residential', 50000)).toBeNull();
  });
  it('preserves original downward jumps and its different minimum rule', () => {
    expect(calculateCurrentFee(151)?.baseFee).toBe(225594);
    expect(calculateCurrentFee(151)?.baseFee).toBeLessThan(calculateCurrentFee(150)!.baseFee);
    expect(calculateCurrentFee(150, 'residential')?.baseFee).toBe(240000);
    expect(calculateCurrentFee(150, 'office')?.baseFee).toBe(240000);
    expect(calculateCurrentFee(151, 'office')?.baseFee).toBe(196267);
    expect(calculateRevisedFee(151, 'office').baseFee).toBe(240000);
  });
});

describe('Progressive revised model', () => {
  it.each(revisedFixture)('matches reference at %s㎡: average %s / total %s', (area, average, fee) => {
    const result = calculateRevisedFee(area);
    expect(result.baseFee).toBe(fee);
    expect(Number(result.averageRate.toFixed(1))).toBe(average);
  });
  it('matches the initial quote and never multiplies the rounded average', () => {
    const result = calculateRevisedFee(6300);
    expect(result.baseFee).toBe(4143000);
    expect(result.totalFee).toBe(4143000);
    expect(result.averageRate.toFixed(1)).toBe('657.6');
    const residential = calculateRevisedFee(1800);
    expect(residential.totalFee).toBe(1383000);
    expect(Number(residential.averageRate.toFixed(1)) * 1800).not.toBe(residential.totalFee);
  });
  it.each([[150, 240000, 0, 700], [1500, 1185000, 700, 660], [3000, 2175000, 660, 620], [5000, 3415000, 620, 560]])('is continuous around %s㎡', (area, fee, leftRate, rightRate) => {
    expect(calculateRevisedFee(area).subtotal).toBe(fee);
    expect(calculateRevisedFee(area - 0.01).subtotal).toBeCloseTo(fee - leftRate * 0.01, 6);
    expect(calculateRevisedFee(area + 0.01).subtotal).toBeCloseTo(fee + rightRate * 0.01, 6);
    expect(calculateRevisedFee(area - 1).baseFee).toBe(fee - leftRate);
    expect(calculateRevisedFee(area + 1).baseFee).toBe(fee + rightRate);
  });
  it.each(['retail', 'residential', 'hotel', 'office'])('never decreases across 20,000㎡ for %s', type => {
    let previous = 0;
    for (let area = 1; area <= 20000; area++) {
      const amount = calculateRevisedFee(area, type).totalFee;
      if (amount < previous) throw new Error(`Fee decreased at ${area}㎡ (${type})`);
      previous = amount;
    }
    expect(previous).toBeGreaterThan(0);
  });
  it.each([['retail', 1, 4143000], ['residential', 1.07, 4433010], ['hotel', 0.96, 3977280], ['office', 0.87, 3604410]] as const)('applies the %s coefficient exactly', (type, coefficient, expected) => {
    expect(pricing.projectTypes.find(p => p.id === type)?.coefficient).toBe(coefficient);
    expect(calculateRevisedFee(6300, type).baseFee).toBe(expected);
    expect(calculateCurrentFee(6300, type)?.baseFee).toBe(Math.round(4158000 * coefficient));
  });
  it('applies the revised minimum after coefficient, then rounds, then adds extras', () => {
    expect(calculateRevisedFee(100, 'office', 1500).totalFee).toBe(241500);
    expect(calculateRevisedFee(100, 'residential').baseFee).toBe(256800);
    expect(calculateRevisedFee(2000.25, 'residential', 50000).baseFee).toBe(1621227); // 1,621,226.55
    expect(calculateRevisedFee(2000.25, 'residential', 50000).totalFee).toBe(1671227);
    expect(calculateRevisedFee(150.005).baseFee).toBe(240004); // exactly 240003.5
    expect(calculateCurrentFee(6300, 'office', 50000)?.totalFee).toBe(3667460);
    expect(calculateRevisedFee(6300, 'retail', 50000).averageRate).toBe(calculateRevisedFee(6300).averageRate);
  });
  it('supports future rate/boundary edits without changing calculation code', () => {
    const config = { ...pricing, minimumFee: 1000, includedArea: 10, revisedTiers: [
      { upTo: 20, rate: 100 }, { upTo: 40, rate: 50 }, { upTo: null, rate: 10 },
    ] };
    validateConfig(config);
    expect(calculateRevisedFee(50, 'retail', 0, config).baseFee).toBe(3100);
  });
  it('rejects broken tier configuration', () => {
    expect(() => validateConfig({ ...pricing, revisedTiers: [{ upTo: 100, rate: 700 }] })).toThrow();
    expect(() => validateConfig({ ...pricing, revisedTiers: [{ upTo: null, rate: -1 }] })).toThrow();
  });
});

describe('500㎡ simulation', () => {
  it('matches all 13 initial rows, totals and average rates', () => {
    const expected = [
      [6300, 660, 4158000], [5800, 660, 3828000], [5300, 672, 3561600],
      [4800, 672, 3225600], [4300, 690, 2967000], [3800, 702, 2667600],
      [3300, 702, 2316600], [2800, 714, 1999200], [2300, 732, 1683600],
      [1800, 762, 1371600], [1300, 792, 1029600], [800, 822, 657600], [300, 1086, 325800],
    ];
    expect(Array.from(simulationRows(6300), r => [r.area, Number(r.averageRate.toFixed(1)), r.totalFee])).toEqual(expected);
  });
  it.each([100, 500, 501, 1000, 1234.56, 6300, 13700])('starts at %s and decrements by exactly 500, excluding nonpositive areas', area => {
    const rows = Array.from(simulationRows(area, 'hotel'));
    expect(rows).toHaveLength(Math.ceil(area / 500));
    expect(rows[0].area).toBe(area);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].area).toBeGreaterThan(0);
      expect(rows[i].additionalFee).toBe(0);
      expect(rows[i].coefficient).toBe(0.96);
      if (i) expect(rows[i - 1].area - rows[i].area).toBeCloseTo(500, 8);
    }
  });
  it('rejects undefined rates without skipping rows or extrapolating', () => {
    expect(() => Array.from(simulationRows(13700.01))).toThrow('Area rate is undefined');
    expect(() => Array.from(simulationRows(20000, 'retail', 20, 5))).toThrow();
    expect(simulationCount(13700)).toBe(28);
    expect(Array.from(simulationRows(13700, 'retail', 25, 5)).map(row => row.area)).toEqual([1200, 700, 200]);
    expect(() => tableText(20000, 'retail', 'ja')).toThrow();
  });
});

describe('Input and export', () => {
  it.each(['', ' ', 'abc', '1x', 'NaN', 'Infinity', '1e3', '6,30', '--1', '0', '-10', '0x10', '1.2.3'])('rejects invalid area %j', input => {
    expect(parseInput(input, 'area').error).toBeDefined();
  });
  it('accepts grouped/full-width/decimal area and optional extras', () => {
    expect(parseInput('６，３００.５', 'area').value).toBe(6300.5);
    expect(parseInput(' 6300 ', 'area').value).toBe(6300);
    expect(parseInput('', 'additional').value).toBe(0);
    expect(parseInput('0', 'additional').value).toBe(0);
    expect(parseInput('-1', 'additional').error).toBe('positive');
    expect(parseInput('0.5', 'additional').error).toBe('whole');
    expect(parseInput('9007199254740992', 'area').error).toBe('range');
  });
  it.each([0, -1, NaN, Infinity, -Infinity])('rejects nonpositive/nonfinite raw area %s in both functions', value => {
    expect(() => calculateRevisedFee(value)).toThrow();
    expect(() => calculateCurrentFee(value)).toThrow();
  });
  it('rejects unsafe money, unknown types and invalid extras', () => {
    expect(() => calculateRevisedFee(Number.MIN_VALUE)).toThrow();
    expect(() => calculateCurrentFee(Number.MIN_VALUE)).toThrow();
    expect(() => calculateRevisedFee(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => calculateRevisedFee(1, 'unknown')).toThrow();
    for (const extra of [-1, 1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
      expect(() => calculateRevisedFee(6300, 'retail', extra)).toThrow();
      expect(() => calculateCurrentFee(6300, 'retail', extra)).toThrow();
    }
  });
  it('copies result and Chinese quotation with standardized labels and correct totals', () => {
    const result = calculateCurrentFee(6300, 'retail', 20000)!;
    const ja = resultText('钛马赫新展厅', 'retail', result, 'ja');
    const zh = chineseQuotation('钛马赫新展厅', 'retail', result);
    expect(ja).toContain('設計費総額: 4,178,000 RMB');
    for (const label of ['设计面积', '平均设计单价', '基础设计费', '附加设计费', '设计费总额']) expect(zh).toContain(label);
    expect(zh).toContain('4,178,000');
    expect(zh).toContain('面积 × 所属档单价');
    expect(zh).not.toContain('阶梯累加');
    expect(ja).toContain('面積 × 該当区分の単価');
  });
  it('exports all rows as numeric TSV (no grouping commas) without extras', () => {
    const rows = tableText(6300, 'retail', 'zh', true).split('\r\n').map(r => r.split('\t'));
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual(['设计面积 (㎡)', '平均设计单价 (RMB/㎡)', '设计费总额 (RMB)']);
    expect(rows[1]).toEqual(['6300', '660.0', '4158000']);
    expect(rows.at(-1)).toEqual(['300', '1086.0', '325800']);
    expect(tableText(6300, 'office', 'ja')).toContain('0.87');
    expect(() => tableText(10000500, 'retail', 'ja')).toThrow();
  });
});


describe('Main band fee integration', () => {
  it('keeps the fixed fee only within the fixed band and multiplies the entire area above it', () => {
    expect(calculateCurrentFee(150, 'residential', 1000)).toMatchObject({ baseFee: 240000, totalFee: 241000, breakdown: [] });
    expect(calculateCurrentFee(151)).toMatchObject({ subtotal: 225594, baseFee: 225594, minimumApplied: false });
    expect(calculateCurrentFee(6300)).toMatchObject({ subtotal: 4158000, baseFee: 4158000, averageRate: 660,
      breakdown: [{ from: 0, to: 6300, area: 6300, rate: 660, amount: 4158000 }] });
  });
  it('rounds only the coefficient-adjusted fee before adding extras', () => {
    const fee = calculateCurrentFee(6300.25, 'residential', 123)!;
    expect(fee.baseFee).toBe(4449237);
    expect(fee.totalFee).toBe(4449360);
    expect(Number(fee.averageRate.toFixed(1)) * fee.area).not.toBe(fee.baseFee);
  });
  it('uses edited band configuration without changing logic', () => {
    const config = { ...pricing, currentBands: [{ upTo: 100, fixedFee: 1000 }, { upTo: 200, rate: 20 }] };
    validateConfig(config);
    expect(calculateCurrentFee(100, 'residential', 0, config)?.baseFee).toBe(1000);
    expect(calculateCurrentFee(101, 'retail', 0, config)?.baseFee).toBe(2020);
    expect(calculateCurrentFee(201, 'retail', 0, config)).toBeNull();
  });
});

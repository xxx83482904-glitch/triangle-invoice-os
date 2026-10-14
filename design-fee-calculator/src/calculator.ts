import Decimal from 'decimal.js';
import { pricing, type PricingConfig } from './pricing';

// Decimal arithmetic prevents binary floating-point errors at RMB half-unit boundaries.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const MAX = Number.MAX_SAFE_INTEGER;

export function validateConfig(config: PricingConfig): void {
  if (!(config.minimumFee > 0) || !Number.isSafeInteger(config.minimumFee)
    || !(config.includedArea > 0) || !Number.isFinite(config.includedArea)
    || !(config.simulationStep > 0) || !Number.isFinite(config.simulationStep)) throw new Error('Invalid pricing configuration');
  let lower = config.includedArea;
  config.revisedTiers.forEach((tier, index) => {
    if (!Number.isFinite(tier.rate) || tier.rate <= 0
      || (tier.upTo === null ? index !== config.revisedTiers.length - 1 : !Number.isFinite(tier.upTo) || tier.upTo <= lower)) {
      throw new Error('Tiers must increase and have positive marginal rates');
    }
    lower = tier.upTo ?? lower;
  });
  if (!config.revisedTiers.length || config.revisedTiers.at(-1)?.upTo !== null) throw new Error('Final tier must be unbounded');
  let previous = 0;
  for (const band of config.currentBands) {
    const fee = band.fixedFee ?? band.rate;
    if (!Number.isFinite(band.upTo) || band.upTo <= previous || !Number.isFinite(fee) || fee <= 0) throw new Error('Invalid current band');
    previous = band.upTo;
  }
  if (!config.currentBands.length || !config.projectTypes.length
    || new Set(config.projectTypes.map(type => type.id)).size !== config.projectTypes.length
    || config.projectTypes.some(type => !Number.isFinite(type.coefficient) || type.coefficient <= 0)) throw new Error('Invalid project types');
}
validateConfig(pricing);

function validArea(area: number) {
  if (!Number.isFinite(area) || area <= 0 || area > MAX) throw new RangeError('Invalid area');
}
function validAdditional(additional: number) {
  if (!Number.isSafeInteger(additional) || additional < 0) throw new RangeError('Additional fee must be a nonnegative whole RMB amount');
}
export function projectType(id: string, config = pricing) {
  const type = config.projectTypes.find(type => type.id === id);
  if (!type) throw new RangeError('Unknown project type');
  return type;
}
function safeMoney(amount: Decimal) {
  const rounded = amount.toDecimalPlaces(0, D.ROUND_HALF_UP);
  if (!rounded.isFinite() || rounded.abs().gt(MAX)) throw new RangeError('Amount exceeds safe range');
  return rounded.toNumber();
}

function averageRate(baseFee: number, area: number) {
  const average = new D(baseFee).div(area);
  if (!average.isFinite() || average.gt(MAX)) throw new RangeError('Average rate exceeds safe range');
  return average.toNumber();
}

export type BreakdownRow = { from: number; to: number; area: number; rate: number; amount: number };
function progressive(area: number, config: PricingConfig) {
  validArea(area);
  let subtotal = new D(config.minimumFee);
  let from = config.includedArea;
  const breakdown: BreakdownRow[] = [];
  for (const tier of config.revisedTiers) {
    if (area <= from) break;
    const to = Math.min(area, tier.upTo ?? area);
    const covered = new D(to).minus(from);
    const amount = covered.times(tier.rate);
    subtotal = subtotal.plus(amount);
    breakdown.push({ from, to, area: covered.toNumber(), rate: tier.rate, amount: amount.toNumber() });
    from = to;
  }
  return { subtotal, breakdown };
}

export type FeeResult = {
  area: number; baseFee: number; averageRate: number; additionalFee: number; totalFee: number;
  coefficient: number; subtotal: number; adjustedAmount: number; minimumApplied: boolean;
  breakdown: BreakdownRow[];
};
export function calculateRevisedFee(area: number, typeId = 'retail', additionalFee = 0, config = pricing): FeeResult {
  validAdditional(additionalFee);
  const coefficient = projectType(typeId, config).coefficient;
  const { subtotal, breakdown } = progressive(area, config);
  const adjusted = subtotal.times(coefficient);
  const baseFee = safeMoney(D.max(config.minimumFee, adjusted));
  const totalFee = safeMoney(new D(baseFee).plus(additionalFee));
  return {
    area, baseFee, averageRate: averageRate(baseFee, area), additionalFee, totalFee,
    coefficient, subtotal: subtotal.toNumber(), adjustedAmount: adjusted.toNumber(),
    minimumApplied: adjusted.lt(config.minimumFee), breakdown,
  };
}

/** Main 26-band model: fixed fee in the first band; no global minimum on rate bands.
 * No extrapolation, smoothing, or revised-tier logic is used here.
 */
export function calculateCurrentFee(area: number, typeId = 'retail', additionalFee = 0, config = pricing) {
  validArea(area);
  validAdditional(additionalFee);
  const coefficient = projectType(typeId, config).coefficient;
  const band = config.currentBands.find(band => area <= band.upTo);
  if (!band) return null;
  const subtotal = band.fixedFee !== undefined ? new D(band.fixedFee) : new D(area).times(band.rate);
  const raw = band.fixedFee !== undefined ? subtotal : subtotal.times(coefficient);
  const baseFee = safeMoney(raw);
  return { area, baseFee, totalFee: safeMoney(new D(baseFee).plus(additionalFee)), additionalFee,
    averageRate: averageRate(baseFee, area), band, coefficient,
    subtotal: subtotal.toNumber(), adjustedAmount: raw.toNumber(), minimumApplied: false,
    breakdown: band.rate === undefined ? [] : [{ from: 0, to: area, area, rate: band.rate, amount: subtotal.toNumber() }] };
}

export function simulationCount(area: number, config = pricing) {
  validArea(area);
  return new D(area).div(config.simulationStep).ceil().toNumber();
}
// Pages keep very large valid areas responsive. Copy/export can iterate all rows.
export function* simulationRows(area: number, typeId = 'retail', start = 0, limit = Infinity, config = pricing): Generator<FeeResult> {
  const count = simulationCount(area, config);
  if (area > config.currentBands.at(-1)!.upTo) throw new RangeError('Area rate is undefined');
  if (!Number.isSafeInteger(start) || start < 0 || limit <= 0 || (limit !== Infinity && !Number.isSafeInteger(limit))) throw new RangeError('Invalid page');
  for (let index = start; index < Math.min(count, start + limit); index++) {
    const rowArea = new D(area).minus(new D(index).times(config.simulationStep)).toNumber();
    yield calculateCurrentFee(rowArea, typeId, 0, config)!;
  }
}

export type ParsedInput = { value: number; error?: never } | { value?: never; error: 'required' | 'invalid' | 'positive' | 'whole' | 'range' };
export function parseInput(raw: string, kind: 'area' | 'additional'): ParsedInput {
  const normalized = raw.normalize('NFKC').trim();
  if (!normalized) return kind === 'additional' ? { value: 0 } : { error: 'required' };
  // Accept proper thousands separators, decimals and full-width digits, but not partial parses.
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return { error: 'invalid' };
  const decimal = new D(normalized.replaceAll(',', ''));
  if (decimal.abs().gt(MAX)) return { error: 'range' };
  if (kind === 'area' ? decimal.lte(0) : decimal.lt(0)) return { error: 'positive' };
  if (kind === 'additional' && !decimal.isInteger()) return { error: 'whole' };
  const value = decimal.toNumber();
  if (kind === 'area' && (value === 0 || !new D(value).eq(decimal))) return { error: 'range' };
  return { value };
}

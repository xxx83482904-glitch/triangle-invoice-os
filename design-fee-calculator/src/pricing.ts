/** The single source of truth for fees. Bounds are inclusive; null means unbounded.
 * Source: the-triangle-brain/wiki/projects/THE_TRIANGLE_Branding/
 * THE_TRIANGLE_2026デザイン料金表.md (read-only). Revised proposal: user specification.
 * Never substitute effective average rates for marginal rates.
 */
export type Language = 'ja' | 'zh';
export type CurrentBand = { upTo: number; fixedFee: number; rate?: never }
  | { upTo: number; rate: number; fixedFee?: never };
export type PricingConfig = {
  version: string;
  currency: string;
  minimumFee: number;
  includedArea: number;
  revisedTiers: readonly { upTo: number | null; rate: number }[];
  currentBands: readonly CurrentBand[];
  projectTypes: readonly { id: string; coefficient: number; label: Record<Language, string> }[];
  simulationStep: number;
};

export const pricing: PricingConfig = {
  version: '2026',
  currency: 'RMB',
  minimumFee: 240_000,
  includedArea: 150,
  revisedTiers: [
    { upTo: 1_500, rate: 700 },
    { upTo: 3_000, rate: 660 },
    { upTo: 5_000, rate: 620 },
    { upTo: null, rate: 560 },
  ],
  currentBands: [
    { upTo: 150, fixedFee: 240_000 },
    { upTo: 170, rate: 1_494 },
    { upTo: 210, rate: 1_344 },
    { upTo: 250, rate: 1_206 },
    { upTo: 300, rate: 1_086 },
    { upTo: 360, rate: 1_032 },
    { upTo: 430, rate: 984 },
    { upTo: 520, rate: 930 },
    { upTo: 620, rate: 888 },
    { upTo: 740, rate: 840 },
    { upTo: 900, rate: 822 },
    { upTo: 1_100, rate: 810 },
    { upTo: 1_300, rate: 792 },
    { upTo: 1_500, rate: 774 },
    { upTo: 1_800, rate: 762 },
    { upTo: 2_200, rate: 744 },
    { upTo: 2_700, rate: 732 },
    { upTo: 3_200, rate: 714 },
    { upTo: 3_800, rate: 702 },
    { upTo: 4_600, rate: 690 },
    { upTo: 5_500, rate: 672 },
    { upTo: 6_600, rate: 660 },
    { upTo: 7_900, rate: 648 },
    { upTo: 9_500, rate: 636 },
    { upTo: 11_400, rate: 624 },
    { upTo: 13_700, rate: 606 },
  ],
  projectTypes: [
    { id: 'retail', coefficient: 1, label: { ja: '商業・リテール', zh: '商业・零售' } },
    { id: 'residential', coefficient: 1.07, label: { ja: '飲食・個人住宅', zh: '餐饮・私人住宅' } },
    { id: 'hotel', coefficient: 0.96, label: { ja: 'ホテル・民宿', zh: '酒店・民宿' } },
    { id: 'office', coefficient: 0.87, label: { ja: 'オフィス', zh: '办公空间' } },
  ],
  simulationStep: 500,
};

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
import { calculateCurrentFee } from '../src/calculator';
import { createQuotation, quotationTotals } from '../src/quotation';

describe('Main calculator and quotation', () => {
  it('renders the 26-band model and 6,300 × 660 result on first load', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('4,158,000');
    expect(html).toContain('660 RMB/㎡ × 6,300㎡ × 1.00');
    expect(html).toContain('現行26区分');
    expect(html).toContain('2026.10.14.4');
    expect(html).not.toContain('最低料金＋段階加算方式');
  });
  it('passes the current fee and extras to the editable quotation', () => {
    const quote = createQuotation('Test', calculateCurrentFee(6300, 'retail', 20000)!);
    expect(quotationTotals(quote)).toMatchObject({ base: 4158000, additional: 20000, total: 4178000, average: 660 });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/export';

afterEach(() => vi.unstubAllGlobals());

function fakeDocument(success: boolean, throws = false) {
  const field = { value: '', style: { cssText: '' }, setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
  const focus = vi.fn();
  const exec = vi.fn(() => { if (throws) throw new Error('Copy unavailable'); return success; });
  vi.stubGlobal('document', { activeElement: { focus }, createElement: vi.fn(() => field), body: { append: vi.fn() }, execCommand: exec });
  return { field, focus, exec };
}

describe('Clipboard fallback for HTTPS and HTTP NAS', () => {
  it('uses the secure clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('设计费总额：4,143,000 RMB')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('设计费总额：4,143,000 RMB');
  });
  it('falls back when permission is denied, restoring focus and removing temporary fields', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    const { field, focus, exec } = fakeDocument(true);
    expect(await copyText('test')).toBe(true);
    expect(field.value).toBe('test');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(field.remove).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
  it('supports HTTP without navigator.clipboard', async () => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('navigator', {});
    fakeDocument(true);
    expect(await copyText('test')).toBe(true);
  });
  it.each([false, true])('requests visible manual-copy fallback if legacy copy fails (throws: %s)', async throws => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('navigator', {});
    const { field, focus } = fakeDocument(false, throws);
    expect(await copyText('test')).toBe(false);
    expect(field.remove).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect } from 'vitest';
import { toSubunit, formatCurrency, INSTITUTION_TYPE_LABELS, FEE_TYPE_LABELS } from './index';

describe('i18n utilities', () => {
  it('toSubunit converts major currency to kobo integers', () => {
    expect(toSubunit(100, 'NGN')).toBe(10000);
    expect(toSubunit(100.5, 'NGN')).toBe(10050);
    expect(toSubunit(50, 'GHS')).toBe(5000);
  });

  it('formatCurrency formats kobo correctly', () => {
    // 10000 kobo = 100 NGN
    const formatted = formatCurrency(10000, 'NGN', 'en-NG');
    expect(formatted).toContain('100');
  });

  it('contains labels for primary school', () => {
    expect(INSTITUTION_TYPE_LABELS.primary_school['en-NG']).toBe('Primary School');
    expect(INSTITUTION_TYPE_LABELS.primary_school['yo-NG']).toBe('Ile-iwe Alakobere');
  });

  it('contains labels for tuition fee', () => {
    expect(FEE_TYPE_LABELS.tuition['en-NG']).toBe('Tuition Fee');
    expect(FEE_TYPE_LABELS.tuition['yo-NG']).toBe('Owo Ile-iwe');
  });
});

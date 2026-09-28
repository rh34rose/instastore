import { describe, expect, it } from 'vitest';
import { generateOtp, parseOtp } from '../src/otp';

describe('generateOtp', () => {
  it('makes six-digit codes, keeping leading zeros', () => {
    const codes = Array.from({ length: 500 }, generateOtp);
    for (const code of codes) expect(code).toMatch(/^[0-9]{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(490);
  });
});

describe('parseOtp', () => {
  it('accepts codes the way people type them', () => {
    expect(parseOtp('042917')).toBe('042917');
    expect(parseOtp(' 042 917 ')).toBe('042917');
    expect(parseOtp('042-917')).toBe('042917');
    expect(parseOtp('０４２９１７')).toBe('042917'); // full-width digits from a phone keyboard
  });

  it('rejects anything that is not a whole code', () => {
    expect(parseOtp('')).toBeNull();
    expect(parseOtp('04291')).toBeNull();
    expect(parseOtp('0429170')).toBeNull();
    expect(parseOtp('04291a')).toBeNull();
  });
});

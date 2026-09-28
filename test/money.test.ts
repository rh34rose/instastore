import { describe, expect, it } from 'vitest';
import { currencyFractionDigits, formatMoney, parseMoney, toMajorString } from '../src/money';

describe('money', () => {
  it('knows how many decimals a currency uses', () => {
    expect(currencyFractionDigits('INR')).toBe(2);
    expect(currencyFractionDigits('USD')).toBe(2);
    expect(currencyFractionDigits('JPY')).toBe(0);
    expect(currencyFractionDigits('not-a-currency')).toBe(2);
  });

  it('formats minor units with the locale', () => {
    expect(formatMoney(123456, 'INR', 'en-IN')).toBe('₹1,234.56');
    expect(formatMoney(123456, 'USD', 'en-US')).toBe('$1,234.56');
    expect(formatMoney(1500, 'JPY', 'ja-JP')).toBe('￥1,500');
    expect(formatMoney(0, 'INR', 'en-IN')).toBe('₹0.00');
  });

  it('parses typed amounts into minor units', () => {
    expect(parseMoney('1234.56', 'INR')).toBe(123456);
    expect(parseMoney('1,234.5', 'INR')).toBe(123450);
    expect(parseMoney('99', 'USD')).toBe(9900);
    expect(parseMoney('0', 'USD')).toBe(0);
    expect(parseMoney('1500', 'JPY')).toBe(1500);
    expect(parseMoney('12.999', 'INR')).toBe(1299);
  });

  it('rejects things that are not amounts', () => {
    expect(parseMoney('', 'INR')).toBeNull();
    expect(parseMoney('abc', 'INR')).toBeNull();
    expect(parseMoney('-5', 'INR')).toBeNull();
    expect(parseMoney('1.2.3', 'INR')).toBeNull();
  });

  it('round-trips through the form representation', () => {
    expect(toMajorString(123456, 'INR')).toBe('1234.56');
    expect(toMajorString(1500, 'JPY')).toBe('1500');
    expect(parseMoney(toMajorString(4999, 'USD'), 'USD')).toBe(4999);
  });
});

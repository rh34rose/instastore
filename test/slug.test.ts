import { describe, expect, it } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Ghee Roast  Dosa!')).toBe('ghee-roast-dosa');
    expect(slugify('  Cotton T-Shirt (Blue) ')).toBe('cotton-t-shirt-blue');
  });

  it('strips accents', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('falls back when nothing survives', () => {
    expect(slugify('???')).toBe('item');
    expect(slugify('', 'category')).toBe('category');
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugify('a'.repeat(59) + ' b');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

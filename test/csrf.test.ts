import { describe, expect, it } from 'vitest';
import { isCrossSiteRequest } from '../src/csrf';

const post = (headers: Record<string, string>) => new Request('https://shop.example.com/checkout', { method: 'POST', headers });

describe('isCrossSiteRequest', () => {
  it('trusts same-origin and direct navigations', () => {
    expect(isCrossSiteRequest(post({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isCrossSiteRequest(post({ 'sec-fetch-site': 'none' }))).toBe(false);
    expect(isCrossSiteRequest(post({ origin: 'https://shop.example.com' }))).toBe(false);
  });

  it('blocks other sites', () => {
    expect(isCrossSiteRequest(post({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSiteRequest(post({ 'sec-fetch-site': 'same-site' }))).toBe(true);
    expect(isCrossSiteRequest(post({ origin: 'https://evil.example.net' }))).toBe(true);
    expect(isCrossSiteRequest(post({ origin: 'null' }))).toBe(true);
    expect(isCrossSiteRequest(post({ origin: 'garbage' }))).toBe(true);
  });

  it('lets non-browser clients through', () => {
    expect(isCrossSiteRequest(post({}))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isoDateToJalali,
  jalaliToIsoDate,
  normalizeDigits,
  normalizeLoginIdentifier,
  normalizeMobile,
  normalizeNationalId,
  normalizeNumericText,
  normalizeOtp,
} from '../src/lib/input-normalization.js';
import { generateTotp, verifyTotp } from '../server/services/mfa.service.js';

describe('Didar shared input normalization', () => {
  it('normalizes Persian and Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeDigits('12۳٤5')).toBe('12345');
  });

  it('canonicalizes mobile, national ID and OTP without losing leading zero', () => {
    expect(normalizeMobile('۰۹۱۲ ۱۱۱ ۲۲۳۳')).toBe('09121112233');
    expect(normalizeNationalId('۰۰۱۲۳۴۵۶۷۸')).toBe('0012345678');
    expect(normalizeOtp('۱۲۳۴۵۶')).toBe('123456');
  });

  it('normalizes decimal numeric text', () => {
    expect(normalizeNumericText('۱۲٫۵', { decimal: true })).toBe('12.5');
    expect(normalizeNumericText('۱,۲۵', { decimal: true })).toBe('1.25');
  });

  it('preserves email semantics while normalizing login identifiers', () => {
    expect(normalizeLoginIdentifier('  User@Example.COM  ')).toBe('user@example.com');
    expect(normalizeLoginIdentifier('۰۹۱۲۱۱۱۲۲۳۳')).toBe('09121112233');
  });

  it('converts Jalali display dates to canonical Gregorian ISO and back', () => {
    expect(jalaliToIsoDate('۱۴۰۵/۰۷/۱۰')).toBe('2026-10-02');
    expect(isoDateToJalali('2026-10-02')).toBe('1405/07/10');
  });
});

describe('TOTP compatibility', () => {
  it('matches the RFC 6238 SHA1 vector when truncated to 6 digits', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII 12345678901234567890
    expect(generateTotp(secret, 59_000)).toBe('287082');
    expect(verifyTotp(secret, '۲۸۷۰۸۲', 59_000)).toBe(true);
  });
});

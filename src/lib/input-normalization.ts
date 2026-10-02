/**
 * Didar shared input normalization.
 * Canonical storage uses ASCII digits and ISO Gregorian dates.
 * Passwords and opaque identifiers MUST NOT pass through these helpers.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(value: string): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
}

export function normalizeNumericText(value: string, options?: { decimal?: boolean; signed?: boolean }): string {
  let result = normalizeDigits(value).trim();
  result = result.replace(/[٫٬,]/g, (m) => (m === '٫' || m === ',' ? '.' : ''));
  const allowed = options?.decimal ? /[^0-9.\-]/g : /[^0-9\-]/g;
  result = result.replace(allowed, '');
  if (!options?.signed) result = result.replace(/-/g, '');
  if (options?.decimal) {
    const firstDot = result.indexOf('.');
    if (firstDot >= 0) {
      result = result.slice(0, firstDot + 1) + result.slice(firstDot + 1).replace(/\./g, '');
    }
  }
  return result;
}

export function normalizeIdentifierDigits(value: string): string {
  return normalizeDigits(value).replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

export function normalizeMobile(value: string): string {
  return normalizeIdentifierDigits(value);
}

export function normalizeNationalId(value: string): string {
  return normalizeIdentifierDigits(value);
}

export function normalizeOtp(value: string): string {
  return normalizeIdentifierDigits(value).slice(0, 6);
}

export function normalizeLoginIdentifier(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const digitNormalized = normalizeDigits(trimmed);
  if (/^[0-9\s()+-]+$/.test(digitNormalized)) {
    return digitNormalized.replace(/\s+/g, '').replace(/[()-]/g, '');
  }
  return digitNormalized;
}

// ---- Jalali / Gregorian conversion (integer-only, dependency-free) ----
function div(a: number, b: number) { return ~~(a / b); }
function mod(a: number, b: number) { return a - ~~(a / b) * b; }

function jalCal(jy: number) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm = 0;
  let jump = 0;
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Jalali year out of range');
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number) {
  const g = d2g(jdn);
  let jy = g.gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(g.gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function jalaliToIsoDate(input: string): string | null {
  const raw = normalizeDigits(input).trim().replace(/[-.]/g, '/');
  const match = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31 || (jm > 6 && jd > 30)) return null;
  try {
    const { gy, gm, gd } = d2g(j2d(jy, jm, jd));
    return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export function isoDateToJalali(iso: string): string {
  const match = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const { jy, jm, jd } = d2j(g2d(Number(match[1]), Number(match[2]), Number(match[3])));
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

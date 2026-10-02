import crypto from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { authRecoveryCodes, authTotpFactors } from '../db/schema.js';
import { normalizeOtp } from '../../src/lib/input-normalization.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) throw new Error('INVALID_TOTP_SECRET');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function encryptionKey(): Buffer {
  const material = process.env.MFA_ENCRYPTION_KEY;
  if (!material || material.length < 24) {
    throw new Error('MFA_ENCRYPTION_KEY_NOT_CONFIGURED');
  }
  return crypto.createHash('sha256').update(material, 'utf8').digest();
}

function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secretCiphertext: ciphertext.toString('base64url'),
    secretIv: iv.toString('base64url'),
    secretAuthTag: tag.toString('base64url'),
  };
}

function decryptSecret(row: { secretCiphertext: string; secretIv: string; secretAuthTag: string }): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(row.secretIv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(row.secretAuthTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.secretCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function generateTotp(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, rawCode: string, atMs = Date.now()): boolean {
  const code = normalizeOtp(rawCode);
  if (!/^\d{6}$/.test(code)) return false;
  for (const offset of [-1, 0, 1]) {
    if (generateTotp(secret, atMs + offset * 30_000) === code) return true;
  }
  return false;
}

function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `DG-${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export class MfaService {
  static async getStatus(partyId: string) {
    const db = (await getDatabase()) as any;
    const rows = await db.select().from(authTotpFactors).where(eq(authTotpFactors.partyId, partyId));
    const factor = rows[0];
    return {
      totpEnabled: factor?.status === 'active',
      totpPending: factor?.status === 'pending',
      confirmedAt: factor?.confirmedAt || null,
    };
  }

  static async beginTotpEnrollment(partyId: string, accountLabel: string) {
    const db = (await getDatabase()) as any;
    const secret = base32Encode(crypto.randomBytes(20));
    const encrypted = encryptSecret(secret);
    await db
      .insert(authTotpFactors)
      .values({
        partyId,
        ...encrypted,
        status: 'pending',
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: authTotpFactors.partyId,
        set: {
          ...encrypted,
          status: 'pending',
          confirmedAt: null,
          updatedAt: new Date(),
        },
      });

    const issuer = encodeURIComponent('Didar Gold');
    const account = encodeURIComponent(accountLabel || partyId);
    const otpauthUri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUri };
  }

  static async confirmTotpEnrollment(partyId: string, rawCode: string) {
    const db = (await getDatabase()) as any;
    const rows = await db.select().from(authTotpFactors).where(eq(authTotpFactors.partyId, partyId));
    const factor = rows[0];
    if (!factor || factor.status !== 'pending') throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    const secret = decryptSecret(factor);
    if (!verifyTotp(secret, rawCode)) throw new Error('INVALID_TOTP');

    const recoveryCodes = createRecoveryCodes();
    await db.transaction(async (tx: any) => {
      await tx
        .update(authTotpFactors)
        .set({ status: 'active', confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(authTotpFactors.partyId, partyId));
      await tx.delete(authRecoveryCodes).where(eq(authRecoveryCodes.partyId, partyId));
      for (const code of recoveryCodes) {
        await tx.insert(authRecoveryCodes).values({
          id: `rc_${crypto.randomUUID()}`,
          partyId,
          codeHash: hashRecoveryCode(code),
          createdAt: new Date(),
        });
      }
    });

    return { enabled: true, recoveryCodes };
  }

  static async isTotpEnabled(partyId: string): Promise<boolean> {
    const status = await this.getStatus(partyId);
    return status.totpEnabled;
  }

  static async verifyLoginFactor(partyId: string, rawTotp?: string, rawRecoveryCode?: string): Promise<void> {
    const db = (await getDatabase()) as any;
    const rows = await db.select().from(authTotpFactors).where(
      and(eq(authTotpFactors.partyId, partyId), eq(authTotpFactors.status, 'active'))
    );
    const factor = rows[0];
    if (!factor) return;

    if (!rawTotp && !rawRecoveryCode) throw new Error('MFA_REQUIRED');

    if (rawTotp) {
      const secret = decryptSecret(factor);
      if (!verifyTotp(secret, rawTotp)) throw new Error('INVALID_TOTP');
      return;
    }

    const codeHash = hashRecoveryCode(rawRecoveryCode || '');
    const recovery = await db.select().from(authRecoveryCodes).where(
      and(
        eq(authRecoveryCodes.partyId, partyId),
        eq(authRecoveryCodes.codeHash, codeHash),
        isNull(authRecoveryCodes.usedAt)
      )
    );
    if (!recovery[0]) throw new Error('INVALID_RECOVERY_CODE');
    await db.update(authRecoveryCodes).set({ usedAt: new Date() }).where(eq(authRecoveryCodes.id, recovery[0].id));
  }

  static async disableTotp(partyId: string, rawCode: string) {
    const db = (await getDatabase()) as any;
    const rows = await db.select().from(authTotpFactors).where(eq(authTotpFactors.partyId, partyId));
    const factor = rows[0];
    if (!factor || factor.status !== 'active') return { disabled: true };
    const secret = decryptSecret(factor);
    if (!verifyTotp(secret, rawCode)) throw new Error('INVALID_TOTP');
    await db.transaction(async (tx: any) => {
      await tx.update(authTotpFactors).set({ status: 'disabled', updatedAt: new Date() }).where(eq(authTotpFactors.partyId, partyId));
      await tx.delete(authRecoveryCodes).where(eq(authRecoveryCodes.partyId, partyId));
    });
    return { disabled: true };
  }
}

import crypto from 'crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import {
  authExternalIdentities,
  authOauthStates,
  authOauthTickets,
  k01Persons,
} from '../db/schema.js';

export type ExternalProvider = 'google' | 'apple';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function safeReturnUrl(candidate?: string): string {
  const fallback = process.env.APP_URL || 'http://localhost:3000/';
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    const allowed = new Set(
      [process.env.APP_URL, ...(process.env.CORS_ALLOWED_ORIGIN || '').split(',')]
        .filter(Boolean)
        .map((v) => new URL(String(v)).origin)
    );
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
    if (!allowed.has(parsed.origin)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function providerEnabled(provider: ExternalProvider): boolean {
  if (provider === 'google') return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
  return Boolean(
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY &&
    process.env.APPLE_REDIRECT_URI
  );
}

function makeAppleClientSecret(): string {
  const clientId = process.env.APPLE_CLIENT_ID!;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APPLE_KEY_ID! }));
  const payload = b64url(JSON.stringify({
    iss: process.env.APPLE_TEAM_ID!,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  }));
  const signingInput = `${header}.${payload}`;
  const key = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n');
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function verifyAppleIdToken(idToken: string) {
  const [headerPart, payloadPart, signaturePart] = idToken.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('APPLE_ID_TOKEN_INVALID');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  const jwksRes = await fetch('https://appleid.apple.com/auth/keys');
  if (!jwksRes.ok) throw new Error('APPLE_JWKS_UNAVAILABLE');
  const jwks: any = await jwksRes.json();
  const jwk = jwks.keys?.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error('APPLE_SIGNING_KEY_NOT_FOUND');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signaturePart, 'base64url')
  );
  if (!ok) throw new Error('APPLE_ID_TOKEN_SIGNATURE_INVALID');
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== 'https://appleid.apple.com' || payload.aud !== process.env.APPLE_CLIENT_ID || Number(payload.exp) <= now) {
    throw new Error('APPLE_ID_TOKEN_CLAIMS_INVALID');
  }
  return payload;
}

export class OAuthService {
  static providerStatus() {
    return {
      google: providerEnabled('google'),
      apple: providerEnabled('apple'),
    };
  }

  static async begin(provider: ExternalProvider, returnUrl?: string) {
    if (!providerEnabled(provider)) throw new Error('OAUTH_PROVIDER_NOT_CONFIGURED');
    const db = (await getDatabase()) as any;
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await db.insert(authOauthStates).values({
      id: `oauth_state_${crypto.randomUUID()}`,
      stateHash: sha256(state),
      provider,
      codeVerifier: verifier,
      returnUrl: safeReturnUrl(returnUrl),
      expiresAt: new Date(Date.now() + 10 * 60_000),
      createdAt: new Date(),
    });

    if (provider === 'google') {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
      url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI!);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    }

    const url = new URL('https://appleid.apple.com/auth/authorize');
    url.searchParams.set('client_id', process.env.APPLE_CLIENT_ID!);
    url.searchParams.set('redirect_uri', process.env.APPLE_REDIRECT_URI!);
    url.searchParams.set('response_type', 'code id_token');
    url.searchParams.set('response_mode', 'form_post');
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('state', state);
    return url.toString();
  }

  private static async consumeState(provider: ExternalProvider, state: string) {
    const db = (await getDatabase()) as any;
    const rows = await db.select().from(authOauthStates).where(
      and(
        eq(authOauthStates.stateHash, sha256(state)),
        eq(authOauthStates.provider, provider),
        gt(authOauthStates.expiresAt, new Date()),
        isNull(authOauthStates.consumedAt)
      )
    );
    const row = rows[0];
    if (!row) throw new Error('OAUTH_STATE_INVALID_OR_EXPIRED');
    await db.update(authOauthStates).set({ consumedAt: new Date() }).where(eq(authOauthStates.id, row.id));
    return row;
  }

  private static async resolveParty(provider: ExternalProvider, subject: string, email?: string, emailVerified = false) {
    const db = (await getDatabase()) as any;
    const linked = await db.select().from(authExternalIdentities).where(
      and(eq(authExternalIdentities.provider, provider), eq(authExternalIdentities.providerSubject, subject))
    );
    if (linked[0]) {
      await db.update(authExternalIdentities).set({ lastLoginAt: new Date() }).where(eq(authExternalIdentities.id, linked[0].id));
      return linked[0].partyId;
    }

    if (!email || !emailVerified) throw new Error('EXTERNAL_ACCOUNT_NOT_LINKED');
    const people = await db.select().from(k01Persons).where(sql`lower(${k01Persons.email}) = ${email.toLowerCase()}`);
    if (people.length !== 1 || people[0].status !== 'active') throw new Error('EXTERNAL_ACCOUNT_NOT_LINKED');

    await db.insert(authExternalIdentities).values({
      id: `ext_${provider}_${crypto.randomUUID()}`,
      partyId: people[0].id,
      provider,
      providerSubject: subject,
      email: email.toLowerCase(),
      emailVerified: true,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });
    return people[0].id;
  }

  private static async issueTicket(partyId: string, provider: ExternalProvider) {
    const db = (await getDatabase()) as any;
    const rawTicket = crypto.randomBytes(32).toString('base64url');
    await db.insert(authOauthTickets).values({
      id: `oauth_ticket_${crypto.randomUUID()}`,
      ticketHash: sha256(rawTicket),
      partyId,
      provider,
      expiresAt: new Date(Date.now() + 3 * 60_000),
      createdAt: new Date(),
    });
    return rawTicket;
  }

  static async callback(provider: ExternalProvider, params: { code: string; state: string; idToken?: string }) {
    if (!providerEnabled(provider)) throw new Error('OAUTH_PROVIDER_NOT_CONFIGURED');
    const stateRow = await this.consumeState(provider, params.state);

    let subject = '';
    let email: string | undefined;
    let emailVerified = false;

    if (provider === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          code: params.code,
          grant_type: 'authorization_code',
          redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
          code_verifier: stateRow.codeVerifier,
        }),
      });
      if (!tokenRes.ok) throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
      const token: any = await tokenRes.json();
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!infoRes.ok) throw new Error('GOOGLE_USERINFO_FAILED');
      const info: any = await infoRes.json();
      subject = info.sub;
      email = info.email;
      emailVerified = Boolean(info.email_verified);
    } else {
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.APPLE_CLIENT_ID!,
          client_secret: makeAppleClientSecret(),
          code: params.code,
          grant_type: 'authorization_code',
          redirect_uri: process.env.APPLE_REDIRECT_URI!,
        }),
      });
      if (!tokenRes.ok) throw new Error('APPLE_TOKEN_EXCHANGE_FAILED');
      const token: any = await tokenRes.json();
      const payload: any = await verifyAppleIdToken(token.id_token || params.idToken || '');
      subject = payload.sub;
      email = payload.email;
      emailVerified = Boolean(payload.email_verified === true || payload.email_verified === 'true');
    }

    if (!subject) throw new Error('EXTERNAL_IDENTITY_INVALID');
    const partyId = await this.resolveParty(provider, subject, email, emailVerified);
    const ticket = await this.issueTicket(partyId, provider);
    const redirect = new URL(stateRow.returnUrl);
    redirect.searchParams.set('oauth_ticket', ticket);
    redirect.searchParams.set('oauth_provider', provider);
    return redirect.toString();
  }

  static async resolveTicket(rawTicket: string) {
    const db = (await getDatabase()) as any;
    const rows = await db.select().from(authOauthTickets).where(
      and(
        eq(authOauthTickets.ticketHash, sha256(rawTicket)),
        gt(authOauthTickets.expiresAt, new Date()),
        isNull(authOauthTickets.consumedAt)
      )
    );
    if (!rows[0]) throw new Error('OAUTH_TICKET_INVALID_OR_EXPIRED');
    return rows[0];
  }

  static async consumeTicket(id: string) {
    const db = (await getDatabase()) as any;
    await db.update(authOauthTickets).set({ consumedAt: new Date() }).where(eq(authOauthTickets.id, id));
  }
}

# Input, Date, Social Login & MFA Foundation

Date: 2026-10-02
Status: IMPLEMENTED — CI VERIFIED; owner local runtime verification pending
Branch: `feature/input-date-social-mfa-foundation`

## Scope implemented

- Shared Persian/Arabic-Indic → ASCII digit normalization.
- Canonical mobile, national ID, OTP and decimal helpers.
- Dependency-free Persian/Jalali ↔ Gregorian ISO date conversion.
- Reusable `IdentifierField`, `NumericField`, `PasswordField`, `DidarDateField`.
- K01 Person identity fields use canonical inputs.
- K01 membership validity dates use localized date field and ISO storage.
- Backend K01 repository normalizes identity fields defensively.
- Password fields support show/hide without password normalization.
- TOTP Authenticator MFA with AES-256-GCM encrypted secret and hashed one-time recovery codes.
- Google OAuth/OIDC login using authorization-code flow with PKCE.
- Sign in with Apple authorization-code flow and Apple ID token signature verification.
- External identity mapping is always linked to an existing Didar Party.
- OAuth issues only a short-lived one-time Didar login ticket; normal Didar session creation happens after optional TOTP.
- Account Security modal allows TOTP enrollment, confirmation and controlled disable.
- Social provider buttons are disabled until deployment credentials are configured.

## Persistence added

Migration: `server/db/migrations/0004_auth_identity_mfa.sql`

Tables:

- `auth_external_identities`
- `auth_oauth_states`
- `auth_oauth_tickets`
- `auth_totp_factors`
- `auth_recovery_codes`

## Security boundaries

- No provider-supplied role/organization is trusted.
- No password normalization.
- OTP secret is not logged.
- Development SMS OTP debug return is opt-in only through `ALLOW_DEV_OTP_DEBUG=true`.
- TOTP enrollment requires `MFA_ENCRYPTION_KEY`.
- Google/Apple require explicit server-side environment credentials.
- External account auto-linking requires exactly one active Didar Party with the same verified email.

## Verification

Automated test file added:

`tests/input-auth-foundation.test.ts`

Covers:
- Persian/Arabic/ASCII digit equivalence.
- Leading-zero identity preservation.
- Decimal canonicalization.
- Login identifier normalization.
- Jalali/Gregorian round trip.
- RFC 6238 compatible TOTP generation and Persian-digit verification.

GitHub Actions verification run:

`Verify Input Auth Foundation / run #2`

Results:
- Dependency install: PASS
- TypeScript / `npm run lint`: PASS
- Foundation tests: PASS (6/6)
- Full suite: PASS (47/47 = 17 persistence + 24 P01 + 6 foundation)
- Production build: PASS
- Migration `0004_auth_identity_mfa.sql`: applied successfully in isolated test databases
- P01 regression suite: PASS (24/24)

The first CI run exposed the pre-existing unsafe RBAC bootstrap dependency on local JSON files. That root cause was corrected by adding source-controlled canonical RBAC catalog seeding and isolating `importRbacData()` from legacy K01 identity import. The second CI run is fully green.

Remaining acceptance before merge:
- owner-local macOS runtime smoke test
- visual verification of password eye and Jalali date controls
- TOTP enrollment/login smoke test with a real authenticator app
- Google/Apple live login only after valid provider credentials are configured


/**
 * Didar administrator identity repair.
 *
 * Dry-run by default. No destructive action occurs without --apply.
 *
 * Example:
 * npm run repair:admin-identity -- \
 *   --survivor party-admin-1790956751077 \
 *   --duplicate party-admin-001
 *
 * Apply only after reviewing the dry-run:
 * npm run repair:admin-identity -- \
 *   --survivor party-admin-1790956751077 \
 *   --duplicate party-admin-001 \
 *   --apply
 */

import 'dotenv/config';
import crypto from 'crypto';
import { and, eq, or } from 'drizzle-orm';
import { getDatabase, closeDatabase } from '../server/db/index.js';
import {
  k01Persons,
  k01Memberships,
  k01Documents,
  k01AuditLogs,
  rbacAssignments,
  authCredentials,
  authSessions,
  authOtpCodes,
  authExternalIdentities,
  authOauthStates,
  authOauthTickets,
  authTotpFactors,
  authRecoveryCodes,
} from '../server/db/schema.js';
import { normalizeMobile } from '../src/lib/input-normalization.js';

function parseArgs(): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs();
  const survivorId = String(args.survivor || '');
  const duplicateId = String(args.duplicate || '');
  const apply = args.apply === true;

  if (!survivorId || !duplicateId || survivorId === duplicateId) {
    throw new Error('Specify distinct --survivor <party-id> and --duplicate <party-id>.');
  }

  const db = (await getDatabase()) as any;

  const [survivor] = await db.select().from(k01Persons).where(eq(k01Persons.id, survivorId));
  const [duplicate] = await db.select().from(k01Persons).where(eq(k01Persons.id, duplicateId));

  if (!survivor) throw new Error(`SURVIVOR_NOT_FOUND: ${survivorId}`);
  if (!duplicate) throw new Error(`DUPLICATE_NOT_FOUND: ${duplicateId}`);

  const survivorMobile = normalizeMobile(survivor.mobile);
  const duplicateMobile = normalizeMobile(duplicate.mobile);

  const survivorCreds = await db.select().from(authCredentials).where(eq(authCredentials.partyId, survivorId));
  const duplicateCreds = await db.select().from(authCredentials).where(eq(authCredentials.partyId, duplicateId));
  const survivorMemberships = await db.select().from(k01Memberships).where(eq(k01Memberships.partyId, survivorId));
  const duplicateMemberships = await db.select().from(k01Memberships).where(eq(k01Memberships.partyId, duplicateId));
  const survivorAssignments = await db.select().from(rbacAssignments).where(eq(rbacAssignments.partyId, survivorId));
  const duplicateAssignments = await db.select().from(rbacAssignments).where(eq(rbacAssignments.partyId, duplicateId));
  const duplicateSessions = await db.select().from(authSessions).where(eq(authSessions.partyId, duplicateId));
  const duplicateExternal = await db.select().from(authExternalIdentities).where(eq(authExternalIdentities.partyId, duplicateId));
  const duplicateOauthStates = await db.select().from(authOauthStates).where(eq(authOauthStates.partyId, duplicateId));
  const duplicateOauthTickets = await db.select().from(authOauthTickets).where(eq(authOauthTickets.partyId, duplicateId));
  const duplicateTotp = await db.select().from(authTotpFactors).where(eq(authTotpFactors.partyId, duplicateId));
  const duplicateRecovery = await db.select().from(authRecoveryCodes).where(eq(authRecoveryCodes.partyId, duplicateId));
  const duplicateDocs = await db.select().from(k01Documents).where(eq(k01Documents.targetId, duplicateId));
  const relatedOtps = await db.select().from(authOtpCodes).where(
    or(eq(authOtpCodes.mobile, survivor.mobile), eq(authOtpCodes.mobile, duplicate.mobile))
  );

  const blockers: string[] = [];
  if (survivorMobile !== duplicateMobile) blockers.push('The two records do not normalize to the same mobile.');
  if (survivor.status !== 'active') blockers.push('Survivor person is not active.');
  if (survivorCreds.length !== 1 || survivorCreds[0].status !== 'active') {
    blockers.push('Survivor does not have exactly one active credential.');
  }
  if (duplicateCreds.length !== 0) blockers.push('Duplicate has credentials; automatic repair is unsafe.');
  if (duplicateExternal.length > 0) blockers.push('Duplicate has external identities; manual identity disposition required.');
  if (duplicateOauthStates.length > 0 || duplicateOauthTickets.length > 0) blockers.push('Duplicate has OAuth state/ticket history; manual review required.');
  if (duplicateTotp.length > 0 || duplicateRecovery.length > 0) blockers.push('Duplicate has MFA/recovery factors; manual review required.');
  if (duplicateDocs.length > 0) blockers.push('Duplicate has attached documents; manual document ownership review required.');

  const plan = {
    mode: apply ? 'APPLY_REQUESTED' : 'DRY_RUN',
    survivor: {
      id: survivor.id,
      name: `${survivor.firstName} ${survivor.lastName}`,
      mobileStored: survivor.mobile,
      mobileCanonical: survivorMobile,
      credentialStatus: survivorCreds[0]?.status || null,
      memberships: survivorMemberships.map((m: any) => ({ id: m.id, organizationId: m.organizationId, roleKey: m.roleKey, status: m.status })),
      assignments: survivorAssignments.map((a: any) => ({ id: a.id, membershipId: a.membershipId, organizationId: a.organizationId, roleKey: a.roleKey, scopeType: a.scopeType, scopeIds: a.scopeIds, status: a.status })),
    },
    duplicate: {
      id: duplicate.id,
      name: `${duplicate.firstName} ${duplicate.lastName}`,
      mobileStored: duplicate.mobile,
      mobileCanonical: duplicateMobile,
      credentialCount: duplicateCreds.length,
      memberships: duplicateMemberships.map((m: any) => ({ id: m.id, organizationId: m.organizationId, roleKey: m.roleKey, status: m.status })),
      assignments: duplicateAssignments.map((a: any) => ({ id: a.id, membershipId: a.membershipId, organizationId: a.organizationId, roleKey: a.roleKey, scopeType: a.scopeType, scopeIds: a.scopeIds, status: a.status })),
      sessionCount: duplicateSessions.length,
      documentCount: duplicateDocs.length,
      externalIdentityCount: duplicateExternal.length,
      oauthStateCount: duplicateOauthStates.length,
      oauthTicketCount: duplicateOauthTickets.length,
      totpCount: duplicateTotp.length,
      recoveryCodeCount: duplicateRecovery.length,
    },
    staleOtpCount: relatedOtps.length,
    blockers,
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!apply) {
    console.log('\nDRY RUN ONLY — no data changed.');
    await closeDatabase();
    return;
  }

  if (blockers.length > 0) {
    throw new Error(`REPAIR_BLOCKED: ${blockers.join(' | ')}`);
  }

  await db.transaction(async (tx: any) => {
    // 1. Resolve duplicate memberships organization-by-organization.
    for (const dupMem of duplicateMemberships) {
      const survivorMem = survivorMemberships.find(
        (m: any) => m.organizationId === dupMem.organizationId
      );

      if (survivorMem) {
        // Repoint or de-duplicate each assignment tied to the duplicate membership.
        const memAssignments = duplicateAssignments.filter((a: any) => a.membershipId === dupMem.id);
        for (const dupAssignment of memAssignments) {
          const sameAssignment = survivorAssignments.find(
            (a: any) =>
              a.organizationId === dupAssignment.organizationId &&
              a.roleKey === dupAssignment.roleKey &&
              a.scopeType === dupAssignment.scopeType &&
              JSON.stringify(a.scopeIds || []) === JSON.stringify(dupAssignment.scopeIds || []) &&
              a.status === dupAssignment.status
          );

          if (sameAssignment) {
            await tx.delete(rbacAssignments).where(eq(rbacAssignments.id, dupAssignment.id));
          } else {
            await tx
              .update(rbacAssignments)
              .set({
                partyId: survivorId,
                membershipId: survivorMem.id,
              })
              .where(eq(rbacAssignments.id, dupAssignment.id));
          }
        }

        await tx.delete(k01Memberships).where(eq(k01Memberships.id, dupMem.id));
      } else {
        await tx
          .update(k01Memberships)
          .set({
            partyId: survivorId,
            partyName: `${survivor.firstName} ${survivor.lastName}`,
            updatedAt: new Date(),
          })
          .where(eq(k01Memberships.id, dupMem.id));

        await tx
          .update(rbacAssignments)
          .set({ partyId: survivorId })
          .where(eq(rbacAssignments.membershipId, dupMem.id));
      }
    }

    // 2. Catch any assignment referencing duplicate party but not handled above.
    const remainingDupAssignments = await tx
      .select()
      .from(rbacAssignments)
      .where(eq(rbacAssignments.partyId, duplicateId));

    for (const dupAssignment of remainingDupAssignments) {
      const targetMembership = await tx
        .select()
        .from(k01Memberships)
        .where(
          and(
            eq(k01Memberships.partyId, survivorId),
            eq(k01Memberships.organizationId, dupAssignment.organizationId)
          )
        );

      if (!targetMembership[0]) {
        throw new Error(`Cannot safely re-home assignment ${dupAssignment.id}; survivor has no membership in ${dupAssignment.organizationId}.`);
      }

      await tx
        .update(rbacAssignments)
        .set({ partyId: survivorId, membershipId: targetMembership[0].id })
        .where(eq(rbacAssignments.id, dupAssignment.id));
    }

    // 3. Revoke and preserve any legacy sessions under the surviving identity.
    if (duplicateSessions.length > 0) {
      await tx
        .update(authSessions)
        .set({ partyId: survivorId, revokedAt: new Date() })
        .where(eq(authSessions.partyId, duplicateId));
    }

    // 4. Invalidate login OTPs associated with either pre-repair mobile representation.
    if (relatedOtps.length > 0) {
      await tx.delete(authOtpCodes).where(
        or(eq(authOtpCodes.mobile, survivor.mobile), eq(authOtpCodes.mobile, duplicate.mobile))
      );
    }

    // 5. Remove the duplicate only after all FK-backed operational references are resolved.
    await tx.delete(k01Persons).where(eq(k01Persons.id, duplicateId));

    // 6. Canonicalize the surviving mobile to ASCII.
    await tx
      .update(k01Persons)
      .set({
        mobile: survivorMobile,
        updatedAt: new Date(),
        version: Number(survivor.version || 1) + 1,
      })
      .where(eq(k01Persons.id, survivorId));

    // 7. Append an explicit repair audit event; historical audit rows are not rewritten.
    await tx.insert(k01AuditLogs).values({
      id: `audit-admin-identity-repair-${crypto.randomUUID()}`,
      actorId: survivorId,
      actorName: `${survivor.firstName} ${survivor.lastName}`,
      action: 'ADMIN_IDENTITY_REPAIRED',
      targetType: 'party',
      targetId: survivorId,
      targetName: `${survivor.firstName} ${survivor.lastName}`,
      description: 'Merged a legacy duplicate administrator identity into the credential-bearing administrator and canonicalized the mobile digits.',
      changes: {
        survivorId,
        duplicateId,
        mobileBefore: survivor.mobile,
        mobileAfter: survivorMobile,
        duplicateMobile: duplicate.mobile,
        duplicateSessionsRevoked: duplicateSessions.length,
        staleOtpCodesRemoved: relatedOtps.length,
      },
      timestamp: new Date(),
    });
  });

  const [finalPerson] = await db.select().from(k01Persons).where(eq(k01Persons.id, survivorId));
  const finalCred = await db.select().from(authCredentials).where(eq(authCredentials.partyId, survivorId));
  const finalAssignments = await db.select().from(rbacAssignments).where(eq(rbacAssignments.partyId, survivorId));
  const duplicateStillExists = await db.select().from(k01Persons).where(eq(k01Persons.id, duplicateId));

  console.log('\nREPAIR APPLIED SUCCESSFULLY');
  console.log(JSON.stringify({
    survivor: {
      id: finalPerson?.id,
      mobile: finalPerson?.mobile,
      status: finalPerson?.status,
      credentialStatus: finalCred[0]?.status || null,
      activeRoles: finalAssignments.filter((a: any) => a.status === 'active').map((a: any) => a.roleKey),
    },
    duplicateExists: duplicateStillExists.length > 0,
  }, null, 2));

  await closeDatabase();
}

main().catch(async (err) => {
  console.error('[Admin Identity Repair Failed]', err instanceof Error ? err.message : String(err));
  await closeDatabase().catch(() => {});
  process.exit(1);
});

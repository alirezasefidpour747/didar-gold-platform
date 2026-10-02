/**
 * Canonical RBAC catalog seed.
 *
 * This is safe for normal startup: it seeds definitions only.
 * It MUST NOT create/import persons, organizations, memberships or role assignments.
 */

import { sql } from 'drizzle-orm';
import { getDatabase } from './index.js';
import {
  rbacGrantAuthorityRules,
  rbacPermissions,
  rbacRolePermissions,
  rbacRoles,
} from './schema.js';
import {
  CANONICAL_PERMISSIONS,
  CANONICAL_ROLES,
  DEFAULT_GRANT_AUTHORITY_RULES,
} from '../../src/data/rbacCatalog.js';

export interface CanonicalRbacSeedResult {
  success: true;
  counts: {
    roles: number;
    permissions: number;
    rolePermissions: number;
    grantAuthorityRules: number;
  };
}

export async function seedCanonicalRbacCatalog(): Promise<CanonicalRbacSeedResult> {
  const db = (await getDatabase()) as any;

  await db.transaction(async (tx: any) => {
    for (const p of CANONICAL_PERMISSIONS) {
      await tx
        .insert(rbacPermissions)
        .values({
          key: p.key,
          domain: p.domain,
          action: p.action,
          resource: p.resource,
          titleFa: p.titleFa,
          titleEn: p.titleEn,
          descriptionFa: p.descriptionFa || '',
          isSensitive: Boolean(p.isSensitive),
          requiresMfa: Boolean(p.requiresMfa),
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: rbacPermissions.key,
          set: {
            domain: p.domain,
            action: p.action,
            resource: p.resource,
            titleFa: p.titleFa,
            titleEn: p.titleEn,
            descriptionFa: p.descriptionFa || '',
            isSensitive: Boolean(p.isSensitive),
            requiresMfa: Boolean(p.requiresMfa),
          },
        });
    }

    for (const role of CANONICAL_ROLES) {
      await tx
        .insert(rbacRoles)
        .values({
          roleKey: role.roleKey,
          analysisCode: role.analysisCode,
          titleFa: role.titleFa,
          titleEn: role.titleEn,
          category: role.category,
          targetEnvironment: role.targetEnvironment,
          mainBoundaryFa: role.mainBoundaryFa || '',
          lifecycle: role.lifecycle || 'active',
          capabilityStatus: role.capabilityStatus || 'verified',
          isCatalogOnly: Boolean(role.isCatalogOnly),
          ownerStatus: role.ownerStatus || 'verified',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: rbacRoles.roleKey,
          set: {
            analysisCode: role.analysisCode,
            titleFa: role.titleFa,
            titleEn: role.titleEn,
            category: role.category,
            targetEnvironment: role.targetEnvironment,
            mainBoundaryFa: role.mainBoundaryFa || '',
            lifecycle: role.lifecycle || 'active',
            capabilityStatus: role.capabilityStatus || 'verified',
            isCatalogOnly: Boolean(role.isCatalogOnly),
            ownerStatus: role.ownerStatus || 'verified',
            updatedAt: new Date(),
          },
        });

      // Default role-permission links are inserted only when absent.
      // Normal startup does not delete or overwrite governed/custom policy links.
      for (const permissionKey of role.defaultPermissions || []) {
        await tx
          .insert(rbacRolePermissions)
          .values({ roleKey: role.roleKey, permissionKey })
          .onConflictDoNothing();
      }
    }

    for (const rule of DEFAULT_GRANT_AUTHORITY_RULES) {
      await tx
        .insert(rbacGrantAuthorityRules)
        .values({
          id: rule.id,
          assignerRoleKey: rule.assignerRoleKey,
          targetOrganizationType: rule.targetOrganizationType || null,
          allowedAssignableRoles: rule.allowedAssignableRoles || [],
          allowedScopeTypes: rule.allowedScopeTypes || [],
          requiresFourEyesApproval: Boolean(rule.requiresFourEyesApproval),
          maxValidityDays: rule.maxValidityDays || null,
        })
        .onConflictDoNothing();
    }
  });

  const count = async (table: any) => {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    return Number(rows[0]?.count || 0);
  };

  return {
    success: true,
    counts: {
      roles: await count(rbacRoles),
      permissions: await count(rbacPermissions),
      rolePermissions: await count(rbacRolePermissions),
      grantAuthorityRules: await count(rbacGrantAuthorityRules),
    },
  };
}

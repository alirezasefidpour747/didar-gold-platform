/**
 * Didar Gold Platform - Authentication & Session Management Router
 * Provides RESTful API endpoints for Login, Initial Admin Provisioning,
 * OTP verification, Session Inspection, WorkContext switching, and Logout.
 */

import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { RbacService } from '../storage-rbac.js';
import { MfaService } from '../services/mfa.service.js';
import { OAuthService, ExternalProvider } from '../services/oauth.service.js';

export const authRouter = Router();

// GET /api/auth/status - Check if initial administrator has been provisioned
authRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const isProvisioned = await AuthService.isAdministratorProvisioned();
    res.json({
      success: true,
      data: {
        isProvisioned,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای بررسی وضعیت پیکربندی مدیر';
    res.status(500).json({ success: false, error: { message } });
  }
});

// POST /api/auth/setup-admin - Explicit initial administrator provisioning
authRouter.post('/setup-admin', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, mobile, nationalId, email, password, organizationName } = req.body;

    const result = await AuthService.provisionInitialAdministrator({
      firstName,
      lastName,
      mobile,
      nationalId,
      email,
      password,
      organizationName,
    });

    res.status(201).json({
      success: true,
      message: 'حساب کاربری مدیر ارشد سامانه با موفقیت راه‌اندازی و فعال گردید.',
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای راه‌اندازی اولیه مدیر ارشد';
    const isConflict = message.includes('ADMIN_ALREADY_PROVISIONED');
    const isValidation = message.includes('الزامی') || message.includes('حداقل');

    res.status(isConflict ? 409 : isValidation ? 400 : 500).json({
      success: false,
      error: {
        code: isConflict ? 'ADMIN_ALREADY_PROVISIONED' : isValidation ? 'VALIDATION_FAILED' : 'SETUP_FAILED',
        message,
      },
    });
  }
});

// POST /api/auth/login - Authenticate with mobile/nationalId and password or OTP
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { identifier, password, otp, totp, recoveryCode, organizationId } = req.body;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

    const result = await AuthService.login({
      identifier,
      password,
      otp,
      totp,
      recoveryCode,
      organizationId,
      userAgent,
      ipAddress,
    });

    res.json({
      success: true,
      message: 'ورود به سامانه با موفقیت انجام شد.',
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای احراز هویت';
    const isInvalidCreds = message.includes('INVALID_CREDENTIALS') || message.includes('INVALID_OTP');
    const isLocked = message.includes('ACCOUNT_LOCKED');
    const isInactive = message.includes('ACCOUNT_INACTIVE');
    const isForbiddenOrg = message.includes('FORBIDDEN_ORG');
    const isMfaRequired = message.includes('MFA_REQUIRED');
    const isInvalidTotp = message.includes('INVALID_TOTP') || message.includes('INVALID_RECOVERY_CODE');

    const status = isMfaRequired ? 428 : isLocked ? 423 : isForbiddenOrg ? 403 : (isInvalidCreds || isInvalidTotp) ? 401 : 400;

    res.status(status).json({
      success: false,
      error: {
        code: isMfaRequired
          ? 'MFA_REQUIRED'
          : isInvalidTotp
          ? 'INVALID_MFA'
          : isLocked
          ? 'ACCOUNT_LOCKED'
          : isForbiddenOrg
          ? 'FORBIDDEN_ORG'
          : isInvalidCreds
          ? 'INVALID_CREDENTIALS'
          : isInactive
          ? 'ACCOUNT_INACTIVE'
          : 'LOGIN_FAILED',
        message,
      },
    });
  }
});

// POST /api/auth/otp/request - Request one-time SMS verification code
authRouter.post('/otp/request', async (req: Request, res: Response) => {
  try {
    const { mobile } = req.body;
    if (!mobile) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'شماره موبایل الزامی است.' },
      });
    }

    const result = await AuthService.requestOtp(mobile);
    res.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای ارسال کد تایید';
    res.status(400).json({ success: false, error: { message } });
  }
});

// POST /api/auth/otp/verify - Verify one-time SMS code and login
authRouter.post('/otp/verify', async (req: Request, res: Response) => {
  try {
    const { mobile, code, organizationId } = req.body;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

    const result = await AuthService.login({
      identifier: mobile,
      otp: code,
      organizationId,
      userAgent,
      ipAddress,
    });

    res.json({
      success: true,
      message: 'ورود با کد یکبارمصرف با موفقیت انجام شد.',
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای اعتبارسنجی کد یکبارمصرف';
    res.status(401).json({ success: false, error: { message } });
  }
});

// GET /api/auth/session (or /api/auth/me) - Retrieve current authenticated session
authRouter.get(['/session', '/me'], authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const workspaces = RbacService.getUserAvailableWorkspaces(user.partyId);

    res.json({
      success: true,
      data: {
        partyId: user.partyId,
        personName: `${user.person.firstName} ${user.person.lastName}`,
        mobile: user.person.mobile,
        email: user.person.email,
        partyType: user.person.partyType,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
        organizationType: user.organizationType,
        isInternalStaff: user.isInternalStaff,
        roleKeys: user.roleKeys,
        permissions: user.permissions,
        memberships: user.memberships,
        sessionId: user.sessionId,
        workspaces,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطا در واکشی مشخصات نشست';
    res.status(500).json({ success: false, error: { message } });
  }
});

// POST /api/auth/switch-organization - Switch active workspace/organization context
authRouter.post('/switch-organization', authenticate, async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'شناسه سازمان الزامی است.' },
      });
    }

    const user = req.user!;
    const result = await AuthService.switchOrganization(user.sessionId, organizationId);

    res.json({
      success: true,
      message: 'زمینه کاری سازمان با موفقیت تغییر یافت.',
      data: result.session,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای تغییر سازمان زمینه کاری';
    const isForbidden = message.includes('FORBIDDEN_ORG');
    res.status(isForbidden ? 403 : 400).json({ success: false, error: { message } });
  }
});

// GET /api/auth/external/providers - discover configured social providers
authRouter.get('/external/providers', (_req: Request, res: Response) => {
  res.json({ success: true, data: OAuthService.providerStatus() });
});

// GET /api/auth/oauth/:provider/start - begin Google/Apple authorization
authRouter.get('/oauth/:provider/start', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider) as ExternalProvider;
    if (!['google', 'apple'].includes(provider)) {
      return res.status(404).json({ success: false, error: { code: 'UNKNOWN_PROVIDER', message: 'ارائه‌دهنده ورود پشتیبانی نمی‌شود.' } });
    }
    const url = await OAuthService.begin(provider, req.query.returnUrl ? String(req.query.returnUrl) : undefined);
    return res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای شروع ورود اجتماعی';
    return res.status(400).json({ success: false, error: { code: message, message } });
  }
});

async function handleOAuthCallback(req: Request, res: Response) {
  const provider = String(req.params.provider) as ExternalProvider;
  const code = String(req.query.code || req.body?.code || '');
  const state = String(req.query.state || req.body?.state || '');
  const idToken = String(req.query.id_token || req.body?.id_token || '');
  try {
    if (!['google', 'apple'].includes(provider) || !code || !state) throw new Error('OAUTH_CALLBACK_INVALID');
    const redirectUrl = await OAuthService.callback(provider, { code, state, idToken: idToken || undefined });
    return res.redirect(redirectUrl);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'OAUTH_CALLBACK_FAILED';
    const fallback = new URL(process.env.APP_URL || 'http://localhost:3000/');
    fallback.searchParams.set('oauth_error', message);
    return res.redirect(fallback.toString());
  }
}

authRouter.get('/oauth/:provider/callback', handleOAuthCallback);
authRouter.post('/oauth/:provider/callback', handleOAuthCallback);

// POST /api/auth/oauth/complete - exchange one-time provider ticket for a normal Didar session
authRouter.post('/oauth/complete', async (req: Request, res: Response) => {
  try {
    const { ticket, totp, recoveryCode, organizationId } = req.body || {};
    if (!ticket) return res.status(400).json({ success: false, error: { code: 'OAUTH_TICKET_REQUIRED', message: 'توکن موقت ورود اجتماعی الزامی است.' } });
    const ticketRow = await OAuthService.resolveTicket(String(ticket));
    await MfaService.verifyLoginFactor(ticketRow.partyId, totp, recoveryCode);
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const result = await AuthService.createSessionForParty(ticketRow.partyId, organizationId, userAgent, ipAddress);
    await OAuthService.consumeTicket(ticketRow.id);
    return res.json({ success: true, message: 'ورود اجتماعی با موفقیت انجام شد.', data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'OAUTH_COMPLETE_FAILED';
    const mfaRequired = message.includes('MFA_REQUIRED');
    const invalidMfa = message.includes('INVALID_TOTP') || message.includes('INVALID_RECOVERY_CODE');
    return res.status(mfaRequired ? 428 : invalidMfa ? 401 : 400).json({
      success: false,
      error: { code: mfaRequired ? 'MFA_REQUIRED' : invalidMfa ? 'INVALID_MFA' : message, message },
    });
  }
});

// GET /api/auth/mfa/status
authRouter.get('/mfa/status', authenticate, async (req: Request, res: Response) => {
  const data = await MfaService.getStatus(req.user!.partyId);
  res.json({ success: true, data });
});

// POST /api/auth/mfa/totp/begin
authRouter.post('/mfa/totp/begin', authenticate, async (req: Request, res: Response) => {
  try {
    const label = req.user!.person.email || req.user!.person.mobile || req.user!.partyId;
    const data = await MfaService.beginTotpEnrollment(req.user!.partyId, label);
    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'TOTP_ENROLLMENT_FAILED';
    res.status(message.includes('MFA_ENCRYPTION_KEY') ? 503 : 400).json({ success: false, error: { code: message, message } });
  }
});

// POST /api/auth/mfa/totp/confirm
authRouter.post('/mfa/totp/confirm', authenticate, async (req: Request, res: Response) => {
  try {
    const data = await MfaService.confirmTotpEnrollment(req.user!.partyId, String(req.body?.code || ''));
    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'TOTP_CONFIRM_FAILED';
    res.status(400).json({ success: false, error: { code: message, message } });
  }
});

// POST /api/auth/mfa/totp/disable
authRouter.post('/mfa/totp/disable', authenticate, async (req: Request, res: Response) => {
  try {
    const data = await MfaService.disableTotp(req.user!.partyId, String(req.body?.code || ''));
    res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'TOTP_DISABLE_FAILED';
    res.status(400).json({ success: false, error: { code: message, message } });
  }
});

// POST /api/auth/logout - Revoke active session
authRouter.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    await AuthService.logout(user.sessionId);

    res.json({
      success: true,
      message: 'خروج از سامانه با موفقیت انجام شد.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای خروج از سامانه';
    res.status(500).json({ success: false, error: { message } });
  }
});

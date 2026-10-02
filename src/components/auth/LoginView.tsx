/**
 * Didar Gold Platform - Authentication Screen
 * Password, SMS OTP, Google/Apple external identity, optional TOTP MFA,
 * and initial administrator provisioning.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { AuthSessionData } from '../../types/auth.js';
import { normalizeDigits, normalizeIdentifierDigits, normalizeOtp } from '../../lib/input-normalization.js';
import { PasswordField } from '../ui/PasswordField.js';
import {
  ShieldCheck,
  Key,
  Phone,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: (session: AuthSessionData) => void;
}

type CodedError = Error & { code?: string };

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'setup_admin'>('login');
  const [authMethod, setAuthMethod] = useState<'password' | 'otp'>('password');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDebugCode, setOtpDebugCode] = useState<string | null>(null);

  const [mfaRequired, setMfaRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [oauthTicket, setOauthTicket] = useState<string | null>(null);
  const [providers, setProviders] = useState({ google: false, apple: false });

  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminMobile, setAdminMobile] = useState('');
  const [adminNationalId, setAdminNationalId] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [adminOrgName, setAdminOrgName] = useState('هسته مرکزی پلتفرم دیدار');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isProvisioned, setIsProvisioned] = useState<boolean | null>(null);

  useEffect(() => {
    void checkAdminStatus();
    api.getExternalAuthProviders().then(setProviders).catch(() => {});

    const url = new URL(window.location.href);
    const externalError = url.searchParams.get('oauth_error');
    const ticket = url.searchParams.get('oauth_ticket');
    if (externalError) {
      setError(`ورود اجتماعی تکمیل نشد: ${externalError}`);
    }
    if (ticket) {
      setMode('login');
      setOauthTicket(ticket);
      void completeExternalLogin(ticket);
    }
  }, []);

  const cleanOAuthQuery = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('oauth_ticket');
    url.searchParams.delete('oauth_provider');
    url.searchParams.delete('oauth_error');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  };

  const checkAdminStatus = async () => {
    try {
      const status = await api.getAuthStatus();
      setIsProvisioned(status.isProvisioned);
      if (!status.isProvisioned) setMode('setup_admin');
    } catch (e) {
      console.warn('Failed to check admin status:', e);
    }
  };

  const completeExternalLogin = async (ticket: string, code?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.completeOAuth(ticket, code ? normalizeOtp(code) : undefined);
      cleanOAuthQuery();
      setOauthTicket(null);
      setMfaRequired(false);
      onLoginSuccess(res.session);
    } catch (err: unknown) {
      const coded = err as CodedError;
      if (coded.code === 'MFA_REQUIRED') {
        setMfaRequired(true);
        setSuccessMessage('هویت Google/Apple تایید شد. کد Authenticator را وارد کنید.');
      } else {
        setError(coded.message || 'خطای تکمیل ورود اجتماعی');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (oauthTicket) {
      if (!totpCode.trim()) {
        setError('کد ۶ رقمی Authenticator را وارد کنید.');
        return;
      }
      await completeExternalLogin(oauthTicket, totpCode);
      return;
    }

    if (!identifier.trim()) {
      setError('لطفاً شماره همراه، کدملی یا ایمیل را وارد نمایید.');
      return;
    }
    if (authMethod === 'password' && !password) {
      setError('لطفاً رمز عبور را وارد نمایید.');
      return;
    }
    if (authMethod === 'otp' && !otpSent) {
      await handleRequestOtp();
      return;
    }
    if (authMethod === 'otp' && !otpCode.trim()) {
      setError('لطفاً کد یکبارمصرف پیامک‌شده را وارد نمایید.');
      return;
    }
    if (mfaRequired && !totpCode.trim()) {
      setError('کد ۶ رقمی Authenticator را وارد کنید.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.login(
        normalizeDigits(identifier.trim()),
        authMethod === 'password' ? password : undefined,
        authMethod === 'otp' ? normalizeOtp(otpCode) : undefined,
        undefined,
        authMethod === 'password' && mfaRequired ? normalizeOtp(totpCode) : undefined
      );
      setMfaRequired(false);
      onLoginSuccess(res.session);
    } catch (err: unknown) {
      const coded = err as CodedError;
      if (coded.code === 'MFA_REQUIRED') {
        setMfaRequired(true);
        setSuccessMessage('رمز عبور صحیح است. برای تکمیل ورود، کد Authenticator را وارد کنید.');
      } else {
        setError(coded.message || 'خطای ورود به سامانه');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    if (!identifier.trim()) {
      setError('لطفاً شماره همراه معتبر وارد نمایید.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.requestOtp(normalizeIdentifierDigits(identifier));
      setOtpSent(true);
      setSuccessMessage(res.message);
      if (res.debugCode) {
        setOtpDebugCode(res.debugCode);
        setOtpCode(res.debugCode);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطای ارسال کد پیامکی';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!adminFirstName || !adminLastName || !adminMobile || !adminPassword) {
      setError('تکمیل تمامی فیلدهای ستاره‌دار الزامی است.');
      return;
    }
    if (adminPassword.length < 8) {
      setError('رمز عبور باید حداقل ۸ کاراکتر باشد.');
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      setError('تکرار رمز عبور با رمز عبور مطابقت ندارد.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.setupAdmin({
        firstName: adminFirstName.trim(),
        lastName: adminLastName.trim(),
        mobile: normalizeIdentifierDigits(adminMobile),
        nationalId: adminNationalId ? normalizeIdentifierDigits(adminNationalId) : undefined,
        email: adminEmail.trim() || undefined,
        password: adminPassword,
        organizationName: adminOrgName.trim() || undefined,
      });
      setSuccessMessage('مدیر ارشد با موفقیت راه‌اندازی شد. در حال ورود...');
      setTimeout(() => onLoginSuccess(res.session), 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطای راه‌اندازی مدیر ارشد';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const startExternalLogin = (provider: 'google' | 'apple') => {
    const cleanReturn = new URL(window.location.href);
    cleanReturn.search = '';
    window.location.href = api.getOAuthStartUrl(provider, cleanReturn.toString());
  };

  return (
    <div className="min-h-screen bg-[#101014] text-[#EDEDED] flex flex-col justify-center items-center p-4 relative overflow-hidden" dir="rtl">
      <div className="absolute top-1/4 -right-32 w-96 h-96 bg-[#C8A951]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -left-32 w-96 h-96 bg-[#8C6D23]/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-[#16161C] border border-[#2B2B36] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/80 relative z-10 backdrop-blur-md">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#E5C365] via-[#C8A951] to-[#8C6D23] flex items-center justify-center shadow-lg shadow-[#C8A951]/30 border border-[#F4DC98]/40 mb-3">
            <span className="font-extrabold text-[#141416] text-2xl tracking-wider">DG</span>
          </div>
          <h1 className="text-xl font-bold text-[#F4F4F6] tracking-tight">پلتفرم تبادلات طلا و جواهر دیدار</h1>
          <p className="text-xs text-[#9E9EA8] mt-1">سامانه جامع مدیریت تبادلات، خزانه‌داری و امنیت</p>
        </div>

        {isProvisioned !== false && (
          <div className="flex bg-[#1E1E26] p-1 rounded-xl mb-6 border border-[#2C2C38]">
            <button type="button" onClick={() => { setMode('login'); setError(null); }} className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${mode === 'login' ? 'bg-[#C8A951] text-[#141416] shadow-md' : 'text-[#9E9EA8] hover:text-white'}`}>
              ورود به حساب
            </button>
            <button type="button" onClick={() => { setMode('setup_admin'); setError(null); }} className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${mode === 'setup_admin' ? 'bg-[#C8A951] text-[#141416] shadow-md' : 'text-[#9E9EA8] hover:text-white'}`}>
              راه‌اندازی اولیه مدیر
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{successMessage}</span>
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {!oauthTicket && (
              <>
                <div className="flex gap-2 text-xs text-[#9E9EA8] justify-center mb-1">
                  <button type="button" onClick={() => { setAuthMethod('password'); setOtpSent(false); setMfaRequired(false); }} className={`px-3 py-1 rounded-md transition-colors ${authMethod === 'password' ? 'text-[#E5C365] bg-[#22222E] font-medium border border-[#C8A951]/30' : 'hover:text-white'}`}>
                    ورود با رمز عبور
                  </button>
                  <button type="button" onClick={() => { setAuthMethod('otp'); setMfaRequired(false); }} className={`px-3 py-1 rounded-md transition-colors ${authMethod === 'otp' ? 'text-[#E5C365] bg-[#22222E] font-medium border border-[#C8A951]/30' : 'hover:text-white'}`}>
                    OTP پیامکی
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#C5C5D2] mb-1.5">شماره همراه / کدملی / ایمیل</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(normalizeDigits(e.target.value))}
                      placeholder="09121112233"
                      dir="ltr"
                      className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-[#606072] outline-none transition-colors text-right"
                      required
                    />
                    <Phone className="w-4 h-4 text-[#7A7A8C] absolute left-3 top-3 pointer-events-none" />
                  </div>
                </div>

                {authMethod === 'password' && (
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    label="رمز عبور"
                    required
                    autoComplete="current-password"
                  />
                )}

                {authMethod === 'otp' && otpSent && (
                  <div>
                    <label className="block text-xs font-medium text-[#C5C5D2] mb-1.5">کد ۶ رقمی پیامکی</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={otpCode}
                        onChange={(e) => setOtpCode(normalizeOtp(e.target.value))}
                        placeholder="123456"
                        maxLength={6}
                        dir="ltr"
                        className="w-full bg-[#1C1C24] border border-[#C8A951] rounded-xl px-3.5 py-2.5 text-center text-lg font-mono tracking-widest text-[#E5C365] outline-none"
                        required
                      />
                      <Key className="w-4 h-4 text-[#C8A951] absolute left-3 top-3 pointer-events-none" />
                    </div>
                    {otpDebugCode && <p className="text-[11px] text-emerald-400 mt-1 text-center font-mono">کد توسعه: {otpDebugCode}</p>}
                  </div>
                )}
              </>
            )}

            {mfaRequired && (
              <div className="p-3 rounded-xl bg-[#1A202B] border border-[#3B82F6]/30">
                <label className="flex items-center gap-2 text-xs font-medium text-[#BFDBFE] mb-2">
                  <Smartphone className="w-4 h-4" />
                  کد Google/Microsoft Authenticator
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(normalizeOtp(e.target.value))}
                  placeholder="123456"
                  maxLength={6}
                  dir="ltr"
                  className="w-full bg-[#10151D] border border-[#3B82F6]/40 focus:border-[#60A5FA] rounded-xl px-3 py-2.5 text-center text-lg font-mono tracking-[0.3em] text-[#BFDBFE] outline-none"
                  autoFocus
                />
              </div>
            )}

            <button type="submit" disabled={isLoading} className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-[#E5C365] via-[#C8A951] to-[#A2822C] text-[#141416] font-bold text-sm shadow-lg shadow-[#C8A951]/20 flex items-center justify-center gap-2 disabled:opacity-50">
              {isLoading ? <><RefreshCw className="w-4 h-4 animate-spin" /><span>در حال بررسی...</span></> :
                oauthTicket ? <span>تکمیل ورود امن</span> :
                authMethod === 'otp' && !otpSent ? <span>دریافت کد پیامکی</span> :
                <span>ورود به سامانه</span>}
            </button>

            {!oauthTicket && (
              <div className="pt-2">
                <div className="flex items-center gap-3 my-3 text-[10px] text-[#6F6F7C]"><span className="h-px bg-[#30303A] flex-1" /><span>یا ورود با حساب متصل</span><span className="h-px bg-[#30303A] flex-1" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={!providers.google} onClick={() => startExternalLogin('google')} className="py-2.5 rounded-xl border border-[#3A3A46] bg-[#1D1D25] hover:bg-[#252530] disabled:opacity-40 text-xs font-semibold">
                    <span className="inline-flex items-center gap-2"><span className="font-black text-base">G</span> Google</span>
                  </button>
                  <button type="button" disabled={!providers.apple} onClick={() => startExternalLogin('apple')} className="py-2.5 rounded-xl border border-[#3A3A46] bg-[#1D1D25] hover:bg-[#252530] disabled:opacity-40 text-xs font-semibold">
                    <span className="inline-flex items-center gap-2"><span className="text-base"></span> Apple</span>
                  </button>
                </div>
                {(!providers.google || !providers.apple) && <p className="text-[10px] text-[#6F6F7C] mt-2 text-center">دکمه‌های غیرفعال پس از تنظیم Credential امن Provider در سرور فعال می‌شوند.</p>}
              </div>
            )}
          </form>
        )}

        {mode === 'setup_admin' && (
          <form onSubmit={handleSetupAdminSubmit} className="space-y-3.5">
            <div className="p-2.5 rounded-lg bg-[#22222E] border border-[#343444] text-xs text-[#B5B5C2] leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-[#C8A951] inline ml-1.5" />
              پیکربندی اولیه حساب مدیر ارشد کل پلتفرم دیدار
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <input type="text" value={adminFirstName} onChange={(e) => setAdminFirstName(e.target.value)} placeholder="نام *" className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none" required />
              <input type="text" value={adminLastName} onChange={(e) => setAdminLastName(e.target.value)} placeholder="نام خانوادگی *" className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none" required />
            </div>

            <input type="text" inputMode="numeric" value={adminMobile} onChange={(e) => setAdminMobile(normalizeIdentifierDigits(e.target.value))} placeholder="شماره همراه مدیر *" dir="ltr" className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none" required />

            <div className="grid grid-cols-2 gap-2.5">
              <input type="text" inputMode="numeric" value={adminNationalId} onChange={(e) => setAdminNationalId(normalizeIdentifierDigits(e.target.value))} placeholder="کدملی" dir="ltr" className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none" />
              <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="ایمیل" dir="ltr" className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none" />
            </div>

            <input type="text" value={adminOrgName} onChange={(e) => setAdminOrgName(e.target.value)} placeholder="نام سازمان" className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none" />

            <PasswordField value={adminPassword} onChange={setAdminPassword} label="رمز عبور امن (حداقل ۸ کاراکتر) *" required autoComplete="new-password" />
            <PasswordField value={adminConfirmPassword} onChange={setAdminConfirmPassword} label="تکرار رمز عبور *" required autoComplete="new-password" />

            <button type="submit" disabled={isLoading} className="w-full mt-3 py-3 px-4 rounded-xl bg-gradient-to-r from-[#E5C365] via-[#C8A951] to-[#A2822C] text-[#141416] font-bold text-xs shadow-lg shadow-[#C8A951]/20 flex items-center justify-center gap-2 disabled:opacity-50">
              {isLoading ? <><RefreshCw className="w-4 h-4 animate-spin" /><span>در حال مقداردهی اولیه...</span></> : <span>تکمیل و راه‌اندازی حساب مدیر ارشد</span>}
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-[#262632] flex items-center justify-between text-[11px] text-[#787888]">
          <span>دیدار گلد — نسخه ۲.۰</span>
          <span className="font-mono text-[#C8A951]">ACID PostgreSQL</span>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, KeyRound, ShieldCheck, Smartphone, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { normalizeOtp } from '../../lib/input-normalization.js';

interface AccountSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccountSecurityModal: React.FC<AccountSecurityModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<{ totpEnabled: boolean; totpPending: boolean; confirmedAt?: string | null } | null>(null);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setStatus(await api.getMfaStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت وضعیت امنیت حساب');
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setMessage(null);
      setCode('');
      setEnrollment(null);
      setRecoveryCodes([]);
      void load();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.beginTotpEnrollment();
      setEnrollment(data);
      setMessage('کلید را در Google Authenticator، Microsoft Authenticator یا هر برنامه TOTP اضافه کنید و سپس کد ۶ رقمی را تایید کنید.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در شروع فعال‌سازی');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.confirmTotpEnrollment(normalizeOtp(code));
      setRecoveryCodes(data.recoveryCodes);
      setEnrollment(null);
      setCode('');
      setMessage('Authenticator فعال شد. Recovery Codeها را در محل امن نگهداری کنید؛ بعداً دوباره نمایش داده نمی‌شوند.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'کد Authenticator معتبر نیست.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.disableTotp(normalizeOtp(code));
      setCode('');
      setMessage('Authenticator غیرفعال شد.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در غیرفعال‌سازی Authenticator');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage('در کلیپ‌بورد کپی شد.');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg rounded-2xl bg-[#171720] border border-[#343444] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2B2B38] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#C8A951]" />
            <div>
              <h3 className="text-sm font-bold text-white">امنیت حساب و احراز هویت دومرحله‌ای</h3>
              <p className="text-[10px] text-[#8E8E9E] mt-0.5">SMS OTP و Authenticator به‌صورت Factorهای مستقل</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#8E8E9E] hover:text-white hover:bg-white/5"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/50 text-red-300 text-xs">{error}</div>}
          {message && <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/50 text-emerald-300 text-xs">{message}</div>}

          <div className="p-4 rounded-xl bg-[#111118] border border-[#2B2B38] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-[#60A5FA]" />
              <div>
                <div className="text-xs font-bold text-white">Authenticator App (TOTP)</div>
                <div className="text-[10px] text-[#8E8E9E]">Google Authenticator، Microsoft Authenticator، 1Password و ابزارهای سازگار</div>
              </div>
            </div>
            <span className={`text-[10px] px-2 py-1 rounded-full border ${status?.totpEnabled ? 'text-emerald-400 border-emerald-700/50 bg-emerald-950/30' : 'text-[#A0A0B0] border-[#3A3A48] bg-[#22222B]'}`}>
              {status?.totpEnabled ? 'فعال' : status?.totpPending ? 'در انتظار تایید' : 'غیرفعال'}
            </span>
          </div>

          {!status?.totpEnabled && !enrollment && (
            <button type="button" disabled={busy} onClick={begin} className="w-full py-2.5 rounded-xl bg-[#C8A951] text-[#151515] text-xs font-bold disabled:opacity-50">
              فعال‌سازی Authenticator
            </button>
          )}

          {enrollment && (
            <div className="p-4 rounded-xl border border-[#C8A951]/30 bg-[#1D1B15] space-y-3">
              <div className="text-xs font-bold text-[#E5C365] flex items-center gap-2"><KeyRound className="w-4 h-4" />کلید راه‌اندازی</div>
              <p className="text-[11px] text-[#A9A99A]">در Authenticator گزینه Enter setup key را بزنید. Account را Didar Gold و Type را Time based انتخاب کنید.</p>
              <div className="flex items-center gap-2">
                <code dir="ltr" className="flex-1 break-all bg-black/30 rounded-lg px-3 py-2 text-xs text-[#F3E6B5]">{enrollment.secret}</code>
                <button type="button" onClick={() => copy(enrollment.secret)} className="p-2 rounded-lg bg-[#29251A] text-[#E5C365]"><Copy className="w-4 h-4" /></button>
              </div>
              <a href={enrollment.otpauthUri} className="block text-[11px] text-[#7DD3FC] underline underline-offset-2">باز کردن مستقیم با برنامه سازگار (در دستگاه‌های پشتیبانی‌شده)</a>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(normalizeOtp(e.target.value))}
                placeholder="کد ۶ رقمی"
                dir="ltr"
                className="w-full bg-[#121218] border border-[#3A3A48] focus:border-[#C8A951] rounded-xl px-3 py-2.5 text-center font-mono tracking-[0.25em] text-white outline-none"
              />
              <button type="button" disabled={busy || code.length !== 6} onClick={confirm} className="w-full py-2.5 rounded-xl bg-[#C8A951] text-black text-xs font-bold disabled:opacity-40">
                تایید و فعال‌سازی
              </button>
            </div>
          )}

          {status?.totpEnabled && (
            <div className="p-4 rounded-xl border border-[#3A3A48] bg-[#121218] space-y-3">
              <p className="text-[11px] text-[#A0A0B0]">برای غیرفعال‌سازی، یک کد معتبر فعلی Authenticator وارد کنید.</p>
              <input type="text" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(normalizeOtp(e.target.value))} placeholder="123456" dir="ltr" className="w-full bg-[#171720] border border-[#343444] rounded-xl px-3 py-2 text-center font-mono text-white outline-none" />
              <button type="button" disabled={busy || code.length !== 6} onClick={disable} className="w-full py-2 rounded-xl border border-red-800/50 bg-red-950/20 text-red-300 text-xs font-semibold disabled:opacity-40">غیرفعال‌سازی Authenticator</button>
            </div>
          )}

          {recoveryCodes.length > 0 && (
            <div className="p-4 rounded-xl border border-amber-700/40 bg-amber-950/20 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-bold"><AlertTriangle className="w-4 h-4" />Recovery Codeها — فقط همین بار</div>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((item) => <code key={item} dir="ltr" className="bg-black/30 px-2 py-1.5 rounded text-[11px] text-amber-100 text-center">{item}</code>)}
              </div>
              <button type="button" onClick={() => copy(recoveryCodes.join('\n'))} className="w-full py-2 rounded-lg bg-amber-900/30 text-amber-200 text-xs flex items-center justify-center gap-2"><Copy className="w-3.5 h-3.5" />کپی همه</button>
            </div>
          )}

          <div className="p-3 rounded-xl bg-[#15151D] border border-[#2C2C38] text-[10px] text-[#8E8E9E] leading-relaxed">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 inline ml-1" />
            Secret و Recovery Code خام در لاگ یا گزارش ذخیره نمی‌شوند. Google/Apple فقط هویت را تایید می‌کنند و هیچ Role یا Permission اعطا نمی‌کنند.
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: 'current-password' | 'new-password';
  className?: string;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  value,
  onChange,
  label,
  placeholder = '••••••••',
  required,
  autoComplete = 'current-password',
  className = '',
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className={className}>
      {label && <label className="block text-xs font-medium text-[#C5C5D2] mb-1.5">{label}</label>}
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          dir="ltr"
          className="w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-10 py-2.5 text-sm text-white placeholder-[#606072] outline-none transition-colors"
        />
        <Lock className="w-4 h-4 text-[#7A7A8C] absolute left-3 top-3 pointer-events-none" />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-2.5 p-0.5 text-[#8A8A9A] hover:text-[#E5C365]"
          aria-label={visible ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
          title={visible ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { normalizeIdentifierDigits, normalizeNumericText } from '../../lib/input-normalization.js';

interface BaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  maxLength?: number;
}

const baseClass = 'w-full bg-[#1C1C24] border border-[#30303E] focus:border-[#C8A951] rounded-xl px-3 py-2 text-xs text-white outline-none';

export const IdentifierField: React.FC<BaseProps> = ({ value, onChange, placeholder, required, disabled, className, maxLength }) => (
  <input
    type="text"
    inputMode="numeric"
    dir="ltr"
    value={value}
    onChange={(e) => onChange(normalizeIdentifierDigits(e.target.value))}
    placeholder={placeholder}
    required={required}
    disabled={disabled}
    maxLength={maxLength}
    className={className || baseClass}
  />
);

export const NumericField: React.FC<BaseProps & { decimal?: boolean; signed?: boolean }> = ({
  value, onChange, placeholder, required, disabled, className, decimal = true, signed = false
}) => (
  <input
    type="text"
    inputMode={decimal ? 'decimal' : 'numeric'}
    dir="ltr"
    value={value}
    onChange={(e) => onChange(normalizeNumericText(e.target.value, { decimal, signed }))}
    placeholder={placeholder}
    required={required}
    disabled={disabled}
    className={className || baseClass}
  />
);

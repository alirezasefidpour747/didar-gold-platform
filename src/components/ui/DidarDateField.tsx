import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { isoDateToJalali, jalaliMonthLength, jalaliToIsoDate, normalizeDigits, toPersianDigits } from '../../lib/input-normalization.js';

interface DidarDateFieldProps {
  value: string; // canonical YYYY-MM-DD
  onChange: (isoDate: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  locale?: 'fa' | 'ar' | 'en' | 'fr';
}

const PERSIAN_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

export const DidarDateField: React.FC<DidarDateFieldProps> = ({
  value,
  onChange,
  required,
  disabled,
  placeholder = '۱۴۰۵/۰۷/۱۰',
  locale = 'fa',
}) => {
  const jalali = value ? isoDateToJalali(value) : '';
  const [text, setText] = useState(jalali ? toPersianDigits(jalali) : '');
  const [open, setOpen] = useState(false);

  const current = useMemo(() => {
    const source = jalali || isoDateToJalali(new Date().toISOString().slice(0, 10));
    const [y, m, d] = source.split('/').map(Number);
    return { y, m, d };
  }, [jalali]);

  const [cursor, setCursor] = useState({ y: current.y, m: current.m });

  React.useEffect(() => {
    setText(jalali ? (locale === 'fa' ? toPersianDigits(jalali) : jalali) : '');
  }, [jalali, locale]);

  const commitText = () => {
    if (!text.trim()) {
      onChange('');
      return;
    }
    const iso = jalaliToIsoDate(text);
    if (iso) {
      onChange(iso);
      setText(locale === 'fa' ? toPersianDigits(isoDateToJalali(iso)) : isoDateToJalali(iso));
    }
  };

  const daysInMonth = jalaliMonthLength(cursor.y, cursor.m);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const selectDay = (day: number) => {
    const iso = jalaliToIsoDate(`${cursor.y}/${cursor.m}/${day}`);
    if (iso) onChange(iso);
    setOpen(false);
  };

  const prevMonth = () => setCursor((c) => c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 });
  const nextMonth = () => setCursor((c) => c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 });

  if (locale !== 'fa') {
    return (
      <input
        type="date"
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#121218] border border-[#2C2C3C] rounded-xl px-3 py-2 text-xs text-[#EDEDED] outline-none font-mono"
      />
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(toPersianDigits(normalizeDigits(e.target.value).replace(/[-.]/g, '/')))}
          onBlur={commitText}
          dir="ltr"
          className="w-full bg-[#121218] border border-[#2C2C3C] focus:border-[#C8A951] rounded-xl px-9 py-2 text-xs text-[#EDEDED] outline-none font-mono text-center"
        />
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          className="absolute left-2 top-1.5 p-1 text-[#C8A951] hover:text-[#E5C365]"
          title="انتخاب از تقویم شمسی"
        >
          <CalendarDays className="w-4 h-4" />
        </button>
      </div>
      {open && (
        <div className="absolute z-[70] mt-2 w-72 bg-[#171720] border border-[#343444] rounded-xl shadow-2xl p-3" dir="rtl">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-white/5"><ChevronRight className="w-4 h-4" /></button>
            <div className="text-xs font-bold text-[#E5C365]">{PERSIAN_MONTHS[cursor.m - 1]} {toPersianDigits(cursor.y)}</div>
            <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-white/5"><ChevronLeft className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const selected = current.y === cursor.y && current.m === cursor.m && current.d === day;
              return (
                <button
                  type="button"
                  key={day}
                  onClick={() => selectDay(day)}
                  className={`h-8 rounded-lg text-xs transition-colors ${selected ? 'bg-[#C8A951] text-black font-bold' : 'text-[#D5D5DE] hover:bg-[#292936]'}`}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-[#777788] text-center">ذخیره در پایگاه‌داده: ISO / Gregorian</div>
        </div>
      )}
    </div>
  );
};

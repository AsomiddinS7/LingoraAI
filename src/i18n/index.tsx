import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import ru from './ru.json';
import uz from './uz.json';
import { LANGS, type Lang } from '../types';
import { readPref, writePref } from '../lib/prefs';

export type MessageKey = Exclude<keyof typeof en, `_${string}`>;
type Messages = Record<string, string>;

export const MESSAGES: Record<Lang, Messages> = { en, ru, uz };

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  const saved = readPref('lang');
  if (saved && (LANGS as string[]).includes(saved)) return saved as Lang;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  // TODO [CONFIRM]: default UI language for the event. Uzbek first if the browser does not say otherwise.
  if (nav === 'ru') return 'ru';
  if (nav === 'en') return 'en';
  return 'uz';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writePref('lang', l);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { M, type MessageKey } from './messages';
import { say, stopSpeaking, unlockAudio, type Lang } from './voice';

export type { MessageKey };
export type { Lang };

interface I18n {
  lang: Lang;
  t: (k: MessageKey) => string;
  toggle: () => void;
  /** Speak one sentence, or several in order. Fixed sentences passed one by one use the recordings shipped with the app. */
  speak: (text: string | string[]) => void;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('ur');

  useEffect(() => {
    const saved = localStorage.getItem('hq.lang');
    if (saved === 'en' || saved === 'ur') setLang(saved);
  }, []);

  // Sound may only start from a tap: the first tap anywhere unlocks speech for the whole visit.
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    localStorage.setItem('hq.lang', lang);
  }, [lang]);

  const t = useCallback((k: MessageKey) => M[k][lang === 'ur' ? 0 : 1], [lang]);
  const speak = useCallback((text: string | string[]) => void say(text, lang), [lang]);
  const toggle = useCallback(() => setLang((l) => (l === 'ur' ? 'en' : 'ur')), []);

  return <Ctx.Provider value={{ lang, t, toggle, speak }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

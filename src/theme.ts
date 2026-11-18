// Theme preference: system, light or dark (v1 design system). Stored as a harmless preference.
import { useCallback, useEffect, useState } from 'react';
import { readPref, writePref } from './lib/prefs';

export type Theme = 'system' | 'light' | 'dark';

function apply(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function initTheme() {
  const t = readPref('theme');
  apply(t === 'light' || t === 'dark' ? t : 'system');
}

export function useTheme() {
  const [theme, set] = useState<Theme>(() => {
    const t = readPref('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  });
  useEffect(() => apply(theme), [theme]);
  const setTheme = useCallback((t: Theme) => {
    writePref('theme', t);
    set(t);
  }, []);
  return { theme, setTheme };
}

// Hash routing: works on any static host (GitHub Pages, Netlify, Vercel) with no rewrites.
import { useSyncExternalStore } from 'react';
import { readPref } from './lib/prefs';

export type Route = 'welcome' | 'conversation' | 'sign' | 'phrasebook' | 'contribute' | 'profile' | 'help' | 'signin' | 'register' | 'console';
export const ROUTES: Route[] = ['welcome', 'conversation', 'sign', 'phrasebook', 'contribute', 'profile', 'help', 'signin', 'register', 'console'];

/** Links from the earlier version keep working. */
const LEGACY: Record<string, Route> = { speak: 'conversation', presentation: 'conversation', phrases: 'phrasebook', about: 'help' };

export function resolveRoute(hash: string, welcomed: boolean): Route {
  const r = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  if ((ROUTES as string[]).includes(r)) return r as Route;
  if (r in LEGACY) return LEGACY[r];
  return welcomed ? 'conversation' : 'welcome';
}

function current(): Route {
  return resolveRoute(window.location.hash, readPref('welcomed') === '1');
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current);
}

export const href = (r: Route) => `#/${r}`;

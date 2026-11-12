// Hash routing: works on any static host (Netlify, Vercel, GitHub Pages) with no rewrites.
import { useSyncExternalStore } from 'react';

export type Route = 'sign' | 'speak' | 'phrases' | 'about' | 'conversation' | 'console';
export const ROUTES: Route[] = ['sign', 'speak', 'phrases', 'about', 'conversation', 'console'];

function current(): Route {
  const r = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route;
  return ROUTES.includes(r) ? r : 'sign';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current);
}

export const href = (r: Route) => `#/${r}`;

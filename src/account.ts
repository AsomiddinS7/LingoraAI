// Signed-in account state. The session itself is an httpOnly cookie the app cannot read;
// only the profile and the CSRF token are kept in memory (never in browser storage).
import { useSyncExternalStore } from 'react';
import { ApiError, bearer, csrf } from './api/client';
import { backend } from './providers';
import type { MeResponse } from './types';

// `token` is returned only to a cross-site client that asked for bearer sessions.
type Me = MeResponse & { csrf_token?: string; token?: string };

let me: Me | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

function set(next: Me | null) {
  if (next?.token) bearer.set(next.token);
  else if (!next) bearer.set(null);
  if (next) delete next.token; // keep the secret out of the shared profile object
  me = next;
  csrf.set(next?.csrf_token ?? null);
  emit();
}

export const account = {
  get: () => me,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Ask the server who we are. Signed out, mock mode or no server -> guest. */
  async refresh() {
    try {
      set((await backend.me()) as Me);
    } catch (e) {
      // Only a definite "signed out" drops a stored session; a sleeping or offline server must not.
      if (e instanceof ApiError && e.code !== 'UNAUTHENTICATED') {
        me = null;
        emit();
        return;
      }
      set(null);
    }
  },
  async login(email: string, password: string) {
    set((await backend.login(email, password)) as Me);
  },
  async register(body: Parameters<typeof backend.register>[0]) {
    set((await backend.register(body)) as Me);
  },
  async telegram(body: Record<string, unknown>) {
    set((await backend.telegram(body)) as Me);
  },
  async logout() {
    try {
      await backend.logout();
    } finally {
      set(null);
    }
  },
  async deleteAccount() {
    await backend.deleteMe();
    set(null);
  },
};

export function useAccount(): Me | null {
  useSyncExternalStore(account.subscribe, () => version);
  return me;
}

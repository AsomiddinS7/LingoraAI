// Runtime store: the active config (build defaults + console overrides) and demo switches.
// In memory only, so a reload always returns to the build configuration.
import { useSyncExternalStore } from 'react';
import { configFromEnv, type AppConfig } from './config';
import type { Fixture } from './api/fixtures';
import type { FaceHint } from './types';

export interface DemoState {
  fixture: Fixture;
  simClassifierFail: boolean;
  simCameraDenied: boolean;
  simOffline: boolean;
  faceHint: FaceHint | null;
}

export interface RuntimeState {
  config: AppConfig;
  demo: DemoState;
  online: boolean;
}

const BUILD_CONFIG = configFromEnv();

let state: RuntimeState = {
  config: BUILD_CONFIG,
  demo: { fixture: 'success', simClassifierFail: false, simCameraDenied: false, simOffline: false, faceHint: null },
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const runtime = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setConfig(patch: Partial<AppConfig>) {
    state = { ...state, config: { ...state.config, ...patch } };
    emit();
  },
  resetConfig() {
    state = { ...state, config: BUILD_CONFIG };
    emit();
  },
  setDemo(patch: Partial<DemoState>) {
    state = { ...state, demo: { ...state.demo, ...patch } };
    emit();
  },
  setOnline(online: boolean) {
    if (state.online === online) return;
    state = { ...state, online };
    emit();
  },
  isOffline: () => !state.online || state.demo.simOffline,
  buildConfig: BUILD_CONFIG,
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => runtime.setOnline(true));
  window.addEventListener('offline', () => runtime.setOnline(false));
}

export function useRuntime<T>(selector: (s: RuntimeState) => T): T {
  return useSyncExternalStore(runtime.subscribe, () => selector(runtime.get()));
}

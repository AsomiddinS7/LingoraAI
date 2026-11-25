// Learning state kept on this device only: saved phrases and practice history.
// Everything shown on the Profile dashboard is computed from these real records; nothing is estimated.
import { useSyncExternalStore } from 'react';
import learningSets from './data/learningPhrases.json';
import { catalog, type PhraseRow } from './data';

export const CATEGORIES = ['daily', 'education', 'healthcare', 'business', 'travel', 'emergency'] as const;
export type Category = (typeof CATEGORIES)[number];
export type LearningPhrase = PhraseRow & { category: Category };
export interface Practice { slug: string; at: number }

const SAVED_KEY = 'lingora.saved';
const PRACTICE_KEY = 'lingora.practice';
const MAX_HISTORY = 200;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the state lasts until reload */
  }
}

let saved: string[] = read<string[]>(SAVED_KEY, []).filter((s) => typeof s === 'string');
let history: Practice[] = read<Practice[]>(PRACTICE_KEY, []).filter((p) => p && typeof p.slug === 'string' && typeof p.at === 'number');
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Daily phrases from the catalog (API or bundled seed) plus the bundled learning sets. */
export function allPhrases(): LearningPhrase[] {
  const daily = catalog.phrases().map((p) => ({ ...p, category: 'daily' as const }));
  const extra = (learningSets.items as LearningPhrase[]).filter((p) => !daily.some((d) => d.slug === p.slug));
  return [...daily, ...extra];
}

export const learning = {
  subscribe(l: () => void) {
    listeners.add(l);
    const off = catalog.subscribe(l);
    return () => {
      listeners.delete(l);
      off();
    };
  },
  saved: () => saved,
  history: () => history,
  isSaved: (slug: string) => saved.includes(slug),
  toggleSave(slug: string) {
    saved = saved.includes(slug) ? saved.filter((s) => s !== slug) : [slug, ...saved];
    write(SAVED_KEY, saved);
    emit();
  },
  /** Called when a phrase is actually played aloud. */
  practiced(slug: string) {
    if (!slug || slug === 'own') return;
    history = [{ slug, at: Date.now() }, ...history].slice(0, MAX_HISTORY);
    write(PRACTICE_KEY, history);
    emit();
  },
  clearHistory() {
    history = [];
    write(PRACTICE_KEY, history);
    emit();
  },
};

export function useLearning() {
  useSyncExternalStore(learning.subscribe, () => version + catalog.version() * 100000);
  return { saved, history, phrases: allPhrases() };
}

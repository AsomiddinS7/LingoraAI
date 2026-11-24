// Catalog: signs and phrases come from the API (GET /api/signs, GET /api/phrasebook), never from
// app code (v1 spec 2.2). Until the first answer arrives, and whenever the API is unreachable,
// the bundled seed is used so the phrasebook keeps working with everything else off.
import { useSyncExternalStore } from 'react';
import seedSigns from '../api/seed/signs.json';
import seedPhrases from '../api/seed/phrases.json';
import type { Lang } from '../types';

export interface SignRow {
  id: string;
  slug: string;
  labels: Record<Lang, string>;
  scenario: string;
  status: 'draft' | 'active' | 'retired';
  sort_order: number;
  reference_clip_id?: string | null;
}

export interface PhraseRow {
  id: string;
  slug: string;
  texts: Record<Lang, string>;
  audio_path?: string | null;
}

const activeSorted = (rows: SignRow[]) => rows.filter((r) => r.status === 'active').sort((a, b) => a.sort_order - b.sort_order);

let signs: SignRow[] = activeSorted(seedSigns.items as SignRow[]);
let phrases: PhraseRow[] = seedPhrases.items as PhraseRow[];
let source: 'seed' | 'api' = 'seed';
let version = 0;
let modelWords: { label: string; textUz: string }[] = [];
const listeners = new Set<() => void>();

export function registerModelWords(words: readonly { label: string; textUz: string }[]) {
  modelWords = words.map(w => ({ ...w }));
  version++;
  listeners.forEach(l => l());
}

export const catalog = {
  signs: () => signs,
  phrases: () => phrases,
  source: () => source,
  version: () => version,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Replace the catalog with rows from the API. */
  set(next: { signs?: SignRow[]; phrases?: PhraseRow[] }) {
    if (next.signs) signs = activeSorted(next.signs);
    if (next.phrases) phrases = next.phrases;
    source = 'api';
    version++;
    listeners.forEach((l) => l());
  },
};

export function useCatalog(): number {
  return useSyncExternalStore(catalog.subscribe, catalog.version);
}

// ---- convenience views used across the app ----
export interface VocabularyEntry {
  label: string;
  gloss: Record<Lang, string>;
}

export const vocabulary = (): VocabularyEntry[] => [
  ...signs.map((s) => ({ label: s.slug, gloss: s.labels })),
  ...modelWords.filter(w => !signs.some(s => s.slug === w.label)).map(w => ({
    label: w.label, gloss: { uz: w.textUz, en: w.textUz, ru: w.textUz },
  })),
];
export const vocabLabels = (): string[] => vocabulary().map(w => w.label);

export function glossFor(label: string, lang: Lang): string {
  return signs.find((s) => s.slug === label)?.labels[lang]
    ?? modelWords.find(w => w.label === label)?.textUz ?? label.replace(/_/g, ' ');
}

/** Fallback when the sentence service fails: the confirmed signs as plain words. */
export function signsAsWords(labels: string[], lang: Lang): string {
  const words = labels.map((l) => glossFor(l, lang)).join(', ');
  return words.charAt(0).toUpperCase() + words.slice(1) + '.';
}

export function phraseBySlug(slug: string): PhraseRow | undefined {
  return phrases.find((p) => p.slug === slug);
}

// Seeds re-exported for the mock server (which plays the database) and tests.
export const SEED_SIGNS = seedSigns.items as SignRow[];
export const SEED_PHRASES = seedPhrases.items as PhraseRow[];

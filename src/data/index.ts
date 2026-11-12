import vocabularyFile from './vocabulary.json';
import phrasebookFile from './phrasebook.json';
import type { Lang, Phrase, SignLabel } from '../types';

export interface VocabularyEntry {
  label: SignLabel;
  gloss: Record<Lang, string>;
}

export const VOCABULARY: VocabularyEntry[] = vocabularyFile.signs;
export const VOCAB_LABELS: SignLabel[] = VOCABULARY.map((v) => v.label);

export const PHRASE_CATEGORIES: string[] = phrasebookFile.categories;
export const PHRASES: Phrase[] = phrasebookFile.phrases;

export function glossFor(label: SignLabel, lang: Lang): string {
  return VOCABULARY.find((v) => v.label === label)?.gloss[lang] ?? label.replace(/_/g, ' ');
}

/** Plan B fallback when the sentence service fails: the confirmed signs as plain words. */
export function signsAsWords(labels: SignLabel[], lang: Lang): string {
  const words = labels.map((l) => glossFor(l, lang)).join(', ');
  return words.charAt(0).toUpperCase() + words.slice(1) + '.';
}

export function phraseById(id: string): Phrase | undefined {
  return PHRASES.find((p) => p.id === id);
}

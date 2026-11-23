import { PRESENTATION_CUES } from './presentation';
import { configFromEnv } from '../config';

/** Phrase identities for verified examples, not evidence that a model knows them. */
export const SIGNED_SPEECH_ENTRIES = PRESENTATION_CUES.map((text, index) => ({
  label: `speech_${String(index + 1).padStart(2, '0')}`,
  text,
  gloss: { uz: text, ru: text, en: text },
}));
export const SIGNED_SPEECH_LABELS = SIGNED_SPEECH_ENTRIES.map((entry) => entry.label);
export const SIGNED_SPEECH_MODEL_URL = configFromEnv().signedSpeechModelUrl;
export const signedSpeechText = (label: string) => SIGNED_SPEECH_ENTRIES.find((entry) => entry.label === label)?.text;

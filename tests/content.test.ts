// Seed data (signs, phrasebook), language files and config tests.
import { describe, expect, it } from 'vitest';
import phrasebook from '../src/api/seed/phrases.json';
import signs from '../src/api/seed/signs.json';
import en from '../src/i18n/en.json';
import ru from '../src/i18n/ru.json';
import uz from '../src/i18n/uz.json';
import { configFromEnv, whichPlan } from '../src/config';

const LANGS = ['uz', 'ru', 'en'] as const;
type Row = { slug: string; id: string };

describe('sign seed (table signs)', () => {
  it('is the v1 candidate greeting list', () => {
    expect(signs.items.map((s) => s.slug)).toEqual([
      'hello', 'goodbye', 'how_are_you', 'fine', 'my_name', 'your_name', 'nice_to_meet_you', 'thank_you', 'please', 'yes', 'no', 'please_repeat',
    ]);
  });
  it('has unique ids and slugs, labels in all languages, scenario greeting', () => {
    expect(new Set(signs.items.map((s: Row) => s.id)).size).toBe(signs.items.length);
    for (const s of signs.items) {
      expect(s.scenario).toBe('greeting');
      for (const l of LANGS) expect((s.labels as Record<string, string>)[l]?.trim()).toBeTruthy();
    }
  });
  it('is marked as placeholder', () => expect(signs._note).toContain('[PLACEHOLDER]'));
});

describe('phrasebook seed (table phrases)', () => {
  it('has 8 to 10 phrases with unique slugs and text in all languages', () => {
    expect(phrasebook.items.length).toBeGreaterThanOrEqual(8);
    expect(phrasebook.items.length).toBeLessThanOrEqual(10);
    expect(new Set(phrasebook.items.map((p: Row) => p.slug)).size).toBe(phrasebook.items.length);
    for (const p of phrasebook.items) for (const l of LANGS) expect((p.texts as Record<string, string>)[l]?.trim()).toBeTruthy();
  });
  it('contains please_repeat, the phrase the simplify contract example points to', () => {
    expect(phrasebook.items.some((p: Row) => p.slug === 'please_repeat')).toBe(true);
  });
});

describe('language files', () => {
  const keys = (o: Record<string, string>) => Object.keys(o).filter((k) => !k.startsWith('_')).sort();
  it('ru and uz have exactly the same keys as en', () => {
    expect(keys(ru)).toEqual(keys(en));
    expect(keys(uz)).toEqual(keys(en));
  });
  it('no empty strings', () => {
    for (const file of [en, ru, uz] as Record<string, string>[]) for (const v of Object.values(file)) expect(v.trim()).not.toBe('');
  });
  it('uses the Uzbek modifier letter ʻ (U+02BB), not an apostrophe, in oʻ and gʻ', () => {
    const text = Object.values(uz).join(' ');
    expect(text).toContain('oʻ');
    expect(text).not.toMatch(/[og]'/);
  });
  it('placeholders {x} match across languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(en)) {
      expect(vars((ru as Record<string, string>)[k]), k).toBe(vars((en as Record<string, string>)[k]));
      expect(vars((uz as Record<string, string>)[k]), k).toBe(vars((en as Record<string, string>)[k]));
    }
  });
  it('the old product name is gone', () => {
    for (const file of [en, ru, uz]) expect(JSON.stringify(file)).not.toContain('SignConnect');
  });
});

describe('config switches', () => {
  it('defaults to Plan B, mocks on and the mock recognizer when nothing is set', () => {
    const c = configFromEnv({});
    expect(whichPlan(c)).toBe('B');
    expect(c.mockAzure).toBe(true);
    expect(c.recognizer).toBe('mock');
    expect(c.confidenceThreshold).toBe(0.8);
    expect(c.signWindow).toMatchObject({ countdownMs: 1000, restMs: 500, maxRecordingMs: 3500 });
  });
  it('recognizer = sequence | static | mock, with the old switch still understood', () => {
    expect(configFromEnv({ VITE_RECOGNIZER: 'sequence' }).recognizer).toBe('sequence');
    expect(configFromEnv({ VITE_RECOGNIZER: 'static' }).recognizer).toBe('static');
    expect(configFromEnv({ VITE_SIGN_CLASSIFIER: 'mediapipe' }).recognizer).toBe('static');
    expect(configFromEnv({ VITE_RECOGNIZER: 'nonsense' }).recognizer).toBe('mock');
  });
  it('Plan A from environment', () => {
    const c = configFromEnv({ VITE_STT_PROVIDER: 'azure-speech', VITE_TTS_PROVIDER: 'azure-speech', VITE_FACE_HINTS: 'on', VITE_MOCK_AZURE: 'false' });
    expect(whichPlan(c)).toBe('A');
    expect(c.mockAzure).toBe(false);
  });
});

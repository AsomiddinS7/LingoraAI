// Phrasebook, vocabulary, language-file and config tests.
import { describe, expect, it } from 'vitest';
import phrasebook from '../src/data/phrasebook.json';
import vocabulary from '../src/data/vocabulary.json';
import en from '../src/i18n/en.json';
import ru from '../src/i18n/ru.json';
import uz from '../src/i18n/uz.json';
import { configFromEnv, whichPlan } from '../src/config';

const LANGS = ['uz', 'ru', 'en'] as const;

describe('phrasebook', () => {
  it('has 8 to 10 phrases with unique ids', () => {
    expect(phrasebook.phrases.length).toBeGreaterThanOrEqual(8);
    expect(phrasebook.phrases.length).toBeLessThanOrEqual(10);
    expect(new Set(phrasebook.phrases.map((p) => p.id)).size).toBe(phrasebook.phrases.length);
  });

  it('every phrase has text in all three languages and a known category', () => {
    for (const p of phrasebook.phrases) {
      expect(phrasebook.categories).toContain(p.category);
      for (const l of LANGS) expect((p.text as Record<string, string>)[l]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains please_repeat, the phrase the simplify contract example points to', () => {
    expect(phrasebook.phrases.some((p) => p.id === 'please_repeat')).toBe(true);
  });

  it('is marked as placeholder content', () => {
    expect(phrasebook._note).toContain('[PLACEHOLDER]');
  });
});

describe('vocabulary', () => {
  it('is exactly the placeholder vocabulary from the brief', () => {
    expect(vocabulary.signs.map((s) => s.label)).toEqual(['hello', 'thank_you', 'yes', 'no', 'please_repeat', 'i_want_work', 'my_name', 'wait']);
  });
  it('has glosses in all languages', () => {
    for (const s of vocabulary.signs) for (const l of LANGS) expect((s.gloss as Record<string, string>)[l]).toBeTruthy();
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
});

describe('config switches', () => {
  it('defaults to Plan B with mocks on when nothing is set', () => {
    const c = configFromEnv({});
    expect(whichPlan(c)).toBe('B');
    expect(c.mockAzure).toBe(true);
    expect(c.confidenceThreshold).toBe(0.8);
  });
  it('Plan A from environment', () => {
    const c = configFromEnv({ VITE_STT_PROVIDER: 'azure-speech', VITE_TTS_PROVIDER: 'azure-speech', VITE_FACE_HINTS: 'on', VITE_MOCK_AZURE: 'false' });
    expect(whichPlan(c)).toBe('A');
    expect(c.mockAzure).toBe(false);
  });
  it('ignores unknown values', () => {
    expect(configFromEnv({ VITE_STT_PROVIDER: 'something', VITE_CONFIDENCE_THRESHOLD: '7' })).toMatchObject({ sttProvider: 'typed-input', confidenceThreshold: 0.8 });
  });
});

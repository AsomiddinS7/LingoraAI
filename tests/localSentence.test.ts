import { describe, expect, it } from 'vitest';
import { composeLocally } from '../src/providers/localSentence';
import type { SentenceRequest } from '../src/types';

const request = (labels: string[], name?: string): SentenceRequest => ({ session_id: 'test', language: 'uz', context: 'greeting',
  signs: labels.map((label) => ({ label, confidence: 0.5 })), face_hints: null, ...(name ? { name } : {}) });

describe('confirmed label wording', () => {
  it('speaks the selected Uzbek meaning without mock text or added claims', () => {
    expect(composeLocally(request(['hello', 'thank_you']))).toMatchObject({ status: 'ok', sentence: 'Salom. Rahmat.' });
  });
  it('rejects an unknown label instead of making up a meaning', () => {
    expect(composeLocally(request(['unsupported-sign']))).toMatchObject({ status: 'refused', sentence: null });
  });
  it('requires a name and inserts only the supplied name', () => {
    expect(composeLocally(request(['my_name']))).toMatchObject({ status: 'refused' });
    expect(composeLocally(request(['my_name'], 'Aziza'))).toMatchObject({ sentence: 'Mening ismim Aziza.' });
  });
});

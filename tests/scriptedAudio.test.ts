import { describe, expect, it } from 'vitest';
import { speechChunks } from '../src/components/ScriptedDemo';
import { PRESENTATION_TEXT } from '../src/data/presentation';

describe('prepared speech segments', () => {
  it('keeps the supplied introduction in order and within the voice limit', () => {
    const chunks = speechChunks(PRESENTATION_TEXT);
    expect(chunks.join(' ')).toBe(PRESENTATION_TEXT);
    expect(chunks).toHaveLength(6);
    expect(chunks.every(chunk => chunk.length <= 300)).toBe(true);
  });
  it('handles empty input and long unbroken text without exceeding the service limit', () => {
    expect(speechChunks('  ')).toEqual([]);
    const word = 'x'.repeat(601);
    const chunks = speechChunks(word);
    expect(chunks.map(chunk => chunk.length)).toEqual([300, 300, 1]);
    expect(chunks.join('')).toBe(word);
  });
});

// Deterministic wording for confirmed labels. No network, generated meaning or mock text.
import { glossFor, vocabLabels } from '../data';
import type { SentenceRequest, SentenceResponse } from '../types';

export function composeLocally(request: SentenceRequest): SentenceResponse {
  const supported = vocabLabels();
  if (!request.signs.length || request.signs.length > 5 || request.signs.some((s) => !supported.includes(s.label)))
    return { status: 'refused', reason: 'out_of_scope', sentence: null, needs_human: true };
  const parts = request.signs.map(({ label }) => {
    let text = glossFor(label, request.language);
    if (label === 'my_name') {
      const name = request.name?.trim().slice(0, 40);
      if (!name) return '';
      text = text.replace(/[….\s]+$/, '') + ' ' + name;
    }
    return text.trim();
  });
  if (parts.some((p) => !p)) return { status: 'refused', reason: 'out_of_scope', sentence: null, needs_human: true };
  const sentence = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1) + (/[.!?]$/.test(p) ? '' : '.')).join(' ');
  return { status: 'ok', sentence, language: request.language, needs_human: false };
}

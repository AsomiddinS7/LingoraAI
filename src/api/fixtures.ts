// Mock fixtures (brief section 8). Sentences are marked [PLACEHOLDER]; the team replaces them.
import type { Lang } from '../types';

export type Fixture =
  | 'success'
  | 'refused'
  | 'validation_error'
  | 'timeout'
  | 'upstream_error'
  | 'rate_limited'
  | 'cap_reached';

export const FIXTURES: Fixture[] = [
  'success',
  'refused',
  'validation_error',
  'timeout',
  'upstream_error',
  'rate_limited',
  'cap_reached',
];

/** One success sentence per language. {words} is filled with the glosses of the confirmed signs. */
export const SUCCESS_SENTENCE: Record<Lang, string> = {
  uz: '[PLACEHOLDER] {words}',
  ru: '[PLACEHOLDER] {words}',
  en: '[PLACEHOLDER] {words}',
};

export const SIMPLIFIED_PREFIX = '[PLACEHOLDER] ';

export const RATE_LIMIT_RETRY_AFTER_S = 10;

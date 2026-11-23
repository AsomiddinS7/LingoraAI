export type SpeechInputIssue = 'no_speech' | 'service_unavailable' | 'unsupported_language' | 'microphone_denied' | 'timeout' | 'failed';

export class SpeechInputError extends Error {
  constructor(readonly code: SpeechInputIssue, message: string) {
    super(message);
    this.name = 'SpeechInputError';
  }
}

/** Map known errors to translated guidance; never render arbitrary server error text. */
export function speechInputIssue(error: unknown): SpeechInputIssue {
  if (error instanceof SpeechInputError) return error.code;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'no-speech') return 'no_speech';
  if (code === 'not-allowed' || (error instanceof Error && error.name === 'NotAllowedError')) return 'microphone_denied';
  if (code === 'language-not-supported') return 'unsupported_language';
  if (code === 'timeout') return 'timeout';
  return 'failed';
}

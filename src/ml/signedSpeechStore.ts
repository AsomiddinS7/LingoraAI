import { useSyncExternalStore } from 'react';
import { createSequenceStore } from './sequenceStore';

/** A separate private collection: lesson vocabulary must never imply speech phrases. */
// Experimental calibration for the six existing phrase references, not a
// general sign-language accuracy threshold. User confirmation remains required.
export const signedSpeechStore = createSequenceStore({ maxDistance: 0.27 });
export function useSignedSpeechVersion() {
  return useSyncExternalStore(signedSpeechStore.subscribe, signedSpeechStore.version, signedSpeechStore.version);
}

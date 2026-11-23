import { useSyncExternalStore } from 'react';
import { createSequenceStore } from './sequenceStore';

/** A separate private collection: lesson vocabulary must never imply speech phrases. */
export const signedSpeechStore = createSequenceStore();
export function useSignedSpeechVersion() {
  return useSyncExternalStore(signedSpeechStore.subscribe, signedSpeechStore.version, signedSpeechStore.version);
}

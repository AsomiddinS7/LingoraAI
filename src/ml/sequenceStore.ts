// Private in-memory templates. Reloading clears them; no video, upload, localStorage or analytics.
import { useSyncExternalStore } from 'react';
import { compileTemplateDataset, matchSequence, parseInferenceDataset, TEMPLATE_FORMAT, type InferenceTemplate, type MatchingManifest, type MatchOptions, type SequenceFrame } from './sequence';

export function createSequenceStore() {
let templates: InferenceTemplate[] = [];
let matching: MatchingManifest | undefined;
let version = 0;
const listeners = new Set<() => void>();
function changed() { version++; listeners.forEach((l) => l()); }

const store = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  version: () => version,
  all: (): readonly InferenceTemplate[] => templates,
  counts(): Record<string, number> {
    const out: Record<string, number> = Object.create(null) as Record<string, number>;
    templates.forEach((t) => { if (!matching?.rejectionLabels?.includes(t.label)) out[t.label] = (out[t.label] ?? 0) + 1; });
    return out;
  },
  /** Replace rather than append by default: re-importing must not duplicate a recording. */
  importJson(text: string, allowedLabels?: readonly string[]): number {
    const parsed = parseInferenceDataset(text);
    const importedMatching = 'matching' in parsed ? parsed.matching : undefined;
    if (allowedLabels && parsed.templates.some((t) => !allowedLabels.includes(t.label)
      && !importedMatching?.rejectionLabels?.includes(t.label))) throw new Error('Template label is not in the supported vocabulary');
    templates = parsed.templates;
    matching = importedMatching;
    changed();
    return templates.length;
  },
  replace(next: readonly InferenceTemplate[]): number {
    // Editing a negative-reference dictionary must not turn its background label
    // into a word. Preserve that explicit policy but reset its distance profile,
    // including edits which keep the same reference IDs.
    const retained: MatchingManifest | undefined = matching?.rejectionLabels?.length
      ? { ...matching, profile: 'strict-dtw-v1' } : undefined;
    const payload = retained || next.some((t) => 'normalized' in t) ? compileTemplateDataset(next, retained)
      : { format: TEMPLATE_FORMAT, version: 1, templates: next };
    return this.importJson(JSON.stringify(payload));
  },
  exportJson: () => JSON.stringify(matching || templates.some((t) => 'normalized' in t) ? compileTemplateDataset(templates, matching)
    : { format: TEMPLATE_FORMAT, version: 1, templates }),
  clear() { templates = []; matching = undefined; changed(); },
  // Only the parsed compiled dictionary opts in; custom/raw imports and edits
  // reset this scope. The matcher itself checks exact declared label coverage.
  match(frames: SequenceFrame[], options?: MatchOptions) { return matchSequence(frames, templates, { ...options, matching }); },
};
return store;
}
export type SequenceStore = ReturnType<typeof createSequenceStore>;
export const sequenceStore = createSequenceStore();

export function useSequenceVersion(): number {
  return useSyncExternalStore(sequenceStore.subscribe, sequenceStore.version, sequenceStore.version);
}

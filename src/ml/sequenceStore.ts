// Private in-memory templates. Reloading clears them; no video, upload, localStorage or analytics.
import { useSyncExternalStore } from 'react';
import { compileTemplateDataset, matchSequence, normalizeSequence, parseInferenceDataset, TEMPLATE_FORMAT, type InferenceTemplate, type MatchingManifest, type MatchOptions, type SequenceFrame, type SequenceMatch } from './sequence';
import { motionSpan,referenceMotionFloor } from './motionGate.mjs';
import { parseTrainedSignModel, createTrainedMatcher, type TrainedSignModel } from './trainedSignModel';

export function createSequenceStore() {
let templates: InferenceTemplate[] = [];
let matching: MatchingManifest | undefined;
let motionFloors = {body:0,hands:0};
let trained: TrainedSignModel | null = null;
let trainedMatch: ReturnType<typeof createTrainedMatcher> | null = null;
let version = 0;
const listeners = new Set<() => void>();
function changed() { version++; listeners.forEach((l) => l()); }

const store = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  version: () => version,
  all: (): readonly InferenceTemplate[] => templates,
  isTrained: () => trained !== null,
  vocabulary: () => trained?.vocabulary ?? [],
  counts(): Record<string, number> {
    const out: Record<string, number> = Object.create(null) as Record<string, number>;
    templates.forEach((t) => { if (!matching?.rejectionLabels?.includes(t.label)) out[t.label] = (out[t.label] ?? 0) + 1; });
    return out;
  },
  /** Replace rather than append by default: re-importing must not duplicate a recording. */
  importJson(text: string, allowedLabels?: readonly string[]): number {
    if (text.length > 20_000_000) throw new Error('Model too large');
    const bundle = JSON.parse(text)?.format === 'lingora-trained-sign-bundle-v1' ? parseTrainedSignModel(text) : null;
    const parsed = bundle?.gallery ?? parseInferenceDataset(text);
    const importedMatching = 'matching' in parsed ? parsed.matching : undefined;
    if (allowedLabels && parsed.templates.some((t) => !allowedLabels.includes(t.label)
      && !importedMatching?.rejectionLabels?.includes(t.label))) throw new Error('Template label is not in the supported vocabulary');
    templates = parsed.templates;
    matching = importedMatching;
    trained = bundle;
    trainedMatch = bundle ? createTrainedMatcher(bundle) : null;
    const normalized=templates.map(t=>'normalized' in t?t.normalized:normalizeSequence(t.frames)).filter(t=>t!==null);
    motionFloors={body:referenceMotionFloor(normalized.filter(t=>t.reference==='body')),
      hands:referenceMotionFloor(normalized.filter(t=>t.reference==='hands'))};
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
  exportJson: () => JSON.stringify(trained ?? (matching || templates.some((t) => 'normalized' in t) ? compileTemplateDataset(templates, matching)
    : { format: TEMPLATE_FORMAT, version: 1, templates })),
  clear() { templates = []; matching = undefined; trained = null; trainedMatch = null; motionFloors={body:0,hands:0}; changed(); },
  // Only the parsed compiled dictionary opts in; custom/raw imports and edits
  // reset this scope. The matcher itself checks exact declared label coverage.
  match(frames: SequenceFrame[], options?: MatchOptions): SequenceMatch {
    if (trainedMatch) return trainedMatch(frames);
    if(templates.length){
      const normalized=normalizeSequence(frames,options?.frames);
      if(normalized&&motionSpan(normalized)+1e-8<motionFloors[normalized.reference])
        return {label:'none',confidence:0,alternatives:[],distance:Infinity,reason:'insufficient_motion'};
    }
    return matchSequence(frames, templates, { ...options, matching });
  },
};
return store;
}
export type SequenceStore = ReturnType<typeof createSequenceStore>;
export const sequenceStore = createSequenceStore();

export function useSequenceVersion(): number {
  return useSyncExternalStore(sequenceStore.subscribe, sequenceStore.version, sequenceStore.version);
}

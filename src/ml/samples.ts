// Training samples: hand landmark features only (never video), kept in memory for this tab.
// Export/import as a JSON file so the team can keep and share a dataset with consent.
import { useSyncExternalStore } from 'react';
import { FEATURE_DIM } from './features';
import { buildModel, type KnnModel, type Sample } from './knn';

let samples: Sample[] = [];
let model: KnnModel = buildModel([]);
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  model = buildModel(samples);
  version++;
  listeners.forEach((l) => l());
}

export const sampleStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
  all: () => samples,
  model: () => model,
  counts(): Record<string, { frames: number; takes: number }> {
    const out: Record<string, { frames: number; takes: number; set: Set<string> }> = {};
    for (const s of samples) {
      out[s.label] ??= { frames: 0, takes: 0, set: new Set() };
      out[s.label].frames++;
      out[s.label].set.add(s.take);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { frames: v.frames, takes: v.set.size }]));
  },
  addTake(label: string, vecs: number[][]) {
    const take = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    samples = [...samples, ...vecs.map((vec) => ({ label, vec, take }))];
    changed();
  },
  clear(label?: string) {
    samples = label ? samples.filter((s) => s.label !== label) : [];
    changed();
  },
  exportJson(): string {
    return JSON.stringify({ format: 'signconnect-landmarks', version: 1, featureDim: FEATURE_DIM, samples });
  },
  importJson(text: string, allowedLabels: string[]): number {
    const data = JSON.parse(text) as { format?: string; featureDim?: number; samples?: Sample[] };
    if (data.format !== 'signconnect-landmarks' || data.featureDim !== FEATURE_DIM || !Array.isArray(data.samples))
      throw new Error('Not a SignConnect landmark file');
    const ok = data.samples.filter(
      (s) => allowedLabels.includes(s.label) && typeof s.take === 'string' && Array.isArray(s.vec) && s.vec.length === FEATURE_DIM && s.vec.every(Number.isFinite),
    );
    samples = [...samples, ...ok];
    changed();
    return ok.length;
  },
};

export function useSampleVersion(): number {
  return useSyncExternalStore(sampleStore.subscribe, sampleStore.version);
}

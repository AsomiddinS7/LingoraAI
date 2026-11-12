// k-nearest-neighbour sign classifier over landmark features. Trained only on samples the user
// records; it claims nothing about signs it has not seen.

export interface Sample {
  label: string;
  vec: number[];
  /** Recording id: frames of one recording are near-duplicates, so evaluation holds out whole takes. */
  take: string;
}

export interface Prediction {
  label: string; // 'none' when nothing is close enough
  confidence: number; // 0..1
  distance: number;
}

function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

export interface KnnModel {
  samples: Sample[];
  /** Typical distance between a sample and its nearest neighbour of the same sign. */
  typical: number;
  /** Beyond this nearest distance the hand pose counts as unknown ('none'). */
  maxDist: number;
}

/** Calibrates the distance scale from the training data itself (no hand-tuned magic numbers). */
export function buildModel(samples: Sample[]): KnnModel {
  if (samples.length === 0) return { samples, typical: 0, maxDist: 0 };
  // Nearest same-label neighbour from a DIFFERENT take, on a subsample for speed.
  const step = Math.max(1, Math.floor(samples.length / 300));
  const ds: number[] = [];
  for (let i = 0; i < samples.length; i += step) {
    let best = Infinity;
    for (const o of samples) {
      if (o.label !== samples[i].label || o.take === samples[i].take) continue;
      best = Math.min(best, dist2(samples[i].vec, o.vec));
    }
    if (best < Infinity) ds.push(Math.sqrt(best));
  }
  ds.sort((a, b) => a - b);
  // With a single take per sign there is no cross-take distance; fall back to a conservative scale.
  const typical = ds.length ? ds[Math.floor(ds.length * 0.9)] : 0.35;
  return { samples, typical: Math.max(typical, 0.05), maxDist: Math.max(typical, 0.05) * 2.5 };
}

export function predict(model: KnnModel, vec: number[], k = 5, exclude?: (s: Sample) => boolean): Prediction {
  const nearest: { d: number; label: string }[] = [];
  for (const s of model.samples) {
    if (exclude?.(s)) continue;
    const d = dist2(vec, s.vec);
    if (nearest.length < k) {
      nearest.push({ d, label: s.label });
      nearest.sort((a, b) => a.d - b.d);
    } else if (d < nearest[k - 1].d) {
      nearest[k - 1] = { d, label: s.label };
      nearest.sort((a, b) => a.d - b.d);
    }
  }
  if (nearest.length === 0) return { label: 'none', confidence: 0, distance: Infinity };

  const votes = new Map<string, number>();
  let total = 0;
  for (const n of nearest) {
    const w = 1 / (Math.sqrt(n.d) + 1e-3);
    votes.set(n.label, (votes.get(n.label) ?? 0) + w);
    total += w;
  }
  let label = '';
  let best = -1;
  for (const [l, w] of votes) if (w > best) [label, best] = [l, w];
  const dMin = Math.sqrt(nearest.find((n) => n.label === label)!.d);
  if (dMin > model.maxDist) return { label: 'none', confidence: 0, distance: dMin };

  // Confidence = vote share x closeness (1 inside the typical spread, falling to 0 at maxDist).
  const closeness = dMin <= model.typical ? 1 : 1 - (dMin - model.typical) / (model.maxDist - model.typical);
  return { label, confidence: (best / total) * Math.max(0, closeness), distance: dMin };
}

export interface Evaluation {
  /** Fraction of held-out frames classified correctly (counting 'none' or below-threshold as wrong). */
  accuracy: number;
  /** 95% Wilson interval over held-out takes. */
  interval: [number, number];
  perLabelRecall: Record<string, number>;
  frames: number;
  takes: number;
}

function wilson(p: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Leave-one-take-out: each recording is classified by a model trained on all OTHER recordings.
 * Only labels with at least 2 takes can be evaluated. Same signer, so this is an optimistic
 * number; it is NOT the brief's "signer not in training" result.
 */
export function evaluate(samples: Sample[], threshold: number): Evaluation | null {
  const takesByLabel = new Map<string, Set<string>>();
  for (const s of samples) {
    if (!takesByLabel.has(s.label)) takesByLabel.set(s.label, new Set());
    takesByLabel.get(s.label)!.add(s.take);
  }
  const evalLabels = [...takesByLabel].filter(([, t]) => t.size >= 2).map(([l]) => l);
  if (evalLabels.length === 0) return null;

  const takes = [...new Set(samples.filter((s) => evalLabels.includes(s.label)).map((s) => s.take))];
  let correct = 0;
  let frames = 0;
  let takeCorrect = 0;
  const hit: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const take of takes) {
    const train = samples.filter((s) => s.take !== take);
    const model = buildModel(train);
    const test = samples.filter((s) => s.take === take);
    let ok = 0;
    for (const s of test) {
      const p = predict(model, s.vec);
      const right = p.label === s.label && p.confidence >= threshold;
      if (right) ok++;
      hit[s.label] = (hit[s.label] ?? 0) + (right ? 1 : 0);
      seen[s.label] = (seen[s.label] ?? 0) + 1;
    }
    correct += ok;
    frames += test.length;
    takeCorrect += ok / test.length;
  }
  const perLabelRecall: Record<string, number> = {};
  for (const l of Object.keys(seen)) perLabelRecall[l] = hit[l] / seen[l];
  const accuracy = correct / frames;
  return { accuracy, interval: wilson(takeCorrect / takes.length, takes.length), perLabelRecall, frames, takes: takes.length };
}

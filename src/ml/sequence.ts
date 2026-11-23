// Local temporal template matching. A similarity score is NOT a calibrated probability
// or evidence of signer-independent Uzbek sign-language accuracy.
import type { Landmark } from './features';
import type { RecognitionResult } from '../recognition/types';

export interface SequenceFrame {
  /** Monotonic milliseconds, relative to the clip or performance.now(). */
  t: number;
  left: Landmark[] | null;
  right: Landmark[] | null;
  /** Full MediaPipe pose (33), or [nose, L/R shoulder, L/R elbow, L/R wrist] (7). */
  pose?: Landmark[] | null;
  /** Image width / height. Use the same convention offline and in the browser. */
  aspect?: number;
}

export interface MotionTemplate {
  id: string;
  label: string;
  frames: SequenceFrame[];
  source?: {
    kind: 'recording' | 'lesson' | 'other';
    name?: string;
    /** Provenance, not a consent inference made by the matcher. */
    permission?: string;
  };
}

export interface TemplateDataset {
  format: 'lingora-motion-templates';
  version: 1;
  templates: MotionTemplate[];
}

export interface NormalizedSequence {
  /** Two slots, each [present, 21 * xyz]. Coordinates share one origin and scale. */
  vectors: number[][];
  reference: 'body' | 'hands';
  durationMs: number;
  handCoverage: number;
}

/** Derived inference data: no raw landmarks, source filenames or absolute timestamps. */
export interface CompiledTemplate {
  id: string;
  label: string;
  normalized: NormalizedSequence;
}

export type InferenceTemplate = MotionTemplate | CompiledTemplate;

/** An explicitly reviewed dictionary, never inferred from a partial/custom gallery. */
export interface MatchingManifest {
  profile: 'visibility-aware-dtw-v1' | 'strict-dtw-v1';
  labels: string[];
  templateIds: string[];
  /** Background references compete for rejection but are never translatable. */
  rejectionLabels?: string[];
}

export interface MotionModel {
  format: 'lingora-motion-model';
  /** v2 prevents older clients from discarding matching/rejection policies. */
  version: 1 | 2;
  feature_version: 'two-hand-body-v2';
  input_frames: 32;
  feature_dim: 128;
  templates: CompiledTemplate[];
  matching?: MatchingManifest;
}

export interface SequenceMatch extends RecognitionResult {
  distance: number;
  reason: 'matched' | 'no_templates' | 'insufficient_tracking' | 'no_compatible_templates' | 'too_distant' | 'ambiguous' | 'background_reference';
  templateId?: string;
}

export interface MatchOptions {
  /** Starting engineering threshold; tune using independent, labeled recordings. */
  maxDistance?: number;
  minMargin?: number;
  maxRatio?: number;
  frames?: number;
  /** Opt in only for a declared complete dictionary; absent means legacy strict DTW. */
  matching?: MatchingManifest;
}

export const TEMPLATE_FORMAT = 'lingora-motion-templates' as const;
export const MOTION_MODEL_FORMAT = 'lingora-motion-model' as const;
export const SEQUENCE_FRAMES = 32;
export const SEQUENCE_FEATURE_DIM = 128;
export const TEMPLATE_LIMITS = { bytes: 20_000_000, templates: 128, framesPerTemplate: 900, totalFrames: 30_000 } as const;
const HAND_DIM = 64;

function finitePoint(value: unknown): value is Landmark {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['x', 'y', 'z'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && Math.abs(p[k] as number) <= 20);
}

function validHand(hand: unknown): hand is Landmark[] {
  return Array.isArray(hand) && hand.length === 21 && hand.every(finitePoint);
}

function validPose(pose: unknown): pose is Landmark[] {
  return Array.isArray(pose) && (pose.length === 7 || pose.length === 33) && pose.every(finitePoint);
}

function validFrame(frame: unknown): frame is SequenceFrame {
  if (!frame || typeof frame !== 'object') return false;
  const f = frame as Record<string, unknown>;
  return typeof f.t === 'number' && Number.isFinite(f.t) && Math.abs(f.t) < 1e12
    && (f.left === null || validHand(f.left)) && (f.right === null || validHand(f.right))
    && (f.pose === undefined || f.pose === null || validPose(f.pose))
    && (f.aspect === undefined || (typeof f.aspect === 'number' && Number.isFinite(f.aspect) && f.aspect >= 0.1 && f.aspect <= 10));
}

function validFrames(frames: unknown): frames is SequenceFrame[] {
  return Array.isArray(frames) && frames.length >= 5 && frames.length <= TEMPLATE_LIMITS.framesPerTemplate
    && frames.every((f, i) => validFrame(f) && (i === 0 || f.t > frames[i - 1].t))
    && frames[frames.length - 1].t - frames[0].t >= 120
    && frames[frames.length - 1].t - frames[0].t <= 20_000;
}

function shoulderReference(f: SequenceFrame): { x: number; y: number; scale: number } | null {
  if (!f.pose) return null;
  const l = f.pose[f.pose.length === 33 ? 11 : 1];
  const r = f.pose[f.pose.length === 33 ? 12 : 2];
  const aspect = f.aspect ?? 1;
  const scale = Math.hypot((l.x - r.x) * aspect, l.y - r.y);
  if (scale < 0.025) return null;
  return { x: (l.x + r.x) * aspect / 2, y: (l.y + r.y) / 2, scale };
}

/**
 * Never normalizes the two hands independently: their separation, body location,
 * orientation and path over time are part of the signal. Body and hand-only
 * references are deliberately incompatible during matching.
 */
export function normalizeSequence(frames: SequenceFrame[], count = SEQUENCE_FRAMES): NormalizedSequence | null {
  if (!validFrames(frames) || !Number.isInteger(count) || count < 8 || count > 96) return null;
  const seen = frames.filter((f) => f.left || f.right);
  const handCoverage = seen.length / frames.length;
  if (handCoverage < 0.65) return null;
  const refs = frames.map(shoulderReference);
  const bodyRefs = refs.filter((r): r is NonNullable<typeof r> => r !== null);
  const reference = bodyRefs.length / frames.length >= 0.7 ? 'body' : 'hands';
  const allPoints = frames.flatMap((f) => [...(f.left ?? []), ...(f.right ?? [])].map((p) => ({ x: p.x * (f.aspect ?? 1), y: p.y })));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of allPoints) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const fallback = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: Math.max(maxX - minX, maxY - minY) };
  if (fallback.scale < 0.01) return null;
  // Short pose dropouts use the closest valid body reference, not a change of coordinates.
  const referenceAt = (i: number) => {
    if (reference === 'hands') return fallback;
    if (refs[i]) return refs[i]!;
    for (let d = 1; d < frames.length; d++) {
      if (refs[i - d]) return refs[i - d]!;
      if (refs[i + d]) return refs[i + d]!;
    }
    return fallback;
  };
  const raw = frames.map((f, i) => {
    const ref = referenceAt(i);
    const out: number[] = [];
    for (const hand of [f.left, f.right]) {
      if (!hand) { out.push(...new Array<number>(HAND_DIM).fill(0)); continue; }
      out.push(1);
      for (const p of hand) {
        // MediaPipe hand z is wrist-local and uses the same width-relative scale
        // as x. Convert both x and z to image-height units before body scaling,
        // so a landscape reference and a portrait camera remain comparable.
        const aspect = f.aspect ?? 1;
        out.push((p.x * aspect - ref.x) / ref.scale, (p.y - ref.y) / ref.scale, (p.z - hand[0].z) * aspect / ref.scale);
      }
    }
    return out;
  });
  const durationMs = frames[frames.length - 1].t - frames[0].t;
  let cursor = 0;
  const vectors = Array.from({ length: count }, (_, i) => {
    const t = frames[0].t + durationMs * i / (count - 1);
    while (cursor < frames.length - 2 && frames[cursor + 1].t < t) cursor++;
    const alpha = Math.max(0, Math.min(1, (t - frames[cursor].t) / (frames[cursor + 1].t - frames[cursor].t)));
    const out: number[] = [];
    for (let h = 0; h < 2; h++) {
      const offset = h * HAND_DIM;
      const a = raw[cursor].slice(offset, offset + HAND_DIM);
      const b = raw[cursor + 1].slice(offset, offset + HAND_DIM);
      // A missing hand remains a missing hand; interpolate only real detections.
      out.push(...(a[0] && b[0] ? a.map((v, n) => n ? v + (b[n] - v) * alpha : 1) : (alpha < 0.5 ? a : b)));
    }
    return out;
  });
  return { vectors, reference, durationMs, handCoverage };
}

function frameDistance(a: number[], b: number[]): number {
  let sum = 0;
  let hands = 0;
  for (let h = 0; h < 2; h++) {
    const off = h * HAND_DIM;
    if (!a[off] && !b[off]) continue;
    hands++;
    if (!a[off] || !b[off]) { sum += 0.9; continue; }
    let d = 0;
    for (let n = 1; n < HAND_DIM; n++) d += (a[off + n] - b[off + n]) ** 2;
    sum += Math.sqrt(d / 63);
  }
  return hands ? sum / hands : 0;
}

/** Bounded dynamic time warping, with forced endpoints so reversed paths do not match. */
export function sequenceDistance(a: NormalizedSequence, b: NormalizedSequence): number {
  if (a.reference !== b.reference) return Infinity;
  const n = a.vectors.length, m = b.vectors.length;
  const band = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * 0.25));
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const length = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const choices = [[i - 1, j - 1], [i - 1, j], [i, j - 1]];
      let [pi, pj] = choices[0];
      for (const [ci, cj] of choices) if (cost[ci][cj] < cost[pi][pj]) [pi, pj] = [ci, cj];
      cost[i][j] = cost[pi][pj] + frameDistance(a.vectors[i - 1], b.vectors[j - 1]);
      length[i][j] = length[pi][pj] + 1;
    }
  }
  const durationPenalty = Math.min(0.1, Math.abs(Math.log(a.durationMs / b.durationMs)) * 0.04);
  return cost[n][m] / Math.max(1, length[n][m]) + durationPenalty;
}

/** Missing detections are censored evidence; no coordinates are invented. */
export function visibilityAwareSequenceDistance(a: NormalizedSequence, b: NormalizedSequence): number {
  if (a.reference !== b.reference) return Infinity;
  const n = a.vectors.length, m = b.vectors.length;
  const band = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * 0.25));
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const length = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  const opportunities = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
    let shared = 0, possible = 0, missing = 0, geometry = 0;
    for (const offset of [0, HAND_DIM]) {
      const av = a.vectors[i - 1], bv = b.vectors[j - 1];
      if (!av[offset] && !bv[offset]) continue;
      possible++;
      if (!av[offset] || !bv[offset]) { missing++; continue; }
      shared++;
      let squared = 0;
      for (let k = 1; k < HAND_DIM; k++) squared += (av[offset + k] - bv[offset + k]) ** 2;
      geometry += Math.sqrt(squared / 63);
    }
    // Keep the same observed-joint RMSE. A disagreement gets a fixed visibility
    // cost; two unobserved frames cannot create a zero-cost alignment shortcut.
    const distance = shared ? geometry / shared + 0.22 * missing / possible : 0.44;
    const choices = [[i - 1, j - 1], [i - 1, j], [i, j - 1]];
    let [pi, pj] = choices[0];
    for (const [ci, cj] of choices) if (cost[ci][cj] < cost[pi][pj]) [pi, pj] = [ci, cj];
    cost[i][j] = cost[pi][pj] + distance;
    length[i][j] = length[pi][pj] + 1;
    common[i][j] = common[pi][pj] + shared;
    opportunities[i][j] = opportunities[pi][pj] + Math.max(possible, 1);
  }
  if (common[n][m] / Math.max(1, opportunities[n][m]) < 0.6) return Infinity;
  const durationPenalty = Math.min(0.1, Math.abs(Math.log(a.durationMs / b.durationMs)) * 0.04);
  return cost[n][m] / Math.max(1, length[n][m]) + durationPenalty;
}

function validMatchingManifest(value: unknown): value is MatchingManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  if (!['visibility-aware-dtw-v1', 'strict-dtw-v1'].includes(manifest.profile as string)
    || !Array.isArray(manifest.labels) || !manifest.labels.length || manifest.labels.length > TEMPLATE_LIMITS.templates
    || !manifest.labels.every((label) => shortString(label, 100) && label !== 'none')
    || new Set(manifest.labels).size !== manifest.labels.length
    || !Array.isArray(manifest.templateIds) || !manifest.templateIds.length || manifest.templateIds.length > TEMPLATE_LIMITS.templates
    || !manifest.templateIds.every((id) => shortString(id)) || new Set(manifest.templateIds).size !== manifest.templateIds.length) return false;
  return manifest.rejectionLabels === undefined || (Array.isArray(manifest.rejectionLabels)
    && manifest.rejectionLabels.length <= manifest.labels.length
    && manifest.rejectionLabels.every((label) => shortString(label, 100) && (manifest.labels as string[]).includes(label))
    && new Set(manifest.rejectionLabels).size === manifest.rejectionLabels.length);
}

function completeMatchingGallery(manifest: MatchingManifest | undefined, templates: readonly InferenceTemplate[]): boolean {
  if (!validMatchingManifest(manifest) || manifest.profile !== 'visibility-aware-dtw-v1') return false;
  const declared = new Set(manifest.labels), actual = new Set(templates.map((template) => template.label));
  const declaredIds = new Set(manifest.templateIds), actualIds = new Set(templates.map((template) => template.id));
  return declared.size === manifest.labels.length && declared.size === actual.size && [...actual].every((label) => declared.has(label))
    && declaredIds.size === manifest.templateIds.length && actualIds.size === templates.length
    && declaredIds.size === actualIds.size && [...actualIds].every((id) => declaredIds.has(id));
}

export function matchSequence(frames: SequenceFrame[], templates: readonly InferenceTemplate[], options: MatchOptions = {}): SequenceMatch {
  const reject = (reason: SequenceMatch['reason'], distance = Infinity, alternatives: RecognitionResult['alternatives'] = []): SequenceMatch => ({ label: 'none', confidence: 0, distance, alternatives, reason });
  if (!templates.length) return reject('no_templates');
  const query = normalizeSequence(frames, options.frames);
  if (!query) return reject('insufficient_tracking');
  const maxDistance = options.maxDistance ?? 0.22;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return reject('too_distant');
  const byLabel = new Map<string, { label: string; id: string; distance: number }>();
  const normalizedTemplates = templates.map((template) => 'normalized' in template ? template.normalized : normalizeSequence(template.frames, options.frames));
  const profileComplete = completeMatchingGallery(options.matching, templates)
    && normalizedTemplates.every((normalized) => normalized?.reference === query.reference);
  const distanceFunction = profileComplete ? visibilityAwareSequenceDistance : sequenceDistance;
  for (let i = 0; i < templates.length; i++) {
    const template = templates[i], normalized = normalizedTemplates[i];
    if (!normalized || normalized.reference !== query.reference) continue;
    const distance = distanceFunction(query, normalized);
    if (distance < (byLabel.get(template.label)?.distance ?? Infinity)) byLabel.set(template.label, { label: template.label, id: template.id, distance });
  }
  const ranked = [...byLabel.values()].sort((a, b) => a.distance - b.distance);
  if (!ranked.length) return reject('no_compatible_templates');
  const score = (d: number) => Math.max(0, 1 - d / maxDistance);
  // Rejection semantics remain valid even when a partial/edited gallery falls
  // back to strict distance. Background references still affect ambiguity.
  const rejectionLabels = new Set(validMatchingManifest(options.matching) ? options.matching.rejectionLabels ?? [] : []);
  const alternatives = ranked.slice(1).filter((r) => !rejectionLabels.has(r.label)).slice(0, 2).map((r) => ({ label: r.label, confidence: score(r.distance) }));
  const first = ranked[0], second = ranked[1];
  if (rejectionLabels.has(first.label)) return reject('background_reference', first.distance, alternatives);
  if (first.distance > maxDistance) return reject('too_distant', first.distance, alternatives);
  if (second && (second.distance - first.distance < (options.minMargin ?? 0.025)
    || first.distance / Math.max(second.distance, 1e-9) > (options.maxRatio ?? 0.85))) return reject('ambiguous', first.distance, alternatives);
  return { label: first.label, confidence: score(first.distance), distance: first.distance, alternatives, reason: 'matched', templateId: first.id };
}

function shortString(v: unknown, max = 160): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
}

/** Strict, bounded import. Never accepts HTML, executable modules, or invented labels. */
export function parseTemplateDataset(text: string): TemplateDataset {
  if (text.length > TEMPLATE_LIMITS.bytes || new TextEncoder().encode(text).byteLength > TEMPLATE_LIMITS.bytes) throw new Error('Motion template file is too large');
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('Invalid motion template file');
  const d = data as Record<string, unknown>;
  if (d.format !== TEMPLATE_FORMAT || d.version !== 1 || !Array.isArray(d.templates) || d.templates.length > TEMPLATE_LIMITS.templates) throw new Error('Unsupported motion template format');
  const ids = new Set<string>();
  let totalFrames = 0;
  const templates: MotionTemplate[] = d.templates.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid motion template');
    const t = value as Record<string, unknown>;
    if (!shortString(t.id) || ids.has(t.id) || !shortString(t.label, 100) || t.label === 'none' || !validFrames(t.frames)) throw new Error('Invalid template id, label or frames');
    ids.add(t.id);
    totalFrames += t.frames.length;
    if (totalFrames > TEMPLATE_LIMITS.totalFrames) throw new Error('Too many motion frames');
    let source: MotionTemplate['source'];
    if (t.source !== undefined) {
      if (!t.source || typeof t.source !== 'object') throw new Error('Invalid template source');
      const s = t.source as Record<string, unknown>;
      if (!['recording', 'lesson', 'other'].includes(s.kind as string)
        || (s.name !== undefined && !shortString(s.name, 300)) || (s.permission !== undefined && !shortString(s.permission, 1000))) throw new Error('Invalid template source');
      source = { kind: s.kind as NonNullable<MotionTemplate['source']>['kind'], ...(s.name !== undefined ? { name: s.name as string } : {}), ...(s.permission !== undefined ? { permission: s.permission as string } : {}) };
    }
    // Explicitly copy schema fields so imported extra properties never enter app state.
    const frames = t.frames.map((f) => ({ t: f.t, left: f.left?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? null, right: f.right?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? null,
      ...(f.pose ? { pose: f.pose.map((p) => ({ x: p.x, y: p.y, z: p.z })) } : {}), ...(f.aspect !== undefined ? { aspect: f.aspect } : {}) }));
    return { id: t.id, label: t.label, frames, ...(source ? { source } : {}) };
  });
  return { format: TEMPLATE_FORMAT, version: 1, templates };
}

function parseBoundedJson(text: string): Record<string, unknown> {
  if (text.length > TEMPLATE_LIMITS.bytes || new TextEncoder().encode(text).byteLength > TEMPLATE_LIMITS.bytes)
    throw new Error('Motion model file is too large');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid motion model');
  return value as Record<string, unknown>;
}

function copyNormalized(value: unknown): NormalizedSequence {
  if (!value || typeof value !== 'object') throw new Error('Invalid normalized sequence');
  const n = value as Record<string, unknown>;
  if ((n.reference !== 'body' && n.reference !== 'hands')
    || typeof n.durationMs !== 'number' || !Number.isFinite(n.durationMs) || n.durationMs < 120 || n.durationMs > 20000
    || typeof n.handCoverage !== 'number' || !Number.isFinite(n.handCoverage) || n.handCoverage < 0.65 || n.handCoverage > 1
    || !Array.isArray(n.vectors) || n.vectors.length !== SEQUENCE_FRAMES) throw new Error('Invalid normalized metadata');
  const vectors = n.vectors.map((vector: unknown) => {
    if (!Array.isArray(vector) || vector.length !== SEQUENCE_FEATURE_DIM
      || !vector.every((v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 4000))
      throw new Error('Invalid normalized vector dimensions or values');
    for (const offset of [0, HAND_DIM]) {
      if (vector[offset] !== 0 && vector[offset] !== 1) throw new Error('Invalid hand presence mask');
      if (vector[offset] === 0 && vector.slice(offset + 1, offset + HAND_DIM).some((v) => v !== 0))
        throw new Error('Missing hand must have zero coordinates');
    }
    return vector.slice() as number[];
  });
  if (!vectors.some((v) => v[0] || v[HAND_DIM])) throw new Error('Motion model contains no tracked hands');
  return { vectors, reference: n.reference, durationMs: n.durationMs, handCoverage: n.handCoverage };
}

/** Strict schema copy prevents source data or executable fields entering a compiled model. */
export function parseMotionModel(text: string): MotionModel {
  const model = parseBoundedJson(text);
  if (model.format !== MOTION_MODEL_FORMAT || (model.version !== 1 && model.version !== 2) || model.feature_version !== 'two-hand-body-v2'
    || model.input_frames !== SEQUENCE_FRAMES || model.feature_dim !== SEQUENCE_FEATURE_DIM
    || !Array.isArray(model.templates) || model.templates.length > TEMPLATE_LIMITS.templates)
    throw new Error('Unsupported motion model format');
  if (model.matching !== undefined && model.version !== 2) throw new Error('Matching policies require motion model version 2');
  if (model.version === 2 && model.matching === undefined) throw new Error('Motion model version 2 requires a matching policy');
  const ids = new Set<string>();
  const templates = model.templates.map((value: unknown): CompiledTemplate => {
    if (!value || typeof value !== 'object') throw new Error('Invalid compiled template');
    const item = value as Record<string, unknown>;
    if (!shortString(item.id) || ids.has(item.id) || !shortString(item.label, 100) || item.label === 'none')
      throw new Error('Invalid compiled template id or label');
    ids.add(item.id);
    return { id: item.id, label: item.label, normalized: copyNormalized(item.normalized) };
  });
  let matching: MatchingManifest | undefined;
  if (model.matching !== undefined) {
    if (!validMatchingManifest(model.matching)) throw new Error('Invalid matching manifest');
    const value = model.matching;
    matching = { profile: value.profile, labels: value.labels.slice(), templateIds: value.templateIds.slice(),
      ...(value.rejectionLabels !== undefined ? { rejectionLabels: value.rejectionLabels.slice() } : {}) };
  }
  return { format: MOTION_MODEL_FORMAT, version: model.version, feature_version: 'two-hand-body-v2',
    input_frames: SEQUENCE_FRAMES, feature_dim: SEQUENCE_FEATURE_DIM, templates, ...(matching ? { matching } : {}) };
}

/** Compile once for deployment; matching uses exactly the same normalized values. */
export function compileTemplateDataset(input: TemplateDataset | MotionModel | readonly InferenceTemplate[], matching?: MatchingManifest): MotionModel {
  const templates: readonly InferenceTemplate[] = Array.isArray(input)
    ? input as readonly InferenceTemplate[] : (input as TemplateDataset | MotionModel).templates;
  const container = Array.isArray(input) ? undefined : input as TemplateDataset | MotionModel;
  const manifest = matching ?? (container && 'matching' in container ? container.matching : undefined);
  const compiled = templates.map((template): CompiledTemplate => {
    const normalized = 'normalized' in template ? template.normalized : normalizeSequence(template.frames);
    if (!normalized) throw new Error(`Insufficient tracking for template ${template.id}`);
    return { id: template.id, label: template.label, normalized };
  });
  return parseMotionModel(JSON.stringify({ format: MOTION_MODEL_FORMAT, version: manifest ? 2 : 1,
    feature_version: 'two-hand-body-v2', input_frames: SEQUENCE_FRAMES, feature_dim: SEQUENCE_FEATURE_DIM, templates: compiled,
    ...(manifest ? { matching: manifest } : {}) }));
}

export function parseInferenceDataset(text: string): TemplateDataset | MotionModel {
  const data = parseBoundedJson(text);
  return data.format === MOTION_MODEL_FORMAT ? parseMotionModel(text) : parseTemplateDataset(text);
}

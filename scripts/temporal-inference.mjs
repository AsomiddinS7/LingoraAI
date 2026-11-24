// Portable research-model inference. This module never changes the active recognizer.
const WIDTH = 32, FRAMES = 32, FEATURES = 128;
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10000;
function array(value, shape) {
  if (!shape.length) { if (!finite(value)) throw new Error('Invalid model number'); return value; }
  if (!Array.isArray(value) || value.length !== shape[0]) throw new Error('Invalid model dimensions');
  return value.map(item => array(item, shape.slice(1)));
}
export function parseTemporalCandidate(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Candidate model exceeds size limit');
  const raw = JSON.parse(text);
  if (raw.format !== 'lingora-temporal-candidate-v1' || raw.feature_version !== 'two-hand-body-v2'
    || JSON.stringify(raw.architecture?.input_shape) !== '[32,128]' || raw.architecture?.width !== WIDTH
    || raw.architecture.activation !== 'gelu_tanh_approximation' || raw.architecture.gelu_cubic !== .044715
    || raw.architecture.temporal_conv?.kernel !== 3 || raw.architecture.temporal_conv?.padding !== 1
    || raw.architecture.temporal_conv?.stride !== 1
    || raw.architecture.temporal_conv?.operation !== 'cross_correlation'
    || raw.architecture.temporal_conv?.layout !== '[kernel,input_channel,output_channel]'
    || raw.architecture.pool !== 'mean weighted by max(input[t,0], input[t,64]); denominator max(sum,1)'
    || raw.architecture.embedding !== 'L2 normalize pooled vector' || raw.architecture.normalization_epsilon !== 1e-8)
    throw new Error('Unsupported candidate architecture');
  const classes = raw.classes;
  if (!Array.isArray(classes) || classes.length < 2 || classes.length > 128 || new Set(classes).size !== classes.length
    || classes.some(label => typeof label !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(label) || label === 'none'))
    throw new Error('Invalid candidate classes');
  const weights = raw.weights;
  if (!weights || typeof weights !== 'object') throw new Error('Missing candidate weights');
  const prototypes = array(raw.prototypes, [classes.length, WIDTH]);
  if (prototypes.some(vector => Math.abs(Math.hypot(...vector) - 1) > .001)) throw new Error('Unnormalized class prototype');
  const rejection = raw.rejection;
  if (!finite(rejection?.distance_limit) || rejection.distance_limit <= 0 || rejection.distance_limit > 2
    || !finite(rejection.minimum_margin) || rejection.minimum_margin < 0 || rejection.minimum_margin > 2)
    throw new Error('Invalid rejection calibration');
  return { classes, prototypes, rejection: { distance_limit: rejection.distance_limit, minimum_margin: rejection.minimum_margin },
    weights: { input_weight: array(weights.input_weight, [FEATURES, WIDTH]), input_bias: array(weights.input_bias, [WIDTH]),
      position: array(weights.position, [FRAMES, WIDTH]), conv_weight: array(weights.conv_weight, [3, WIDTH, WIDTH]),
      conv_bias: array(weights.conv_bias, [WIDTH]) } };
}
const gelu = x => .5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + .044715 * x * x * x)));
export function inferTemporalCandidate(input, model) {
  if (!finite(input.handCoverage) || input.handCoverage < 0 || input.handCoverage > 1) throw new Error('Invalid tracking coverage');
  const vectors = array(input.vectors, [FRAMES, FEATURES]);
  if (vectors.some(frame => ![0, 1].includes(frame[0]) || ![0, 1].includes(frame[64]))) throw new Error('Invalid hand presence flags');
  const present = vectors.map(frame => Math.max(frame[0], frame[64]));
  const count = present.reduce((sum, value) => sum + value, 0);
  if (input.reference !== 'body' || input.handCoverage < .65 || count < FRAMES * .65)
    return { label: 'none', nearest_label: null, distance: null, margin: null, accepted: false, reason: 'insufficient_tracking' };
  const w = model.weights;
  const frameHidden = vectors.map((frame, time) => Array.from({ length: WIDTH }, (_, output) => {
    let sum = w.input_bias[output] + w.position[time][output];
    for (let feature = 0; feature < FEATURES; feature++) sum += frame[feature] * w.input_weight[feature][output];
    return gelu(sum);
  }));
  const pooled = new Array(WIDTH).fill(0);
  for (let time = 0; time < FRAMES; time++) for (let output = 0; output < WIDTH; output++) {
    let sum = frameHidden[time][output] + w.conv_bias[output];
    for (let kernel = 0; kernel < 3; kernel++) {
      const source = time + kernel - 1;
      if (source < 0 || source >= FRAMES) continue;
      for (let channel = 0; channel < WIDTH; channel++) sum += frameHidden[source][channel] * w.conv_weight[kernel][channel][output];
    }
    pooled[output] += gelu(sum) * present[time] / Math.max(count, 1);
  }
  const norm = Math.max(Math.hypot(...pooled), 1e-8);
  const embedding = pooled.map(value => value / norm);
  const similarities = model.prototypes.map((prototype, index) => ({ index,
    score: prototype.reduce((sum, value, channel) => sum + value * embedding[channel], 0) })).sort((a,b) => b.score - a.score);
  const distance = 1 - similarities[0].score, margin = similarities[0].score - similarities[1].score;
  const accepted = distance <= model.rejection.distance_limit && margin >= model.rejection.minimum_margin;
  return { label: accepted ? model.classes[similarities[0].index] : 'none', nearest_label: model.classes[similarities[0].index],
    distance, margin, accepted, reason: accepted ? 'matched' : 'rejected' };
}

/** Regression improvement alone does not establish new-signer accuracy. */
export function promotionGate(baseline, candidate) {
  const reasons = [];
  const fields = ['known_examples', 'correct_accepted', 'wrong_accepted', 'unknown_examples', 'unknown_wrong_accepted'];
  if ([baseline, candidate].some(metrics => !metrics || fields.some(key => !Number.isInteger(metrics[key]) || metrics[key] < 0)
    || metrics.correct_accepted + metrics.wrong_accepted > metrics.known_examples || metrics.unknown_wrong_accepted > metrics.unknown_examples))
    return { regressionGatePassed: false, productionPromotion: false, reasons: ['invalid_metrics'] };
  if (candidate.known_examples !== baseline.known_examples || candidate.unknown_examples !== baseline.unknown_examples)
    reasons.push('different_evaluation_examples');
  if (candidate.correct_accepted <= baseline.correct_accepted) reasons.push('no_strict_known_improvement');
  if (candidate.wrong_accepted > baseline.wrong_accepted) reasons.push('more_wrong_known_acceptances');
  if (candidate.unknown_wrong_accepted > baseline.unknown_wrong_accepted) reasons.push('more_unknown_acceptances');
  return { regressionGatePassed: !reasons.length, reasons,
    productionPromotion: false, note: 'Fresh independently labelled performances are still required for generalization claims.' };
}

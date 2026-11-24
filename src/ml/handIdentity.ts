import type { Landmark } from './features';

export interface HandCategory { label: string; score?: number }
type Slot = { wrist: Landmark; previous: Landmark | null; at: number; previousAt: number };
const MAX_AGE_MS = 300;

/** Only associates current observations. History never becomes an emitted hand. */
export function createHandAssociator() {
  let history: [Slot | null, Slot | null] = [null, null];
  return {
    reset() { history = [null, null]; },
    update(hands: Landmark[][], categories: HandCategory[], pose: Landmark[] | null,
      visibility: [number, number], at: number, aspect = 1) {
      const observations = hands.slice(0, 2);
      if (!observations.length) return { left: null, right: null };
      const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x-b.x)*aspect, a.y-b.y);
      const scale = Math.max(.05, pose ? distance(pose[1], pose[2]) : .25);
      const wrists = pose ? [pose[5], pose[6]] : [null, null];
      const closeWrists = wrists[0] && wrists[1] && distance(wrists[0], wrists[1]) < scale * .2;
      const cost = (hand: Landmark[], index: number, slot: number) => {
        const old = history[slot], age = old ? at-old.at : Infinity;
        const poseWeight = visibility[slot] >= .7 ? 1 : visibility[slot] >= .4 ? .5 : 0;
        let total = pose && visibility.some(v=>v>=.4) && !poseWeight ? .55 : 0;
        if (wrists[slot] && poseWeight) total += distance(hand[0], wrists[slot]!) / scale * poseWeight * (closeWrists ? .2 : 1);
        if (old && age >= 0 && age <= MAX_AGE_MS) {
          const delta = old.at-old.previousAt;
          const extrapolate = (key: 'x' | 'y') => {
            const velocity = old.previous && delta >= 20 && delta <= MAX_AGE_MS
              ? Math.max(-.002, Math.min(.002, (old.wrist[key]-old.previous[key])/delta)) : 0;
            return old.wrist[key] + velocity * Math.min(age, 160);
          };
          const predicted = { x: extrapolate('x'), y: extrapolate('y'), z: old.wrist.z };
          total += distance(hand[0], predicted) / scale * .65 * (1-age/MAX_AGE_MS);
        }
        const category = categories[index];
        if (category && category.label !== (slot === 0 ? 'Left' : 'Right'))
          total += (age >= 0 && age <= 200 ? .02 : .08) * Math.max(0, Math.min(1, category.score ?? .8));
        return total;
      };
      let left: Landmark[] | null = null, right: Landmark[] | null = null;
      if (observations.length === 2) {
        const straight = cost(observations[0],0,0)+cost(observations[1],1,1);
        const swapped = cost(observations[0],0,1)+cost(observations[1],1,0);
        [left,right] = straight <= swapped ? observations : [observations[1],observations[0]];
      } else if (cost(observations[0],0,0) <= cost(observations[0],0,1)) left = observations[0];
      else right = observations[0];
      for (const [slot, observed] of [[0,left],[1,right]] as const) if (observed) {
        const old = history[slot];
        history[slot] = { wrist: { ...observed[0] }, previous: old && at-old.at <= MAX_AGE_MS ? old.wrist : null,
          previousAt: old?.at ?? at, at };
      }
      return { left, right };
    },
  };
}

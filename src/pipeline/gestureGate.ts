// Stops the same gesture from being recognized again and again while the signer holds it.
// A held sign produces one event. The same sign counts again only after the hands drop
// ('none'), a different sign is seen, or the cooldown has passed.

export interface GateEvent {
  label: string;
  confidence: number;
}

export function createGestureGate(cooldownMs = 2000) {
  let last: { label: string; at: number } | null = null;

  return {
    /** true = pass the event on; false = suppress it as a repeat. */
    accept(e: GateEvent, now: number): boolean {
      if (e.label === 'none') {
        last = null; // hands down or unclear: the next sign is new
        return true;
      }
      if (last && last.label === e.label && now - last.at < cooldownMs) {
        last.at = now; // still holding the same sign: keep suppressing
        return false;
      }
      last = { label: e.label, at: now };
      return true;
    },
    reset() {
      last = null;
    },
  };
}

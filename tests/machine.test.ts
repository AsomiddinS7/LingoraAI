// State machine tests (brief section 10).
import { describe, expect, it } from 'vitest';
import { initialState, reducer, type ConvEvent, type ConvState } from '../src/state/machine';

const run = (events: ConvEvent[], from: ConvState = initialState) => events.reduce(reducer, from);
const sign = (label: string, confidence: number): ConvEvent => ({ type: 'SIGN_EVENT', label, confidence, at: 1, threshold: 0.8 });

describe('conversation state machine', () => {
  it('full signer flow: start, confirm sign, compose, confirm sentence, speak, listener turn', () => {
    let s = run([{ type: 'START' }]);
    expect(s.phase).toBe('SIGNER_LISTENING');
    s = run([sign('hello', 0.93)], s);
    expect(s.phase).toBe('CONFIRM_SIGN');
    s = run([{ type: 'ACCEPT_SIGN' }], s);
    expect(s.phase).toBe('COMPOSING');
    expect(s.buffer.map((b) => b.label)).toEqual(['hello']);
    expect(s.requestId).toBe(1);
    s = run([{ type: 'COMPOSE_OK', sentence: 'Hello.' }], s);
    expect(s.phase).toBe('CONFIRM_SENTENCE');
    expect(s.turns).toHaveLength(0); // nothing spoken or recorded yet
    s = run([{ type: 'ACCEPT_SENTENCE', id: 't1', at: 2 }], s);
    expect(s.phase).toBe('SPEAKING');
    expect(s.speaking).toBe('Hello.');
    expect(s.turns[0]).toMatchObject({ speaker: 'signer', text: 'Hello.' });
    s = run([{ type: 'SPEAK_DONE' }], s);
    expect(s.phase).toBe('LISTENER_TURN');
  });

  it('below threshold or none shows Not recognized and stays listening', () => {
    let s = run([{ type: 'START' }, sign('yes', 0.62)]);
    expect(s.phase).toBe('SIGNER_LISTENING');
    expect(s.notRecognized).toBe(true);
    s = run([sign('none', 0.7)], s);
    expect(s.notRecognized).toBe(true);
    s = run([sign('yes', 0.85)], s);
    expect(s.phase).toBe('CONFIRM_SIGN');
    expect(s.notRecognized).toBe(false);
  });

  it('ignores sign events when not listening', () => {
    expect(run([sign('hello', 0.99)]).phase).toBe('IDLE');
  });

  it('never speaks without acceptance: COMPOSE_OK does not speak, REJECT returns to listening', () => {
    const s = run([{ type: 'START' }, sign('hello', 0.95), { type: 'ACCEPT_SIGN' }, { type: 'COMPOSE_OK', sentence: 'X' }, { type: 'REJECT_SENTENCE' }]);
    expect(s.phase).toBe('SIGNER_LISTENING');
    expect(s.speaking).toBeNull();
    expect(s.turns).toHaveLength(0);
    expect(s.buffer).toHaveLength(0);
  });

  it('collects up to 5 signs before composing', () => {
    let s = run([{ type: 'START' }]);
    for (const l of ['hello', 'my_name', 'i_want_work', 'yes']) s = run([sign(l, 0.9), { type: 'ADD_SIGN' }], s);
    expect(s.buffer).toHaveLength(4);
    s = run([sign('wait', 0.9), { type: 'ADD_SIGN' }], s); // 5th cannot be "add another"
    expect(s.phase).toBe('CONFIRM_SIGN');
    s = run([{ type: 'ACCEPT_SIGN' }], s);
    expect(s.buffer).toHaveLength(5);
    expect(s.phase).toBe('COMPOSING');
  });

  it('discard returns to listening without keeping the sign', () => {
    const s = run([{ type: 'START' }, sign('no', 0.9), { type: 'DISCARD_SIGN' }]);
    expect(s.phase).toBe('SIGNER_LISTENING');
    expect(s.buffer).toHaveLength(0);
  });

  it('choose a phrase goes to sentence confirmation', () => {
    const s = run([{ type: 'START' }, sign('no', 0.9), { type: 'CHOOSE_PHRASE', text: 'Please wait a moment.' }]);
    expect(s.phase).toBe('CONFIRM_SENTENCE');
    expect(s.proposal).toEqual({ text: 'Please wait a moment.', source: 'phrase' });
  });

  it('compose failure goes to ERROR with fallbacks: retry and use words', () => {
    const base = run([{ type: 'START' }, sign('hello', 0.95), { type: 'ACCEPT_SIGN' }, { type: 'COMPOSE_FAILED', code: 'UPSTREAM_TIMEOUT' }]);
    expect(base.phase).toBe('ERROR');
    expect(base.error).toEqual({ kind: 'api', code: 'UPSTREAM_TIMEOUT', retryAfterS: undefined });
    const retried = run([{ type: 'RETRY' }], base);
    expect(retried.phase).toBe('COMPOSING');
    expect(retried.requestId).toBe(base.requestId + 1);
    const words = run([{ type: 'USE_WORDS', text: 'Hello.' }], base);
    expect(words.phase).toBe('CONFIRM_SENTENCE');
    expect(words.proposal?.source).toBe('fallback');
  });

  it('refusal goes to ERROR with needs-human reason', () => {
    const s = run([{ type: 'START' }, sign('hello', 0.95), { type: 'ACCEPT_SIGN' }, { type: 'COMPOSE_REFUSED', reason: 'out_of_scope' }]);
    expect(s.phase).toBe('ERROR');
    expect(s.error).toEqual({ kind: 'refused', reason: 'out_of_scope' });
  });

  it('read aloud failure still ends the turn and reports the issue', () => {
    const s = run([{ type: 'SPEAK_DIRECT', text: 'Hi', id: 'a', at: 1 }, { type: 'SPEAK_DONE', issue: 'no_voice' }]);
    expect(s.phase).toBe('LISTENER_TURN');
    expect(s.ttsIssue).toBe('no_voice');
  });

  it('listener: push-to-talk shows live text, final adds a turn', () => {
    let s = run([{ type: 'SPEAK_DIRECT', text: 'Hi', id: 'a', at: 1 }, { type: 'SPEAK_DONE' }, { type: 'PTT_START' }]);
    expect(s.phase).toBe('TRANSCRIBING');
    s = run([{ type: 'PARTIAL', text: 'Thank' }], s);
    expect(s.partial).toBe('Thank');
    s = run([{ type: 'FINAL', text: 'Thank you for coming.', id: 'b', at: 2 }], s);
    expect(s.phase).toBe('LISTENER_TURN');
    expect(s.turns.at(-1)).toMatchObject({ speaker: 'listener', text: 'Thank you for coming.' });
  });

  it('hearing person can interrupt a pending sign confirmation', () => {
    const s = run([{ type: 'START' }, sign('hello', 0.95), { type: 'LISTENER_TYPED', text: 'One moment', id: 'l', at: 1 }]);
    expect(s.phase).toBe('LISTENER_TURN');
    expect(s.candidate).toBeNull();
  });

  it('listener typed reply and correction', () => {
    let s = run([{ type: 'LISTENER_TYPED', text: 'Welcom', id: 'l1', at: 1 }]);
    expect(s.phase).toBe('LISTENER_TURN');
    s = run([{ type: 'EDIT_TURN', id: 'l1', text: 'Welcome' }], s);
    expect(s.turns[0].text).toBe('Welcome');
  });

  it('simplify only runs on request and returns to the previous phase', () => {
    let s = run([{ type: 'LISTENER_TYPED', text: 'Long text', id: 'l1', at: 1 }, { type: 'SIMPLIFY', turnId: 'l1' }]);
    expect(s.phase).toBe('SIMPLIFYING');
    s = run([{ type: 'SIMPLIFY_OK', turnId: 'l1', text: 'Short', matches: ['please_repeat'], id: 's1', at: 2 }], s);
    expect(s.phase).toBe('LISTENER_TURN');
    expect(s.turns.at(-1)).toMatchObject({ simplifiedFrom: 'l1', text: 'Short' });
    expect(s.matches).toEqual(['please_repeat']);
    s = run([{ type: 'SIMPLIFY', turnId: 'l1' }, { type: 'SIMPLIFY_FAILED', error: { kind: 'api', code: 'OFFLINE' } }], s);
    expect(s.phase).toBe('LISTENER_TURN');
    expect(s.simplifyError).toEqual({ kind: 'api', code: 'OFFLINE' });
  });

  it('STOP returns to IDLE from any state and keeps the transcript', () => {
    const states: ConvEvent[][] = [
      [{ type: 'START' }],
      [{ type: 'START' }, sign('hello', 0.95)],
      [{ type: 'START' }, sign('hello', 0.95), { type: 'ACCEPT_SIGN' }],
      [{ type: 'LISTENER_TYPED', text: 'x', id: 'l', at: 1 }, { type: 'PTT_START' }],
      [{ type: 'SPEAK_DIRECT', text: 'Hi', id: 'a', at: 1 }],
    ];
    for (const ev of states) {
      const s = run([...ev, { type: 'STOP' }]);
      expect(s.phase).toBe('IDLE');
      expect(s.buffer).toHaveLength(0);
    }
    const withTurns = run([{ type: 'LISTENER_TYPED', text: 'x', id: 'l', at: 1 }, { type: 'STOP' }]);
    expect(withTurns.turns).toHaveLength(1);
  });

  it('busy states block new speech', () => {
    const composing = run([{ type: 'START' }, sign('hello', 0.95), { type: 'ACCEPT_SIGN' }]);
    expect(run([{ type: 'SPEAK_DIRECT', text: 'Hi', id: 'a', at: 1 }], composing).phase).toBe('COMPOSING');
    expect(run([{ type: 'CHOOSE_PHRASE', text: 'Hi' }], composing).phase).toBe('COMPOSING');
  });
});

// 動作記録に入れる場面。
// 種を固定して正しい答えを押し続けた時の、1周ごとのルールと押す順番を並べる。
import { confirmRule, createInitialState, expected, press } from '../../src/game/rules';
import { fingerprint, type Trace } from '../../src/kit/golden';
import { createRng } from '../../src/kit/rng';

const GAMES = 40;
const LAPS = 14;

function traceGame(seed: number): Trace {
  const rng = createRng(seed);
  let state = createInitialState();
  const trace: Trace = [fingerprint(state)];
  while (state.cleared < LAPS) {
    const before = state.cleared;
    state = press(confirmRule(state), expected(confirmRule(state)), rng);
    if (state.cleared > before) trace.push(fingerprint(state));
  }
  return trace;
}

export function goldenCases(): Record<string, Trace> {
  return Object.fromEntries(Array.from({ length: GAMES }, (_, i) => [`seed ${i + 1}`, traceGame(i + 1)]));
}

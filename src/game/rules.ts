// ルール。1 から 10 まで順に数える。1周するたびにルールが1つ増え、消えずに積み上がる。
// このフォルダ（src/game）は画面の処理に触れない。document・Math.random・時計は使わない。
// 時間は刻み（tick）の回数で数える。1刻みは 1/60 秒。

import type { Rng } from '../kit/rng';

export const TICKS_PER_SECOND = 60;
export const NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 押すもの。数字か、★ */
export type Say = number | 'star';

/**
 * 積み上がるルール。a・b は「本物の数字」（数える順番の中での数字）を指す。
 * 「2 の代わりに 5」があっても、本物の 5 の番では 5 のまま。
 */
export type Rule =
  | { kind: 'replace'; a: number; b: number } // a の番で b と言う
  | { kind: 'skip'; a: number } // a の番を飛ばす
  | { kind: 'double'; a: number } // a の番を2回続ける
  | { kind: 'swap'; a: number; b: number } // a の番と b の番を入れ替える
  | { kind: 'star'; a: number }; // a の番で ★ と言う

/** 1周の中の1つの番。count は本物の数字、say はその番で押すもの */
export interface Slot {
  count: number;
  say: Say;
}

export type Phase = 'rule' | 'play' | 'over';

export interface State {
  /** rule: 新しいルールを見せている（時間は進まない）。play: 数えている */
  phase: Phase;
  /** 今の周（1 から） */
  lap: number;
  /** 終えた周の数。これが点数 */
  cleared: number;
  rules: Rule[];
  /** 今の周で押す順番 */
  sequence: Slot[];
  pos: number;
  /** 今の周でここまでに押したもの */
  said: Say[];
  /** 1回押すまでの持ち時間（刻み）と、その残り */
  limit: number;
  ticksLeft: number;
  /** 終わった理由。終わるまでは null */
  result: { reason: 'wrong' | 'timeout'; pressed: Say | null; expected: Say } | null;
}

/** 種類ごとの上限。飛ばす番が多すぎると、1周が短くなりすぎる */
const MAX_OF: Record<Rule['kind'], number> = { replace: 10, skip: 2, double: 2, swap: 2, star: 2 };

/** 1回押すまでの持ち時間（刻み）。最初は 10 秒で、周が進むほど短くなり、5 秒で止まる */
export function limitFor(lap: number): number {
  return Math.max(300, 630 - lap * 30);
}

/**
 * ルールの文に出てくる数字。1つの数字が出てくるルールは1つまで。
 * 「4 の代わりに 6」の 6 も数える。そうしないと、後から「6 と 1 を入れ替える」が来た時に、
 * 4 の番で押すのが 6 なのか 1 なのか、文からは決まらなくなる。
 */
export function usedNumbers(rules: readonly Rule[]): Set<number> {
  const used = new Set<number>();
  for (const rule of rules) {
    used.add(rule.a);
    if (rule.kind === 'swap' || rule.kind === 'replace') used.add(rule.b);
  }
  return used;
}

/** ルールを全部掛けた後の、1周で押す順番 */
export function buildSequence(rules: readonly Rule[]): Slot[] {
  let slots: Slot[] = NUMBERS.map((n) => ({ count: n, say: n }));
  for (const rule of rules) {
    switch (rule.kind) {
      case 'replace':
        slots = slots.map((s) => (s.count === rule.a ? { ...s, say: rule.b } : s));
        break;
      case 'star':
        slots = slots.map((s) => (s.count === rule.a ? { ...s, say: 'star' as const } : s));
        break;
      case 'skip':
        slots = slots.filter((s) => s.count !== rule.a);
        break;
      case 'double':
        slots = slots.flatMap((s) => (s.count === rule.a ? [s, s] : [s]));
        break;
      case 'swap': {
        const i = slots.findIndex((s) => s.count === rule.a);
        const j = slots.findIndex((s) => s.count === rule.b);
        if (i >= 0 && j >= 0) {
          const next = slots.slice();
          [next[i], next[j]] = [next[j]!, next[i]!];
          slots = next;
        }
        break;
      }
    }
  }
  return slots;
}

/** 次に足すルール。作れるルールが残っていなければ null（それ以上は増えない） */
export function createRule(rules: readonly Rule[], rng: Rng): Rule | null {
  const used = usedNumbers(rules);
  const free = NUMBERS.filter((n) => !used.has(n));
  const countOf = (kind: Rule['kind']) => rules.filter((r) => r.kind === kind).length;
  // 「代わりに言う」と「入れ替え」は、まだ出ていない数字を2つ使う
  const needs = (kind: Rule['kind']) => (kind === 'replace' || kind === 'swap' ? 2 : 1);

  // 1つ目は必ず「代わりに言う」。このゲームの肝なので最初に見せる
  const kinds: Rule['kind'][] = rules.length === 0
    ? ['replace']
    : (['replace', 'skip', 'double', 'swap', 'star'] as const).filter(
        (kind) => countOf(kind) < MAX_OF[kind] && free.length >= needs(kind),
      );
  if (kinds.length === 0) return null;
  const kind = rng.pick(kinds);
  const a = rng.pick(free);
  switch (kind) {
    case 'replace':
    case 'swap':
      return { kind, a, b: rng.pick(free.filter((n) => n !== a)) };
    default:
      return { kind, a };
  }
}

export function ruleText(rule: Rule): string {
  switch (rule.kind) {
    case 'replace': return `${rule.a} の代わりに ${rule.b}`;
    case 'skip': return `${rule.a} は飛ばす`;
    case 'double': return `${rule.a} は2回`;
    case 'swap': return `${rule.a} と ${rule.b} を入れ替える`;
    case 'star': return `${rule.a} の代わりに ★`;
  }
}

export function sayText(say: Say): string {
  return say === 'star' ? '★' : String(say);
}

export function createInitialState(): State {
  const limit = limitFor(1);
  return {
    phase: 'play',
    lap: 1,
    cleared: 0,
    rules: [],
    sequence: buildSequence([]),
    pos: 0,
    said: [],
    limit,
    ticksLeft: limit,
    result: null,
  };
}

/** 今の番で押すもの */
export function expected(state: State): Say {
  return state.sequence[state.pos]!.say;
}

/** 1つ押した後の状態を新しく返す（元の状態は変えない） */
export function press(state: State, say: Say, rng: Rng): State {
  if (state.phase !== 'play') return state;
  const want = expected(state);
  if (say !== want) {
    return { ...state, phase: 'over', result: { reason: 'wrong', pressed: say, expected: want } };
  }

  const pos = state.pos + 1;
  if (pos < state.sequence.length) {
    return { ...state, pos, said: [...state.said, say], ticksLeft: state.limit };
  }

  // 1周終えた。ルールを1つ足して次の周へ
  const rule = createRule(state.rules, rng);
  const rules = rule ? [...state.rules, rule] : state.rules;
  const lap = state.lap + 1;
  const limit = limitFor(lap);
  return {
    phase: rule ? 'rule' : 'play',
    lap,
    cleared: state.cleared + 1,
    rules,
    sequence: buildSequence(rules),
    pos: 0,
    said: [],
    limit,
    ticksLeft: limit,
    result: null,
  };
}

/** 新しいルールを見終わって、数え始める */
export function confirmRule(state: State): State {
  return state.phase === 'rule' ? { ...state, phase: 'play', ticksLeft: state.limit } : state;
}

/** 1刻み進める。数えている間だけ持ち時間が減り、無くなったら終わる */
export function tick(state: State): State {
  if (state.phase !== 'play') return state;
  const ticksLeft = state.ticksLeft - 1;
  if (ticksLeft > 0) return { ...state, ticksLeft };
  return { ...state, ticksLeft: 0, phase: 'over', result: { reason: 'timeout', pressed: null, expected: expected(state) } };
}

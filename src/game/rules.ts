// ルール。1 から 10 まで順に数える。1周するたびにルールが1つ増え、消えずに積み上がる。
// このフォルダ（src/game）は画面の処理に触れない。document・Math.random・時計は使わない。
// 時間は刻み（tick）の回数で数える。1刻みは 1/60 秒。

import type { Rng } from '../kit/rng';

export const TICKS_PER_SECOND = 60;
export const NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 押すもの。数字か、★ */
export type Say = number | 'star';

/**
 * 積み上がるルール。a・b は「その時に言っている数字」を指す。
 * 「2 の代わりに 5」があっても、元から 5 だった番は 5 のまま。
 * その後に「5 は2回」が来たら、5 と言う番（元の 2 の番と 5 の番）が両方2回になる。
 */
export type Rule =
  | { kind: 'replace'; a: number; b: number } // a と言う所で b と言う
  | { kind: 'skip'; a: number } // a と言う所を飛ばす
  | { kind: 'double'; a: number } // a と言う所を2回続ける
  | { kind: 'swap'; a: number; b: number } // a と言う所で b、b と言う所で a と言う
  | { kind: 'star'; a: number }; // a と言う所で ★ と言う

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
const MAX_OF: Record<Rule['kind'], number> = { replace: 10, skip: 2, double: 2, swap: 3, star: 2 };
/** 1周の長さの範囲。これを外れるルールは足さない */
const MIN_LENGTH = 6;
const MAX_LENGTH = 14;
/**
 * 1周に出てくるものの種類の下限と、同じものが出てくる回数の上限。
 * ルールが重なり続けると、1周が ★ や同じ数字ばかりになり、覚えなくても押せてしまう
 */
const MIN_DISTINCT = 6;
const MAX_SAME = 4;

/** ルールを足した後の1周が、遊べる形になっているか */
function isPlayable(slots: readonly Slot[]): boolean {
  if (slots.length < MIN_LENGTH || slots.length > MAX_LENGTH) return false;
  const counts = new Map<Say, number>();
  for (const slot of slots) counts.set(slot.say, (counts.get(slot.say) ?? 0) + 1);
  return counts.size >= MIN_DISTINCT && Math.max(...counts.values()) <= MAX_SAME;
}

/** 1回押すまでの持ち時間（刻み）。最初は 10 秒で、周が進むほど短くなり、5 秒で止まる */
export function limitFor(lap: number): number {
  return Math.max(300, 630 - lap * 30);
}

/**
 * ルールを全部掛けた後の、1周で押す順番。
 * ルールは足された順に掛ける。数字は「その時に言っている数字」を指すので、
 * 後のルールは、前のルールで変わった後の数字に効く。
 * 例：「4 の代わりに 6」→「6 と 1 を入れ替える」なら、4 の番は 6 になった後、1 になる。
 */
export function buildSequence(rules: readonly Rule[]): Slot[] {
  let slots: Slot[] = NUMBERS.map((n) => ({ count: n, say: n }));
  for (const rule of rules) {
    switch (rule.kind) {
      case 'replace':
        slots = slots.map((s) => (s.say === rule.a ? { ...s, say: rule.b } : s));
        break;
      case 'star':
        slots = slots.map((s) => (s.say === rule.a ? { ...s, say: 'star' as const } : s));
        break;
      case 'skip':
        slots = slots.filter((s) => s.say !== rule.a);
        break;
      case 'double':
        slots = slots.flatMap((s) => (s.say === rule.a ? [s, s] : [s]));
        break;
      case 'swap':
        slots = slots.map((s) =>
          s.say === rule.a ? { ...s, say: rule.b } : s.say === rule.b ? { ...s, say: rule.a } : s,
        );
        break;
    }
  }
  return slots;
}

/** これまでのルールが「変える側」として指した数字（「4 の代わりに 6」なら 4。入れ替えは両方） */
export function subjectNumbers(rules: readonly Rule[]): Set<number> {
  const subjects = new Set<number>();
  for (const rule of rules) {
    subjects.add(rule.a);
    if (rule.kind === 'swap') subjects.add(rule.b);
  }
  return subjects;
}

/**
 * 次に足すルール。作れるルールが残っていなければ null（それ以上は増えない）。
 * - 指す数字は、今だれかが言っている数字（言われていない数字を指すと、何も起きないルールになる）
 * - 「代わりに言う」の言う側には、前のルールが変える数字を使わない。
 *   「6 と 1 を入れ替える」の後に「4 の代わりに 6」が来ると、4 の番が 6 なのか 1 なのか迷うため
 *   （ルールは足された順に掛けるので答えは 6 だが、読む側には分かりにくい）
 */
export function createRule(rules: readonly Rule[], rng: Rng): Rule | null {
  const said = NUMBERS.filter((n) => buildSequence(rules).some((s) => s.say === n));
  const subjects = subjectNumbers(rules);
  const countOf = (kind: Rule['kind']) => rules.filter((r) => r.kind === kind).length;
  // 同じルールをもう一度出さない（入れ替えは、逆の並びも同じとみなす）
  const sameRule = (rule: Rule) =>
    rules.some((r) =>
      r.kind === 'swap' && rule.kind === 'swap'
        ? (r.a === rule.a && r.b === rule.b) || (r.a === rule.b && r.b === rule.a)
        : r.kind === rule.kind && r.a === rule.a,
    );

  // 1つ目は必ず「代わりに言う」。このゲームの肝なので最初に見せる
  const kinds: Rule['kind'][] = rules.length === 0
    ? ['replace']
    : (['replace', 'skip', 'double', 'swap', 'star'] as const).filter((kind) => countOf(kind) < MAX_OF[kind]);
  if (kinds.length === 0 || said.length < 2) return null;

  for (let tries = 0; tries < 40; tries++) {
    const kind = rng.pick(kinds);
    const a = rng.pick(said);
    let rule: Rule;
    if (kind === 'replace') {
      const targets = NUMBERS.filter((n) => n !== a && !subjects.has(n));
      if (targets.length === 0) continue;
      rule = { kind, a, b: rng.pick(targets) };
    } else if (kind === 'swap') {
      rule = { kind, a, b: rng.pick(said.filter((n) => n !== a)) };
    } else {
      rule = { kind, a };
    }
    if (sameRule(rule)) continue;
    if (!isPlayable(buildSequence([...rules, rule]))) continue;
    return rule;
  }
  return null;
}

/**
 * ルールの文。数字は「押す数字」を指し、「何番目」ではない。
 * 「2 は飛ばす」だけだと「2番目を飛ばす」とも読めるので、「押す所は全部」と書く
 */
export function ruleText(rule: Rule): string {
  switch (rule.kind) {
    case 'replace': return `${rule.a} を押す所は全部 ${rule.b}`;
    case 'skip': return `${rule.a} を押す所は全部飛ばす`;
    case 'double': return `${rule.a} を押す所は全部2回`;
    case 'swap': return `${rule.a} を押す所と ${rule.b} を押す所を全部入れ替える`;
    case 'star': return `${rule.a} を押す所は全部 ★`;
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

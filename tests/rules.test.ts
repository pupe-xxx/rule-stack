import { describe, expect, it } from 'vitest';
import {
  buildSequence, confirmRule, createInitialState, createRule, expected, limitFor, NUMBERS, press, ruleText, tick,
  usedNumbers, type Rule, type State,
} from '../src/game/rules';
import { createRng } from '../src/kit/rng';

const says = (rules: Rule[]) => buildSequence(rules).map((s) => s.say);

/** 正しい答えを押し続けて、指定の周まで進める */
function playLaps(seed: number, laps: number): State {
  const rng = createRng(seed);
  let s = createInitialState();
  while (s.cleared < laps) {
    s = confirmRule(s);
    s = press(s, expected(s), rng);
  }
  return s;
}

describe('1周で押す順番', () => {
  it('ルールが無ければ 1 から 10', () => {
    expect(says([])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('代わりに言う：その番だけ変わり、本物の数字の番はそのまま', () => {
    expect(says([{ kind: 'replace', a: 2, b: 5 }])).toEqual([1, 5, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('飛ばす・2回・入れ替え・★', () => {
    expect(says([{ kind: 'skip', a: 3 }])).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(says([{ kind: 'double', a: 7 }])).toEqual([1, 2, 3, 4, 5, 6, 7, 7, 8, 9, 10]);
    expect(says([{ kind: 'swap', a: 4, b: 8 }])).toEqual([1, 2, 3, 8, 5, 6, 7, 4, 9, 10]);
    expect(says([{ kind: 'star', a: 9 }])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 'star', 10]);
  });

  it('ルールは積み上がる', () => {
    const rules: Rule[] = [
      { kind: 'replace', a: 2, b: 5 }, { kind: 'skip', a: 3 }, { kind: 'double', a: 7 },
      { kind: 'swap', a: 4, b: 8 }, { kind: 'star', a: 9 },
    ];
    expect(says(rules)).toEqual([1, 5, 8, 5, 6, 7, 7, 4, 'star', 10]);
  });

  it('説明の文', () => {
    expect(ruleText({ kind: 'replace', a: 2, b: 5 })).toBe('2 の代わりに 5');
    expect(ruleText({ kind: 'swap', a: 4, b: 8 })).toBe('4 と 8 を入れ替える');
  });
});

describe('ルールの足し方', () => {
  it('1つ目は必ず「代わりに言う」', () => {
    for (let seed = 1; seed <= 50; seed++) expect(createRule([], createRng(seed))!.kind).toBe('replace');
  });

  it('1つの数字が出てくるルールは1つまで。作れるルールが無くなったら増えない', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = createRng(seed);
      const rules: Rule[] = [];
      for (;;) {
        const rule = createRule(rules, rng);
        if (!rule) break;
        const before = usedNumbers(rules);
        expect(before.has(rule.a)).toBe(false);
        if (rule.kind === 'swap' || rule.kind === 'replace') {
          expect(before.has(rule.b)).toBe(false);
          expect(rule.b).not.toBe(rule.a);
        }
        rules.push(rule);
        expect(buildSequence(rules).length).toBeGreaterThanOrEqual(8);
      }
      // ルールの文に出てくる数字を全部並べると、同じ数字は2回出てこない
      const mentioned = rules.flatMap((r) => (r.kind === 'swap' || r.kind === 'replace' ? [r.a, r.b] : [r.a]));
      expect(new Set(mentioned).size).toBe(mentioned.length);
      expect(usedNumbers(rules).size).toBeGreaterThanOrEqual(NUMBERS.length - 1);
      expect(rules.length).toBeGreaterThanOrEqual(5);
      expect(rules.filter((r) => r.kind === 'skip').length).toBeLessThanOrEqual(2);
    }
  });

  it('「4 の代わりに 6」の後に、6 を動かすルールは来ない', () => {
    const first: Rule = { kind: 'replace', a: 4, b: 6 };
    for (let seed = 1; seed <= 300; seed++) {
      const rule = createRule([first], createRng(seed))!;
      expect([rule.a, 'b' in rule ? rule.b : 0]).not.toContain(6);
      expect([rule.a, 'b' in rule ? rule.b : 0]).not.toContain(4);
    }
  });
});

describe('進み方', () => {
  it('正しく押すと次の番へ進み、持ち時間が戻る。元の状態は変わらない', () => {
    const rng = createRng(1);
    const s = createInitialState();
    const waited = tick(tick(s));
    expect(waited.ticksLeft).toBe(s.limit - 2);
    const next = press(waited, 1, rng);
    expect(next.pos).toBe(1);
    expect(next.said).toEqual([1]);
    expect(next.ticksLeft).toBe(next.limit);
    expect(s.pos).toBe(0);
  });

  it('間違えると終わり、正しい答えが残る', () => {
    const s = press(createInitialState(), 3, createRng(1));
    expect(s.phase).toBe('over');
    expect(s.result).toEqual({ reason: 'wrong', pressed: 3, expected: 1 });
    expect(press(s, 1, createRng(1))).toBe(s);
  });

  it('持ち時間が無くなると終わる', () => {
    let s = createInitialState();
    for (let i = 0; i < s.limit - 1; i++) s = tick(s);
    expect(s.phase).toBe('play');
    s = tick(s);
    expect(s.phase).toBe('over');
    expect(s.result).toEqual({ reason: 'timeout', pressed: null, expected: 1 });
  });

  it('1周終えるとルールが1つ増え、見せている間は時間が進まず、押しても進まない', () => {
    const s = playLaps(3, 1);
    expect(s.phase).toBe('rule');
    expect(s.rules).toHaveLength(1);
    expect(s.lap).toBe(2);
    expect(s.pos).toBe(0);
    expect(tick(s)).toBe(s);
    expect(press(s, expected(s), createRng(1))).toBe(s);
    expect(confirmRule(s).phase).toBe('play');
  });

  it('周が進むほど持ち時間が短くなり、下限で止まる', () => {
    expect(limitFor(1)).toBeGreaterThan(limitFor(8));
    expect(limitFor(1)).toBe(600);
    expect(limitFor(100)).toBe(300);
  });

  it('同じ種なら同じルールが同じ順に足される。数字を使い切った後も続けられる', () => {
    expect(playLaps(42, 15)).toEqual(playLaps(42, 15));
    expect(playLaps(1, 6).rules).not.toEqual(playLaps(2, 6).rules);
    const late = playLaps(7, 20);
    expect(late.cleared).toBe(20);
    expect(late.rules.length).toBeLessThanOrEqual(10);
    expect(late.phase).toBe('play');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildSequence, confirmRule, createInitialState, createRule, expected, limitFor, press, ruleText, subjectNumbers, tick,
  type Rule, type State,
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

  it('ルールは重なる：後のルールは、前のルールで変わった後の数字に効く', () => {
    // 4 の番は 6 になった後、入れ替えで 1 になる。元の 6 の番も 1、元の 1 の番は 6
    expect(says([{ kind: 'replace', a: 4, b: 6 }, { kind: 'star', a: 9 }, { kind: 'swap', a: 6, b: 1 }]))
      .toEqual([6, 2, 3, 1, 5, 1, 7, 8, 'star', 10]);
    // 5 と言う番（元の 2 の番と 5 の番）が、両方2回になる
    expect(says([{ kind: 'replace', a: 2, b: 5 }, { kind: 'double', a: 5 }]))
      .toEqual([1, 5, 5, 3, 4, 5, 5, 6, 7, 8, 9, 10]);
    // 5 と言う番が、両方飛ばされる
    expect(says([{ kind: 'replace', a: 2, b: 5 }, { kind: 'skip', a: 5 }])).toEqual([1, 3, 4, 6, 7, 8, 9, 10]);
    // 代わりに言うが続く：2 → 5 → 8
    expect(says([{ kind: 'replace', a: 2, b: 5 }, { kind: 'replace', a: 5, b: 8 }]))
      .toEqual([1, 8, 3, 4, 8, 6, 7, 8, 9, 10]);
  });

  it('掛ける順番で答えが変わる（前のルールは、後のルールの結果には効かない）', () => {
    expect(says([{ kind: 'swap', a: 6, b: 1 }, { kind: 'replace', a: 4, b: 6 }]))
      .toEqual([6, 2, 3, 6, 5, 1, 7, 8, 9, 10]);
  });

  it('説明の文', () => {
    expect(ruleText({ kind: 'replace', a: 2, b: 5 })).toBe('2 を押す所は全部 5');
    expect(ruleText({ kind: 'skip', a: 2 })).toBe('2 を押す所は全部飛ばす');
    expect(ruleText({ kind: 'swap', a: 4, b: 8 })).toBe('4 を押す所と 8 を押す所を全部入れ替える');
  });
});

describe('ルールの足し方', () => {
  it('1つ目は必ず「代わりに言う」', () => {
    for (let seed = 1; seed <= 50; seed++) expect(createRule([], createRng(seed))!.kind).toBe('replace');
  });

  it('足されるルールは必ず効き、迷う組み合わせにならず、1周の長さが範囲に収まる', () => {
    let overlaps = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = createRng(seed);
      const rules: Rule[] = [];
      for (;;) {
        const rule = createRule(rules, rng);
        if (!rule) break;
        const before = says(rules);
        // 指す数字は、今だれかが言っている数字
        expect(before).toContain(rule.a);
        if (rule.kind === 'swap') {
          expect(before).toContain(rule.b);
          expect(rule.b).not.toBe(rule.a);
        }
        // 「代わりに言う」の言う側は、前のルールが変える数字ではない
        if (rule.kind === 'replace') {
          expect(subjectNumbers(rules).has(rule.b)).toBe(false);
          expect(rule.b).not.toBe(rule.a);
        }
        if (before.filter((say) => say === rule.a).length > 1) overlaps++;
        rules.push(rule);
        // 足した後、押す順番が実際に変わっている
        expect(says(rules)).not.toEqual(before);
        expect(says(rules).length).toBeGreaterThanOrEqual(6);
        expect(says(rules).length).toBeLessThanOrEqual(14);
        // 同じものばかりの1周にならない
        const tally = new Map<unknown, number>();
        for (const say of says(rules)) tally.set(say, (tally.get(say) ?? 0) + 1);
        expect(tally.size).toBeGreaterThanOrEqual(6);
        expect(Math.max(...tally.values())).toBeLessThanOrEqual(4);
      }
      expect(rules.length).toBeGreaterThanOrEqual(5);
      expect(rules.filter((r) => r.kind === 'skip').length).toBeLessThanOrEqual(2);
      expect(new Set(rules.map(ruleText)).size).toBe(rules.length);
    }
    // 重なるルール（2つ以上の番に同時に効くルール）が実際に出ている
    expect(overlaps).toBeGreaterThan(100);
  });

  it('「4 の代わりに 6」の後に、6 を指すルールが来る', () => {
    const first: Rule = { kind: 'replace', a: 4, b: 6 };
    const next = Array.from({ length: 300 }, (_, i) => createRule([first], createRng(i + 1))!);
    expect(next.some((rule) => rule.a === 6 || ('b' in rule && rule.kind === 'swap' && rule.b === 6))).toBe(true);
    // もう誰も言っていない 4 を指すルールは来ない
    expect(next.some((rule) => rule.a === 4 || (rule.kind === 'swap' && rule.b === 4))).toBe(false);
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

  it('同じ種なら同じルールが同じ順に足される。ルールが打ち止めになった後も続けられる', () => {
    expect(playLaps(42, 15)).toEqual(playLaps(42, 15));
    expect(playLaps(1, 6).rules).not.toEqual(playLaps(2, 6).rules);
    const late = playLaps(7, 30);
    expect(late.cleared).toBe(30);
    expect(late.rules.length).toBeLessThanOrEqual(19);
    expect(late.phase).toBe('play');
  });
});

import { NUMBERS, ruleText, sayText, type Say, type State } from '../game/rules';

export type Screen = 'title' | 'game';
/** easy: 遊んでいる間もルールが見える。hard: 見えない */
export type Mode = 'easy' | 'hard';

export interface View {
  screen: Screen;
  state: State;
  mode: Mode;
  /** 今のモードの最高記録 */
  best: number;
}

export interface Dom {
  lap: HTMLElement;
  best: HTMLElement;
  timerBar: HTMLElement;
  count: HTMLElement;
  said: HTMLElement;
  rules: HTMLElement;
  keys: HTMLElement;
  panel: HTMLElement;
  panelBody: HTMLElement;
  modes: HTMLElement;
  panelButton: HTMLButtonElement;
  mute: HTMLButtonElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} が無い`);
  return found as T;
}

export function getDom(): Dom {
  return {
    lap: byId('lap'),
    best: byId('best'),
    timerBar: byId('timer-bar'),
    count: byId('count'),
    said: byId('said'),
    rules: byId('rules'),
    keys: byId('keys'),
    panel: byId('panel'),
    panelBody: byId('panel-body'),
    modes: byId('modes'),
    panelButton: byId('panel-button'),
    mute: byId('mute'),
  };
}

function el(tag: string, text: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** 数字と ★ のボタンを作る。★ は最初から置いておく（後から出すと、★ のルールが来たと分かってしまう） */
export function buildKeys(dom: Dom, onPress: (say: Say) => void): Map<Say, HTMLButtonElement> {
  const buttons = new Map<Say, HTMLButtonElement>();
  const says: Say[] = [...NUMBERS, 'star'];
  for (const say of says) {
    const button = el('button', sayText(say), say === 'star' ? 'key star' : 'key') as HTMLButtonElement;
    button.type = 'button';
    // click ではなく pointerdown。指を離すのを待たずに反応させる
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPress(say);
    });
    dom.keys.append(button);
    buttons.set(say, button);
  }
  return buttons;
}

/** モードを選ぶボタンを作る。タイトルと、終わった後の画面で出す */
export function buildModes(dom: Dom, onMode: (mode: Mode) => void): Map<Mode, HTMLButtonElement> {
  const buttons = new Map<Mode, HTMLButtonElement>();
  const labels: [Mode, string][] = [['easy', 'イージー\nルールが見える'], ['hard', 'ハード\nルールが見えない']];
  for (const [mode, label] of labels) {
    const button = el('button', label, 'mode') as HTMLButtonElement;
    button.type = 'button';
    button.addEventListener('click', () => onMode(mode));
    dom.modes.append(button);
    buttons.set(mode, button);
  }
  return buttons;
}

/** どの画面を出しているかの目印。同じ間は作り直さない */
function panelKey(view: View): string {
  if (view.screen === 'title') return 'title';
  const { state } = view;
  if (state.phase === 'rule') return `rule ${state.rules.length}`;
  if (state.phase === 'over') return `over ${state.cleared}`;
  return '';
}

function fillPanel(dom: Dom, view: View): void {
  const { state } = view;
  const body: HTMLElement[] = [];
  let button = '';

  if (view.screen === 'title') {
    body.push(
      el('h1', 'RULE STACK'),
      el('p', '1 から 10 まで、順に押す。'),
      el('p', '1周するたびにルールが1つ増える。ルールは消えない。'),
      el('p', 'ルールの数字は「押す数字」のこと。「何番目」ではない。'),
      el('p', 'ルールは重なる。「4 を押す所は全部 6」の後に「6 を押す所は全部飛ばす」が来たら、元の 4 の所も 6 の所も飛ばす。'),
    );
    button = 'スタート';
  } else if (state.phase === 'rule') {
    body.push(
      el('p', `ルール ${state.rules.length} 個目`),
      el('div', ruleText(state.rules[state.rules.length - 1]!), 'big'),
      el('p', `前のルールもそのまま。次は ${state.lap} 周目`),
    );
    button = '覚えた';
  } else if (state.phase === 'over' && state.result) {
    const { reason, pressed, expected } = state.result;
    body.push(
      el('h2', reason === 'timeout' ? '時間切れ' : 'まちがい', 'bad'),
      el('p', pressed === null
        ? `正しくは ${sayText(expected)}`
        : `正しくは ${sayText(expected)}（押したのは ${sayText(pressed)}）`),
      el('div', `${state.cleared} 周`, 'score'),
      el('p', state.cleared > 0 && state.cleared >= view.best ? '最高記録' : `最高 ${view.best} 周`),
    );
    // この周の正しい順番。間違えた番に印を付ける
    const order = el('div', '', 'order');
    state.sequence.forEach((slot, i) => {
      order.append(el('span', sayText(slot.say), i === state.pos ? 'miss' : i < state.pos ? 'done' : ''));
    });
    body.push(el('p', 'この周の正しい順番'), order);
    if (state.rules.length > 0) {
      const list = document.createElement('ol');
      for (const rule of state.rules) list.append(el('li', ruleText(rule)));
      body.push(list);
    }
    button = 'もう一度';
  }

  dom.panelBody.replaceChildren(...body);
  dom.panelButton.textContent = button;
}

const shown = { panel: '?', said: '', rules: '?', mode: '', lap: '', best: '', count: '' };

function setText(node: HTMLElement, key: 'lap' | 'best' | 'count', text: string): void {
  if (shown[key] === text) return;
  shown[key] = text;
  node.textContent = text;
}

/** 画面を今の状態に合わせる。毎フレーム呼ばれるので、変わった所だけ書き換える */
export function render(dom: Dom, view: View): boolean {
  const { state } = view;
  const playing = view.screen === 'game';

  setText(dom.lap, 'lap', playing ? `${state.lap} 周目` : '');
  setText(dom.best, 'best', `最高 ${view.best} 周`);
  setText(dom.count, 'count', playing ? `ルール ${state.rules.length} 個` : '');

  const ratio = playing && state.phase === 'play' ? state.ticksLeft / state.limit : 1;
  dom.timerBar.style.transform = `scaleX(${ratio})`;
  dom.timerBar.classList.toggle('low', ratio < 0.3);

  const saidKey = playing ? `${state.lap}:${state.said.join(',')}:${state.phase}` : '';
  if (shown.said !== saidKey) {
    shown.said = saidKey;
    const chips = playing ? state.said.map((say) => el('span', sayText(say), 'chip')) : [];
    if (playing && state.phase === 'play') chips.push(el('span', '?', 'chip next'));
    dom.said.replaceChildren(...chips);
  }

  // イージーでは、数えている間もルールを見せる
  const showRules = playing && view.mode === 'easy' && state.phase === 'play';
  const rulesKey = showRules ? String(state.rules.length) : '';
  if (shown.rules !== rulesKey) {
    shown.rules = rulesKey;
    dom.rules.hidden = !showRules || state.rules.length === 0;
    dom.rules.replaceChildren(...(showRules ? state.rules.map((rule) => el('li', ruleText(rule))) : []));
  }

  // モードは、タイトルと終わった後だけ選べる（遊んでいる途中では変えられない）
  const modeKey = view.screen === 'title' || state.phase === 'over' ? view.mode : '';
  if (shown.mode !== modeKey) {
    shown.mode = modeKey;
    dom.modes.hidden = modeKey === '';
    for (const button of dom.modes.children) {
      button.classList.toggle('on', button === dom.modes.children[view.mode === 'easy' ? 0 : 1]);
    }
  }

  const key = panelKey(view);
  const changed = shown.panel !== key;
  if (changed) {
    shown.panel = key;
    dom.panel.hidden = key === '';
    if (key !== '') fillPanel(dom, view);
  }
  /** 画面（パネル）が切り替わった時だけ true */
  return changed && key !== '';
}

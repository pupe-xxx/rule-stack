// 入口。共通部分（kit）・ルール（game）・画面（ui）をつなぐ。
import './ui/style.css';
import { confirmRule, createInitialState, press, tick, type Say, type State } from './game/rules';
import { createSound } from './kit/audio';
import { createLoop } from './kit/loop';
import { loadPlatform } from './kit/platform';
import { createRng, type Rng } from './kit/rng';
import { createSave } from './kit/save';
import { buildKeys, buildModes, getDom, render, type Mode, type Screen } from './ui/render';

/** 画面が切り替わった直後は、この間だけ下のボタンを押せない（数字を連打した指で、読まずに進めないように） */
const PANEL_WAIT_MS = 600;
const FLASH_MS = 140;

async function start(): Promise<void> {
  const dom = getDom();

  const platform = await loadPlatform();
  await platform.init();

  const sound = createSound();
  // best はハードの最高記録（モードを足す前の記録は、ルールが見えない遊び方のもの）
  const save = createSave('rule-stack.v1', { best: 0, bestEasy: 0, mode: 'hard' as Mode, muted: false });
  const record = save.load();
  const bestKey = () => (record.mode === 'easy' ? 'bestEasy' : 'best');
  sound.setMuted(record.muted);

  let rng: Rng = createRng();
  let state: State = createInitialState();
  let screen: Screen = 'title';
  let busy = false; // 広告の間は入力を受けない

  const flash = (button: HTMLButtonElement | undefined, className: string) => {
    if (!button) return;
    button.classList.add(className);
    setTimeout(() => button.classList.remove(className), FLASH_MS);
  };

  const finish = () => {
    if (state.cleared > record[bestKey()]) {
      record[bestKey()] = state.cleared;
      save.save(record);
    }
    sound.tone(140, 450, 0.3);
    platform.gameplayStop();
  };

  const onPress = (say: Say) => {
    if (busy || screen !== 'game' || state.phase !== 'play') return;
    const before = state;
    state = press(state, say, rng);
    if (state.phase === 'over') {
      flash(keys.get(say), 'miss');
      finish();
      return;
    }
    flash(keys.get(say), 'hit');
    if (state.cleared > before.cleared) sound.tone(880, 220, 0.2);
    else sound.tone(440 + before.pos * 30, 60, 0.12);
  };

  const keys = buildKeys(dom, onPress);
  buildModes(dom, (mode) => {
    if (busy) return;
    record.mode = mode;
    save.save(record);
  });

  const begin = async () => {
    if (busy) return;
    if (screen === 'game' && state.phase === 'over') {
      busy = true;
      await platform.commercialBreak();
      busy = false;
    }
    rng = createRng();
    state = createInitialState();
    screen = 'game';
    platform.gameplayStart();
  };

  const onPanelButton = () => {
    if (dom.panelButton.disabled) return;
    if (screen === 'game' && state.phase === 'rule') state = confirmRule(state);
    else void begin();
  };
  dom.panelButton.addEventListener('click', onPanelButton);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!dom.panel.hidden) onPanelButton();
      return;
    }
    const say: Say | null =
      e.key >= '1' && e.key <= '9' ? Number(e.key) : e.key === '0' ? 10 : e.key === ' ' || e.key === '*' ? 'star' : null;
    if (say === null) return;
    e.preventDefault();
    onPress(say);
  });

  const showMute = () => {
    dom.mute.textContent = sound.muted ? '音: 切' : '音: 入';
  };
  dom.mute.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    record.muted = sound.muted;
    save.save(record);
    showMute();
  });
  showMute();

  const update = () => {
    if (screen !== 'game' || state.phase !== 'play') return;
    state = tick(state);
    if (state.phase === 'over') finish();
  };

  const draw = () => {
    const panelChanged = render(dom, { screen, state, mode: record.mode, best: record[bestKey()] });
    if (panelChanged && screen === 'game') {
      dom.panelButton.disabled = true;
      setTimeout(() => {
        dom.panelButton.disabled = false;
      }, PANEL_WAIT_MS);
    }
  };

  platform.loadingFinished();
  createLoop({ update, render: draw }).start();
}

void start();

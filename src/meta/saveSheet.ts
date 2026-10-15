// Bottom sheet for moving progress between devices: Export downloads (and copies)
// the save JSON (stars, coins and collection), Import reads a file or pasted text,
// validates it (old v1 saves migrate), and asks before replacing anything. Built once
// and toggled; styles injected once with hm- classes.
import { exportGame, importGame, starCount, writeGame } from '../core/save.ts';
import type { GameData, KeyValueStore } from '../core/save.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from '../ui/theme.ts';

export interface SaveSheet {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

const CSS = `
.hm-sheet-bg{position:fixed;inset:0;z-index:20;display:none;align-items:flex-end;justify-content:center;
  font-family:var(--tb-font);color:${UI.ink};-webkit-user-select:none;user-select:none;touch-action:manipulation}
.hm-sheet-bg.hm-on{display:flex}
.hm-sheet{width:100%;max-width:480px;max-height:90dvh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;
  box-sizing:border-box;border-radius:26px 26px 0 0;border-bottom:0;display:flex;flex-direction:column;gap:12px;
  padding:0 max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  animation:hm-up 150ms cubic-bezier(.3,1.4,.6,1) both}
@keyframes hm-up{0%{transform:translateY(24px);opacity:.5}100%{transform:none;opacity:1}}
.hm-sheet h2{margin:-4px -20px 4px;padding:14px 20px 16px;font-size:26px;font-weight:700;color:${UI.cream};text-shadow:${outlineShadow(2.2)};
  background:${WOOD_BG};border:4px solid ${UI.ink};border-radius:26px 26px 16px 16px;box-shadow:inset 0 3px 0 rgba(255,225,180,.3),0 4px 0 ${UI.ink}}
.hm-sheet p{margin:0;font-size:16px;font-weight:600;line-height:1.35;color:#5a4330}
.hm-sheet .tb-btn{margin-bottom:6px}
.hm-btn[hidden],.hm-sheet [hidden]{display:none}
.hm-step{display:flex;flex-direction:column;gap:12px}
.hm-row{display:flex;gap:10px}
.hm-row .tb-btn{flex:1}
.hm-text{width:100%;min-height:96px;box-sizing:border-box;border:3px solid ${UI.ink};border-radius:14px;padding:10px;
  font:13px ui-monospace,Menlo,Consolas,monospace;color:${UI.ink};background:#fffdf6;box-shadow:inset 0 3px 0 rgba(0,0,0,.08);resize:vertical;
  -webkit-user-select:text;user-select:text;touch-action:auto}
.hm-sheet .hm-q{font-size:18px;font-weight:700;color:${UI.ink}}
.hm-err{color:#b3261e!important;font-weight:700}
.hm-ok{color:#2b7a34!important;font-weight:700}
.hm-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
`;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  injectUiTheme();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, cls = ''): HTMLButtonElement {
  const variant = cls === 'hm-primary' ? 'tb-yellow' : cls === 'hm-danger' ? 'tb-red' : 'tb-small';
  const b = el('button', `hm-btn tb-btn ${variant}`, text);
  b.type = 'button';
  return b;
}

// '12 ★, 340 coins' for the replace confirmation.
function summary(g: GameData): string {
  return `${starCount(g.save)} ★, ${g.profile.coins} ${g.profile.coins === 1 ? 'coin' : 'coins'}`;
}

export function createSaveSheet(
  root: HTMLElement,
  opts: {
    getGame(): GameData; // current progress, read each time the sheet acts
    onGameReplaced(g: GameData): void; // after a confirmed import, already written to storage
    store?: KeyValueStore | null; // defaults to localStorage
  },
): SaveSheet {
  injectStyles();

  const bg = el('div', 'hm-sheet-bg tb-backdrop');
  bg.setAttribute('role', 'dialog');
  bg.setAttribute('aria-label', 'Save data');
  const sheet = el('div', 'hm-sheet tb-card');

  // ----- Main step: export + import inputs -----
  const main = el('div', 'hm-step');
  const exportBtn = button('Export', 'hm-primary');
  const exportMsg = el('p', 'hm-ok');
  exportMsg.hidden = true;
  const fileInput = el('input', 'hm-file');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  const fileBtn = button('Import from file');
  const paste = el('textarea', 'hm-text');
  paste.placeholder = 'Or paste an exported save here';
  paste.spellcheck = false;
  const pasteBtn = button('Import pasted text');
  const errMsg = el('p', 'hm-err');
  errMsg.setAttribute('role', 'alert');
  errMsg.hidden = true;
  main.append(
    el('p', '', 'Export your progress to keep a backup or move it to another device.'),
    exportBtn,
    exportMsg,
    fileBtn,
    fileInput,
    paste,
    pasteBtn,
    errMsg,
  );

  // ----- Confirm step -----
  const confirm = el('div', 'hm-step');
  const confirmText = el('p', 'hm-q');
  const replaceBtn = button('Replace', 'hm-danger');
  const cancelBtn = button('Cancel');
  const confirmRow = el('div', 'hm-row');
  confirmRow.append(cancelBtn, replaceBtn);
  confirm.append(confirmText, confirmRow);

  const closeBtn = button('Close');
  sheet.append(el('h2', '', 'Save data'), main, confirm, closeBtn);
  bg.append(sheet);
  root.appendChild(bg);

  let pending: GameData | null = null;
  let visible = false;
  let copiedTimer = 0;

  const showStep = (step: 'main' | 'confirm'): void => {
    main.hidden = step !== 'main';
    confirm.hidden = step !== 'confirm';
  };
  const reset = (): void => {
    pending = null;
    errMsg.hidden = true;
    exportMsg.hidden = true;
    paste.value = '';
    fileInput.value = '';
    showStep('main');
  };

  const tryImport = (text: string): void => {
    try {
      const next = importGame(text);
      pending = next;
      errMsg.hidden = true;
      confirmText.textContent = `Replace your progress (${summary(opts.getGame())}) with this save (${summary(next)})?`;
      showStep('confirm');
    } catch (e) {
      errMsg.textContent = e instanceof Error ? e.message : 'That save could not be read.';
      errMsg.hidden = false;
    }
  };

  exportBtn.addEventListener('click', () => {
    const g = opts.getGame();
    const text = exportGame(g.save, g.profile);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'horde-run-save.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const done = (copied: boolean): void => {
      exportMsg.textContent = copied ? 'Downloaded and copied to the clipboard' : 'Downloaded horde-run-save.json';
      exportMsg.hidden = false;
      clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => (exportMsg.hidden = true), 3000);
    };
    const clip = navigator.clipboard;
    if (clip?.writeText)
      clip.writeText(text).then(
        () => done(true),
        () => done(false),
      );
    else done(false);
  });

  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    f.text().then(tryImport, () => {
      errMsg.textContent = 'That file could not be read.';
      errMsg.hidden = false;
    });
  });
  pasteBtn.addEventListener('click', () => {
    if (!paste.value.trim()) {
      errMsg.textContent = 'Paste an exported save first.';
      errMsg.hidden = false;
      return;
    }
    tryImport(paste.value);
  });

  cancelBtn.addEventListener('click', () => {
    pending = null;
    showStep('main');
  });
  replaceBtn.addEventListener('click', () => {
    const next = pending;
    if (!next) return;
    writeGame(next.save, next.profile, opts.store); // undefined falls back to localStorage
    close();
    opts.onGameReplaced(next);
  });

  closeBtn.addEventListener('click', () => close());
  // Tapping the dimmed backdrop closes too; taps inside the sheet don't bubble up as backdrop taps.
  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });

  function open(): void {
    reset();
    visible = true;
    bg.classList.add('hm-on');
  }
  function close(): void {
    visible = false;
    bg.classList.remove('hm-on');
    clearTimeout(copiedTimer);
    pending = null;
  }

  return {
    open,
    close,
    get visible() {
      return visible;
    },
    dispose() {
      close();
      bg.remove();
    },
  };
}

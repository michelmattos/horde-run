// Bottom sheet for moving progress between devices: Export downloads (and copies)
// the save JSON, Import reads a file or pasted text, validates it, and asks before
// replacing anything. Built once and toggled; styles injected once with hm- classes.
import type { SaveData } from '../contracts.ts';
import { exportSave, importSave, starCount, writeSave } from '../core/save.ts';
import type { KeyValueStore } from '../core/save.ts';

export interface SaveSheet {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

const CSS = `
.hm-sheet-bg{position:fixed;inset:0;z-index:20;display:none;align-items:flex-end;justify-content:center;
  background:rgba(8,16,10,0.6);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;
  -webkit-user-select:none;user-select:none;touch-action:manipulation}
.hm-sheet-bg.hm-on{display:flex}
.hm-sheet{width:100%;max-width:480px;max-height:90dvh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;
  box-sizing:border-box;background:#1f3324;border-radius:20px 20px 0 0;display:flex;flex-direction:column;gap:12px;
  padding:20px max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
.hm-sheet h2{margin:0;font-size:24px;font-weight:900}
.hm-sheet p{margin:0;font-size:15px;opacity:.85;line-height:1.35}
.hm-btn{min-height:56px;width:100%;border:0;border-radius:14px;font:inherit;font-size:19px;font-weight:800;color:#fff;
  background:#3a5a40;touch-action:manipulation;cursor:pointer;-webkit-tap-highlight-color:transparent}
.hm-btn:active{filter:brightness(1.25)}
.hm-btn.hm-primary{background:#2f9e44}
.hm-btn.hm-danger{background:#c92a2a}
.hm-btn[hidden],.hm-sheet [hidden]{display:none}
.hm-step{display:flex;flex-direction:column;gap:12px}
.hm-row{display:flex;gap:10px}
.hm-row .hm-btn{flex:1}
.hm-text{width:100%;min-height:96px;box-sizing:border-box;border:2px solid #3a5a40;border-radius:12px;padding:10px;
  font:13px ui-monospace,Menlo,Consolas,monospace;color:#fff;background:#14231a;resize:vertical;
  -webkit-user-select:text;user-select:text;touch-action:auto}
.hm-sheet .hm-q{font-size:18px;font-weight:700;opacity:1}
.hm-err{color:#ff8787;font-weight:700;font-size:15px}
.hm-ok{color:#8ce99a;font-weight:700;font-size:15px}
.hm-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
`;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
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
  const b = el('button', `hm-btn ${cls}`.trim(), text);
  b.type = 'button';
  return b;
}

export function createSaveSheet(
  root: HTMLElement,
  opts: {
    getSave(): SaveData; // current progress, read each time the sheet acts
    onSaveReplaced(save: SaveData): void; // after a confirmed import, already written to storage
    store?: KeyValueStore | null; // defaults to localStorage
  },
): SaveSheet {
  injectStyles();

  const bg = el('div', 'hm-sheet-bg');
  bg.setAttribute('role', 'dialog');
  bg.setAttribute('aria-label', 'Save data');
  const sheet = el('div', 'hm-sheet');

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

  let pending: SaveData | null = null;
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
      const next = importSave(text);
      pending = next;
      errMsg.hidden = true;
      const cur = starCount(opts.getSave());
      confirmText.textContent = `Replace your progress (${cur} ★) with this save (${starCount(next)} ★)?`;
      showStep('confirm');
    } catch (e) {
      errMsg.textContent = e instanceof Error ? e.message : 'That save could not be read.';
      errMsg.hidden = false;
    }
  };

  exportBtn.addEventListener('click', () => {
    const text = exportSave(opts.getSave());
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
    if (clip?.writeText) clip.writeText(text).then(() => done(true), () => done(false));
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
    writeSave(next, opts.store); // undefined falls back to localStorage
    close();
    opts.onSaveReplaced(next);
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

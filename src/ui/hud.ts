// In-battle HUD drawn with Babylon GUI inside the canvas.
//
// Sizes are CSS px: the root container is scaled by (render px / CSS px), so the
// HUD stays the same physical size whatever hardware scaling the renderer picks.
// Button hits are tested on DOM pointerdown against the same CSS-px rects (and
// registered as blocked regions with the input), so a second finger can press
// CHAMPION while the first keeps firing, independent of scene picking.
// Feedback is colour, alpha and scale pops on HUD widgets only: nothing here
// moves the camera or the screen.
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { Control } from '@babylonjs/gui/2D/controls/control';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { Ellipse } from '@babylonjs/gui/2D/controls/ellipse';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import type { BattleState } from '../contracts.ts';
import type { Input } from '../core/input.ts';
import { readSafeAreaInsets } from './safeArea.ts';
import { hudStarStyle, mixHex, pipLit, popScale } from './uiLogic.ts';
import type { GoalState } from './uiLogic.ts';

// Optional per-level extras. goals: the three stars (win, base above half, target time).
export interface HudInfo {
  bossName?: string;
  bossPhases?: number;
  goals?: readonly GoalState[];
}

export interface Hud {
  update(state: BattleState, levelName: string, info?: HudInfo): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

// Team colours match the toy armies on the field: green player, tan enemy.
const PLAYER = '#43b14b';
const ENEMY = '#e0b76f';
const GOLD = '#ffd34d';
const TRACK = 'rgba(0,0,0,0.45)';
const EDGE = 16;
const CHAMP_D = 76; // champion button diameter (>= 64 CSS px)
const PAUSE_S = 48;
const HIT_SLOP = 8;
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

const BAR_H = 20; // enemy bar, tall enough to carry the boss name
const ROW2_Y = BAR_H + 6; // level name / stars / enemy count row, below the bar
const ROW2_H = 22;
const STAR_W = 18;
const MAX_PIPS = 6;
const PIP_D = 8;
const PHASE_PULSE_MS = 450;
const STAR_POP_MS = 350;
// Top margin + the taller of (pause button, enemy bar + level row), below the top inset.
const TOP_ROWS = 12 + Math.max(PAUSE_S, ROW2_Y + ROW2_H);
const CLEAR = 14; // gap kept between the HUD and the battlefield framing

// CSS px of the canvas the HUD covers at the top and bottom (safe-area insets included),
// for the camera framing. The bottom figure keeps the cannon row above the champion button.
export function hudReserve(): { top: number; bottom: number } {
  const ins = readSafeAreaInsets();
  return { top: ins.top + TOP_ROWS + CLEAR, bottom: ins.bottom + EDGE + CHAMP_D + CLEAR + 36 };
}

function place(c: Control, left: number, top: number, w: number, h: number): void {
  c.leftInPixels = left;
  c.topInPixels = top;
  c.widthInPixels = w;
  c.heightInPixels = h;
}

function topLeft<T extends Control>(c: T): T {
  c.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  c.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  return c;
}

function label(name: string, size: number, align: number): TextBlock {
  const t = topLeft(new TextBlock(name, ''));
  t.color = 'white';
  t.fontFamily = FONT;
  t.fontWeight = '700';
  t.fontSize = size;
  t.textHorizontalAlignment = align;
  t.outlineWidth = 3;
  t.outlineColor = 'rgba(0,0,0,0.6)';
  return t;
}

function bar(name: string, color: string): { track: Rectangle; fill: Rectangle } {
  const track = topLeft(new Rectangle(name));
  track.background = TRACK;
  track.thickness = 0;
  track.cornerRadius = 6;
  const fill = topLeft(new Rectangle(name + '-fill'));
  fill.background = color;
  fill.thickness = 0;
  fill.cornerRadius = 6;
  track.addControl(fill);
  return { track, fill };
}

export function createHud(scene: Scene, input: Input, opts: { onPause: () => void }): Hud {
  const engine: AbstractEngine = scene.getEngine();
  const canvas = engine.getRenderingCanvas() as HTMLCanvasElement;
  const ui = AdvancedDynamicTexture.CreateFullscreenUI('hud', true, scene);
  // Hits are handled in the DOM below; skip GUI picking work on every pointer event.
  ui.disablePicking = true;
  const root = ui.rootContainer;

  // ----- Controls -----
  const enemyBar = bar('enemy-hp', ENEMY);
  // Boss extras live inside the enemy bar: bold name on the left, phase pips on the right.
  const bossText = new TextBlock('boss-name', '');
  bossText.color = 'white';
  bossText.fontFamily = FONT;
  bossText.fontWeight = '900';
  bossText.fontSize = 12;
  bossText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  bossText.paddingLeftInPixels = 8;
  bossText.outlineWidth = 3;
  bossText.outlineColor = 'rgba(0,0,0,0.7)';
  bossText.isVisible = false;
  enemyBar.track.addControl(bossText);
  const pips: Ellipse[] = [];
  for (let i = 0; i < MAX_PIPS; i++) {
    const p = new Ellipse('boss-pip');
    p.widthInPixels = p.heightInPixels = PIP_D;
    p.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    p.color = 'white';
    p.thickness = 1.5;
    p.isVisible = false;
    enemyBar.track.addControl(p);
    pips.push(p);
  }
  const stars: TextBlock[] = [];
  for (let i = 0; i < 3; i++) {
    const t = label('goal-star', 17, Control.HORIZONTAL_ALIGNMENT_CENTER);
    t.text = '\u2605';
    t.isVisible = false;
    stars.push(t);
  }
  const levelText = label('level', 14, Control.HORIZONTAL_ALIGNMENT_LEFT);
  const enemyText = label('enemy-count', 14, Control.HORIZONTAL_ALIGNMENT_RIGHT);
  enemyText.color = '#f3dcb0';
  const playerBar = bar('player-hp', PLAYER);
  const playerText = label('player-count', 15, Control.HORIZONTAL_ALIGNMENT_LEFT);
  playerText.color = '#c9f0c4';

  const pause = topLeft(new Rectangle('pause'));
  pause.background = 'rgba(0,0,0,0.4)';
  pause.color = 'rgba(255,255,255,0.7)';
  pause.thickness = 2;
  pause.cornerRadius = 12;
  for (const dx of [-7, 7]) {
    const b = new Rectangle('pause-bar');
    b.widthInPixels = 6;
    b.heightInPixels = 20;
    b.leftInPixels = dx;
    b.background = 'white';
    b.thickness = 0;
    pause.addControl(b);
  }

  const champ = topLeft(new Ellipse('champion'));
  champ.background = 'rgba(0,0,0,0.45)';
  champ.color = 'rgba(255,255,255,0.75)';
  champ.thickness = 3;
  const champFill = new Ellipse('champion-fill');
  champFill.widthInPixels = CHAMP_D - 8;
  champFill.heightInPixels = CHAMP_D - 8;
  champFill.background = PLAYER;
  champFill.thickness = 0;
  champFill.scaleX = champFill.scaleY = 0;
  champ.addControl(champFill);
  const champText = new TextBlock('champion-label', 'CHAMP');
  champText.color = 'white';
  champText.fontFamily = FONT;
  champText.fontWeight = '800';
  champText.fontSize = 13;
  champText.outlineWidth = 3;
  champText.outlineColor = 'rgba(0,0,0,0.6)';
  champ.addControl(champText);

  for (const c of [enemyBar.track, levelText, enemyText, ...stars, playerBar.track, playerText, pause, champ]) root.addControl(c);

  // ----- Layout (CSS px) -----
  let cssW = 0;
  let cssH = 0;
  let rectLeft = 0;
  let rectTop = 0;
  let enemyBarW = 0;
  let playerBarW = 0;
  let champCx = 0;
  let champCy = 0;
  let pauseX = 0;
  let pauseY = 0;
  let layoutDirty = true;
  let hasGoals = false;

  const relayout = (): void => {
    layoutDirty = false;
    const r = canvas.getBoundingClientRect();
    rectLeft = r.left;
    rectTop = r.top;
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    const k = engine.getRenderWidth() / cssW;
    root.scaleX = root.scaleY = k;
    root.widthInPixels = engine.getRenderWidth() / k;
    root.heightInPixels = engine.getRenderHeight() / k;

    const ins = readSafeAreaInsets();
    const left = EDGE + ins.left;
    const right = EDGE + ins.right;
    const top = 12 + ins.top;
    const bottom = EDGE + ins.bottom;

    pauseX = left;
    pauseY = top;
    place(pause, pauseX, pauseY, PAUSE_S, PAUSE_S);

    const ebX = pauseX + PAUSE_S + 12;
    enemyBarW = Math.max(40, cssW - right - ebX);
    place(enemyBar.track, ebX, top + 4, enemyBarW, BAR_H);
    // Goal stars lead the level row; the name follows them.
    const starsW = hasGoals ? STAR_W * 3 + 6 : 0;
    for (let i = 0; i < 3; i++) place(stars[i], ebX + i * STAR_W, top + ROW2_Y, STAR_W, ROW2_H);
    place(levelText, ebX + starsW, top + ROW2_Y, Math.max(20, enemyBarW * 0.65 - starsW), ROW2_H);
    place(enemyText, ebX + enemyBarW * 0.35, top + ROW2_Y, enemyBarW * 0.65, ROW2_H);

    champCx = cssW - right - CHAMP_D / 2;
    champCy = cssH - bottom - CHAMP_D / 2;
    place(champ, champCx - CHAMP_D / 2, champCy - CHAMP_D / 2, CHAMP_D, CHAMP_D);

    playerBarW = Math.max(60, Math.min(180, cssW - left - right - CHAMP_D - 16));
    const pbY = cssH - bottom - 14;
    place(playerBar.track, left, pbY, playerBarW, 14);
    place(playerText, left, pbY - 24, playerBarW, 22);

    lastEnemyFill = lastPlayerFill = -1; // bar widths depend on layout
  };

  const markDirty = (): void => {
    layoutDirty = true;
  };
  const resizeObs: Observer<AbstractEngine> = engine.onResizeObservable.add(markDirty);
  window.addEventListener('resize', markDirty);

  // ----- Hits (DOM, multi-touch safe) -----
  let visible = true;
  let disposed = false;
  let pressFlashUntil = 0;
  const inChampion = (clientX: number, clientY: number): boolean => {
    if (!visible || disposed) return false;
    const dx = clientX - rectLeft - champCx;
    const dy = clientY - rectTop - champCy;
    const r = CHAMP_D / 2 + HIT_SLOP;
    return dx * dx + dy * dy <= r * r;
  };
  const inPause = (clientX: number, clientY: number): boolean => {
    if (!visible || disposed) return false;
    const x = clientX - rectLeft;
    const y = clientY - rectTop;
    return x >= pauseX - HIT_SLOP && x <= pauseX + PAUSE_S + HIT_SLOP && y >= pauseY - HIT_SLOP && y <= pauseY + PAUSE_S + HIT_SLOP;
  };
  input.addBlockedRegion(inChampion);
  input.addBlockedRegion(inPause);

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (inChampion(e.clientX, e.clientY)) {
      input.pressChampion();
      pressFlashUntil = performance.now() + 120;
    } else if (inPause(e.clientX, e.clientY)) {
      opts.onPause();
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });

  // ----- Per-frame update: only touch controls whose value changed -----
  let lastLevel = '';
  let lastEnemyUnits = -1;
  let lastPlayerUnits = -1;
  let lastEnemyFill = -1;
  let lastPlayerFill = -1;
  let lastCharge = -1;
  let wasFull = false;
  let wasScaled = false;
  let lastBoss = '';
  let lastPips = -1;
  let lastPhase = -1;
  let phasePulseAt = -1e9;
  let pulsing = false;
  const lastGoals: (GoalState | '')[] = ['', '', ''];
  const starPopAt = [-1e9, -1e9, -1e9];
  let starsPopping = false;

  const frac = (hp: number, max: number): number => (max > 0 ? Math.min(1, Math.max(0, hp / max)) : 0);

  return {
    update(state, levelName, info) {
      const goals = info?.goals;
      const wantGoals = !!goals && goals.length > 0;
      if (wantGoals !== hasGoals) {
        hasGoals = wantGoals;
        for (const st of stars) st.isVisible = wantGoals;
        layoutDirty = true;
      }
      if (layoutDirty) relayout();
      const now = performance.now();

      // ----- Boss name and phase pips -----
      const boss = info?.bossName ?? '';
      if (boss !== lastBoss) {
        lastBoss = boss;
        bossText.text = boss.toUpperCase();
        bossText.isVisible = boss !== '';
        lastPhase = -1;
      }
      const nPips = boss ? Math.min(MAX_PIPS, Math.max(0, info?.bossPhases ?? 0)) : 0;
      const phase = state.bossPhase ?? 0;
      if (nPips !== lastPips || phase !== lastPhase) {
        // Pulse only when the boss moves on to a later phase (a retry resets quietly).
        if (lastPhase >= 0 && phase > lastPhase && nPips === lastPips) phasePulseAt = now;
        lastPips = nPips;
        lastPhase = phase;
        for (let i = 0; i < MAX_PIPS; i++) {
          const p = pips[i];
          p.isVisible = i < nPips;
          p.leftInPixels = -(6 + (nPips - 1 - i) * (PIP_D + 4));
          p.background = pipLit(i, phase) ? 'white' : 'transparent';
        }
      }
      const pulseT = now - phasePulseAt;
      if (pulseT < PHASE_PULSE_MS) {
        pulsing = true;
        const s = popScale(pulseT, PHASE_PULSE_MS, 1.35);
        enemyBar.track.scaleY = s;
        enemyBar.track.scaleX = 1 + (s - 1) * 0.06;
        enemyBar.fill.background = mixHex(ENEMY, '#ffffff', (s - 1) / 0.35);
      } else if (pulsing) {
        pulsing = false;
        enemyBar.track.scaleX = enemyBar.track.scaleY = 1;
        enemyBar.fill.background = ENEMY;
      }

      // ----- Goal stars: gold while alive, grey once failed (with a pop) -----
      if (goals) {
        for (let i = 0; i < 3; i++) {
          const g: GoalState = goals[i] ?? 'pending';
          if (g === lastGoals[i]) continue;
          if (g === 'failed' && lastGoals[i] !== '') starPopAt[i] = now;
          lastGoals[i] = g;
          const look = hudStarStyle(g);
          stars[i].color = look.color;
          stars[i].alpha = look.alpha;
        }
      }
      if (starsPopping || starPopAt.some((t) => now - t < STAR_POP_MS)) {
        starsPopping = false;
        for (let i = 0; i < 3; i++) {
          const s = popScale(now - starPopAt[i], STAR_POP_MS, 1.6);
          stars[i].scaleX = stars[i].scaleY = s;
          if (s !== 1) starsPopping = true;
        }
      }

      if (levelName !== lastLevel) {
        lastLevel = levelName;
        levelText.text = levelName;
      }
      const eu = Math.round(state.enemyUnits);
      if (eu !== lastEnemyUnits) {
        lastEnemyUnits = eu;
        enemyText.text = `Enemy ${eu}`;
      }
      const pu = Math.round(state.playerUnits);
      if (pu !== lastPlayerUnits) {
        lastPlayerUnits = pu;
        playerText.text = `Army ${pu}`;
      }
      const ef = Math.round(frac(state.enemyBaseHp, state.enemyBaseMaxHp) * enemyBarW);
      if (ef !== lastEnemyFill) {
        lastEnemyFill = ef;
        enemyBar.fill.widthInPixels = ef;
        enemyBar.fill.isVisible = ef > 0;
      }
      const pf = Math.round(frac(state.playerBaseHp, state.playerBaseMaxHp) * playerBarW);
      if (pf !== lastPlayerFill) {
        lastPlayerFill = pf;
        playerBar.fill.widthInPixels = pf;
        playerBar.fill.isVisible = pf > 0;
      }

      const charge = Math.round(Math.min(1, Math.max(0, state.championCharge)) * 100) / 100;
      if (charge !== lastCharge) {
        lastCharge = charge;
        champFill.scaleX = champFill.scaleY = charge;
      }
      const full = charge >= 1;
      if (full !== wasFull) {
        wasFull = full;
        champ.color = full ? GOLD : 'rgba(255,255,255,0.75)';
        champ.shadowColor = GOLD;
        champ.shadowBlur = full ? 18 : 0;
        champFill.background = full ? GOLD : PLAYER;
        champText.color = full ? '#1b2433' : 'white';
        champText.outlineWidth = full ? 0 : 3;
      }
      // Pulse while ready, shrink briefly on press; otherwise leave the GUI untouched.
      const pressed = now < pressFlashUntil;
      if (full || pressed) {
        const s = pressed ? 0.9 : 1 + 0.05 * Math.sin(now * 0.008);
        champ.scaleX = champ.scaleY = s;
        wasScaled = true;
      } else if (wasScaled) {
        champ.scaleX = champ.scaleY = 1;
        wasScaled = false;
      }
    },
    setVisible(v) {
      visible = v;
      root.isVisible = v;
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('resize', markDirty);
      engine.onResizeObservable.remove(resizeObs);
      ui.dispose();
    },
  };
}

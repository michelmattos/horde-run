// Readability rule for gate layouts: in the portrait battle camera a gate's sign card
// (about 2 units tall, standing on a 2-unit arch and tilted toward the camera) hides the
// card of a gate a few units behind it when the two cards overlap in x. Gates whose
// cards overlap in x must therefore stand at least CARD_CLEAR_Z apart in z (campaign
// levels keep 12). Card half-widths mirror cardWidthFor() in src/render/models/gate.ts
// (3.1 to 3.9 units wide, never narrower than the gate), plus the swing of moving gates.
// Pure: used by the Expedition generator, the upgrade gate placement and their tests.
import type { GateDef } from '../contracts.ts';

export const CARD_CLEAR_Z = 5; // min z gap between gates whose sign cards overlap in x
const CARD_X_MARGIN = 0.1; // a hair of slack: cards that only touch still read fine

type GateShape = Pick<GateDef, 'x' | 'z' | 'width' | 'move'>;

// Half the width a gate's sign card can cover on screen, swing included.
export function cardHalfSpan(g: Pick<GateDef, 'width' | 'move'>): number {
  const card = Math.min(3.9, Math.max(3.1, g.width * 0.6 + 1.7)) / 2;
  return Math.max(g.width / 2, card) + Math.abs(g.move?.amplitude ?? 0);
}

export function cardsOverlapX(a: GateShape, b: GateShape): boolean {
  return Math.abs(a.x - b.x) < cardHalfSpan(a) + cardHalfSpan(b) - CARD_X_MARGIN;
}

// True when one gate's card would cover part of the other's: overlapping in x and
// closer than CARD_CLEAR_Z in z (gates side by side at the same z do not cover).
export function cardsClash(a: GateShape, b: GateShape): boolean {
  const dz = Math.abs(a.z - b.z);
  return dz > 0 && dz < CARD_CLEAR_Z && cardsOverlapX(a, b);
}

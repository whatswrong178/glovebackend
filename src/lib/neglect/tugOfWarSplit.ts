/**
 * tugOfWarSplit — Pure Tug-of-War Commission Split Calculator
 * Skill 3 (TDD): mirrors the neglect index logic in create_invoice_atomic().
 *
 * Index → Split ratio (owner / assistant):
 *   0 → 100 / 0   (no split, owner takes all)
 *   1 → 50  / 50
 *   2 → 40  / 60
 *   3 → 30  / 70
 *   4 → 20  / 80
 *   5 → 10  / 90
 *   6 → 0   / 100  (ownership transfer triggered)
 */

export interface TugOfWarInput {
  currentNeglectIndex: number;   // 0–6
  callerIsOwner:       boolean;
  ownerId:             string;
  assistantId:         string;
}

export interface TugOfWarResult {
  ownerRatio:           number;   // 0–100
  assistantRatio:       number;   // 0–100
  newNeglectIndex:      number;   // after this transaction
  ownershipTransferred: boolean;  // true when index hits 6 via non-owner
  noSplitRequired:      boolean;  // true when index=0 and caller=owner
}

const SPLIT_TABLE: Record<number, [number, number]> = {
  0: [100,  0],
  1: [ 50, 50],
  2: [ 40, 60],
  3: [ 30, 70],
  4: [ 20, 80],
  5: [ 10, 90],
  6: [  0, 100],
};

export function tugOfWarSplit(input: TugOfWarInput): TugOfWarResult {
  const { currentNeglectIndex, callerIsOwner } = input;

  // ── INPUT GUARD ───────────────────────────────────────────────────────────
  // BUG-03: currentNeglectIndex=-1 → SPLIT_TABLE[-1]=undefined → destructure crash
  //         that unwinds the create_invoice_atomic transaction entirely.
  if (
    !Number.isInteger(currentNeglectIndex) ||
    currentNeglectIndex < 0 ||
    currentNeglectIndex > 6
  ) {
    throw new RangeError(
      `tugOfWarSplit: currentNeglectIndex must be integer 0–6, got ${currentNeglectIndex}.`
    );
  }

  // ── Owner makes the sale ──────────────────────────────────────────────────
  if (callerIsOwner) {
    if (currentNeglectIndex === 0) {
      // No debt — full commission, no split
      return {
        ownerRatio:           100,
        assistantRatio:       0,
        newNeglectIndex:      0,
        ownershipTransferred: false,
        noSplitRequired:      true,
      };
    }

    // Service debt redemption: index-- and apply current (disadvantaged) ratio
    const newIndex = currentNeglectIndex - 1;
    const [ownerPct, asstPct] = SPLIT_TABLE[currentNeglectIndex]!;

    return {
      ownerRatio:           ownerPct,
      assistantRatio:       asstPct,
      newNeglectIndex:      newIndex,
      ownershipTransferred: false,
      noSplitRequired:      false,
    };
  }

  // ── Non-owner (assistant) makes the sale ──────────────────────────────────
  const newIndex = Math.min(currentNeglectIndex + 1, 6);
  const [ownerPct, asstPct] = SPLIT_TABLE[newIndex]!;

  return {
    ownerRatio:           ownerPct,
    assistantRatio:       asstPct,
    newNeglectIndex:      newIndex,
    ownershipTransferred: newIndex === 6,
    noSplitRequired:      false,
  };
}

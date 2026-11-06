import type { AssetRow } from './institute.repository';

export type AttentionReason = 'IN_MAINTENANCE' | 'MAINTENANCE_OVERDUE' | 'END_OF_LIFE' | 'NO_ROOM';

export interface LatestMaintenance {
  assetId: string;
  /** YYYY-MM-DD */
  performedOn: string;
  nextDueOn: string | null;
}

export interface AttentionItem {
  assetId: string;
  reasons: AttentionReason[];
}

/** Whole months from `from` (YYYY-MM-DD) to `to` (YYYY-MM-DD); a partial month does not count. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/**
 * Inventory exceptions: what needs a person's attention today. Pure (the date is passed in), so it is exactly testable.
 * - IN_MAINTENANCE: the asset is currently in the workshop.
 * - MAINTENANCE_OVERDUE: the latest maintenance entry promised a next date that has passed (and the asset is not retired).
 * - END_OF_LIFE: purchase date plus the useful life is reached and the asset is still not retired.
 * - NO_ROOM: an asset in service that is not placed in any room (cannot be counted in a room's cost).
 */
export function inventoryAttention(assets: AssetRow[], latest: LatestMaintenance[], today: string): AttentionItem[] {
  const last = new Map(latest.map((m) => [m.assetId, m]));
  const out: AttentionItem[] = [];
  for (const a of assets) {
    if (a.status === 'RETIRED') continue;
    const reasons: AttentionReason[] = [];
    if (a.status === 'MAINTENANCE') reasons.push('IN_MAINTENANCE');
    const due = last.get(a.id)?.nextDueOn;
    if (due && due < today) reasons.push('MAINTENANCE_OVERDUE');
    if (a.purchaseDate && a.usefulLifeMonths !== null && monthsBetween(a.purchaseDate, today) >= a.usefulLifeMonths) reasons.push('END_OF_LIFE');
    if (a.status === 'IN_SERVICE' && !a.roomId) reasons.push('NO_ROOM');
    if (reasons.length > 0) out.push({ assetId: a.id, reasons });
  }
  return out;
}

import { like } from "drizzle-orm";
import { db, bonusMissionsTable, transactionsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

/**
 * Single source of truth for the "transaction:<id>" evidence reference
 * format used by bonus missions. All producers and consumers must go
 * through these helpers so the format can never silently drift.
 */
const TRANSACTION_EVIDENCE_PREFIX = "transaction:";

/** Builds the canonical evidence reference for a transaction. */
export function transactionEvidenceRef(transactionId: number): string {
  return `${TRANSACTION_EVIDENCE_PREFIX}${transactionId}`;
}

/**
 * Parses a transaction evidence reference back into a transaction id.
 * Returns null for null/undefined refs, refs of other kinds (e.g. "bill:9"),
 * or malformed refs — it never guesses.
 */
export function parseTransactionEvidenceRef(ref: string | null | undefined): number | null {
  if (!ref || !ref.startsWith(TRANSACTION_EVIDENCE_PREFIX)) return null;
  const raw = ref.slice(TRANSACTION_EVIDENCE_PREFIX.length);
  if (!/^[0-9]+$/.test(raw)) return null;
  return Number(raw);
}

export interface OrphanedEvidenceRef {
  bonusMissionId: number;
  evidenceRef: string;
}

/**
 * Read-only integrity validator: returns every bonus mission whose
 * transaction evidence reference points at a transaction that no longer
 * exists (or is malformed). An empty array means the invariant holds:
 * no bonus mission references a deleted transaction.
 */
export async function findOrphanedTransactionEvidenceRefs(): Promise<OrphanedEvidenceRef[]> {
  const refs = await db
    .select({ id: bonusMissionsTable.id, evidenceRef: bonusMissionsTable.evidenceRef })
    .from(bonusMissionsTable)
    .where(like(bonusMissionsTable.evidenceRef, `${TRANSACTION_EVIDENCE_PREFIX}%`));
  if (refs.length === 0) return [];

  const wanted = new Map<number, OrphanedEvidenceRef[]>();
  const orphans: OrphanedEvidenceRef[] = [];
  for (const r of refs) {
    const txnId = parseTransactionEvidenceRef(r.evidenceRef);
    const entry = { bonusMissionId: r.id, evidenceRef: r.evidenceRef ?? "" };
    if (txnId === null) {
      // Malformed "transaction:..." ref — cannot possibly resolve.
      orphans.push(entry);
      continue;
    }
    const list = wanted.get(txnId) ?? [];
    list.push(entry);
    wanted.set(txnId, list);
  }
  if (wanted.size === 0) return orphans;

  const existing = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(inArray(transactionsTable.id, [...wanted.keys()]));
  const existingIds = new Set(existing.map((e) => e.id));
  for (const [txnId, entries] of wanted) {
    if (!existingIds.has(txnId)) orphans.push(...entries);
  }
  return orphans;
}

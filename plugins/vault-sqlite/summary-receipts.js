import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

const target = z.object({
  state: z.enum(['pending', 'updated', 'unchanged', 'retryable', 'blocked']),
  path: z.string().nullable(), revision: z.string().nullable(), note: z.string().max(2000),
}).strict();
const record = z.object({
  workspaceId: z.string().min(1), root: z.string().min(1),
  senderSessionId: z.string().min(1), recipientSessionId: z.string().min(1).nullable(),
  source: z.object({ path: z.string(), heading: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  version: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(), retryKeys: z.array(z.string()),
  targets: z.object({ profile: target, route: target }).strict(),
  // Optional additive metadata keeps all existing v1 receipts readable. The
  // native single-document backend rejects version bumps rather than migrating.
  kind: z.enum(['lesson', 'preparation', 'question', 'materials']).optional(),
  senderPreset: z.enum(['notara-teacher', 'notara-material-organizer']).optional(),
  routing: z.enum(['origin', 'workspace']).optional(),
  summary: z.string().max(1000).optional(),
  journal: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), version: z.number().int().nonnegative(),
    path: z.string().nullable(), heading: z.string().nullable(), revision: z.string().nullable(), locator: z.string().nullable(),
  }).strict().optional(),
  decision: z.object({
    state: z.enum(['pending', 'decided']), targets: z.array(z.enum(['profile', 'route'])).max(2), note: z.string().max(2000),
  }).strict().optional(),
  delivery: z.object({
    round: z.number().int().nonnegative(), attempts: z.number().int().nonnegative(),
    messageId: z.string().nullable(), error: z.string().nullable(),
    suspended: z.enum(['source_changed', 'session_archived', 'user_stopped', 'route_invalid', 'awaiting_home']).nullable(),
    senderStopSeq: z.number().int().nonnegative(), recipientStopSeq: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const summaryReceiptSpec = defineDomain({
  name: 'notara_summary_receipts', version: 1,
  tables: { receipts: domainTable(record), homes: domainTable(z.object({ root: z.string().min(1), sessionId: z.string().min(1) }).strict()) },
});
export const pendingSummaryTarget = () => ({ state: 'pending', path: null, revision: null, note: '' });
export const summaryReceiptComplete = receipt => {
  if (receipt.journal && receipt.journal.version !== receipt.version) return false;
  const targets = receipt.decision?.state === 'decided' ? receipt.decision.targets : ['profile', 'route'];
  return targets.every(name => ['updated', 'unchanged'].includes(receipt.targets[name].state));
};

/** Only handoff metadata. Source summaries and learner documents remain in the
 * Vault, and messages remain in native sessions. Never fall back to RAM. */
export async function openSummaryReceipts(facility) {
  if (!facility) throw new Error('summary_storage_unavailable: 交付回执需要已启用的宿主持久存储');
  const domain = await facility.open(summaryReceiptSpec), table = domain.table('receipts'), homes = domain.table('homes');
  const pending = new Map();
  let closed = false;
  return {
    get: id => table.get(id),
    entries: () => [...table.entries()],
    put: (id, value) => table.put(id, record.parse(value)),
    home: workspaceId => homes.get(workspaceId),
    putHome: (workspaceId, value) => homes.put(workspaceId, value),
    async exclusive(id, fn) {
      if (closed) throw new Error('summary_service_closed');
      const run = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
      pending.set(id, run);
      try { return await run; } finally { if (pending.get(id) === run) pending.delete(id); }
    },
    async close() {
      closed = true;
      await Promise.allSettled(pending.values());
      await domain.close();
    },
  };
}

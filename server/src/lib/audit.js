// ─────────────────────────────────────────────────────────────────────────────
// audit.js — Append-only audit trail of important changes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param db     pool or transaction client
 * @param actor  request.user (or null for guests/system)
 */
export async function audit(db, actor, entityType, entityId, action, data = {}) {
  const actorType = actor ? (actor.role === 'admin' ? 'admin' : 'customer') : (data.__system ? 'system' : 'guest');
  const { __system, ...rest } = data;
  await db.query(
    `insert into audit_log (actor_id, actor_type, entity_type, entity_id, action, data) values ($1,$2,$3,$4,$5,$6)`,
    [actor ? actor.id : null, actorType, entityType, String(entityId), action, JSON.stringify(rest)]);
}

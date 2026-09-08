// @ts-check
/** 会话管理数据不进入 QUERYABLE；只投影选中会话的完整 user/assistant 轮次。 */
/** @typedef {{id:string, title?:string, projectId?:string, legacyProjectId?:string, createdAt?:number, updatedAt?:number}} Conversation */
/** @typedef {Record<string, any>} Message */

/** @param {Message[]} rows @param {Conversation|null} conversation */
export function conversationMessages(rows, conversation) {
  if (!conversation) return [];
  return rows.filter(r => r.surface === 'agent' && !r.historyKey &&
    (r.conversationId === conversation.id ||
      (!r.conversationId && typeof conversation.legacyProjectId === 'string' && (r.projectId || '') === conversation.legacyProjectId)))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.id).localeCompare(String(b.id)));
}

/** @param {Message[]} rows @returns {Conversation[]} */
export function legacyConversations(rows) {
  /** @type {Map<string, Conversation>} */
  const groups = new Map();
  for (const r of rows) {
    if (r.surface !== 'agent' || r.conversationId || r.historyKey) continue;
    const projectId = typeof r.projectId === 'string' ? r.projectId : '';
    const id = 'legacy_' + encodeURIComponent(projectId);
    const existing = groups.get(id);
    if (existing) existing.updatedAt = Math.max(existing.updatedAt || 0, Number(r.ts) || 0);
    else groups.set(id, { id, projectId, legacyProjectId: projectId, createdAt: Number(r.ts) || 0, updatedAt: Number(r.ts) || 0 });
  }
  return [...groups.values()];
}

/** @param {Message[]} rows @param {Conversation} conversation @returns {{role:string,content:string}[]} */
export function conversationHistory(rows, conversation) {
  /** @type {{role:string,content:string}[][]} */
  const turns = [];
  /** @type {Message|null} */
  let pending = null;
  for (const r of conversationMessages(rows, conversation)) {
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    if (r.role === 'user') pending = r;
    else if ((r.role === 'ai' || r.role === 'assistant') && pending &&
      (r.turnId || '') === (pending.turnId || '') && (!r.status || r.status === 'complete')) {
      turns.push([{ role: 'user', content: pending.text }, { role: 'assistant', content: r.text }]);
      pending = null;
    }
  }
  let chars = 0;
  const tail = [];
  for (const turn of turns.slice(-10).reverse()) {
    chars += turn.reduce((n, m) => n + Array.from(m.content).length, 0);
    if (chars > 16000) break;
    tail.unshift(turn);
  }
  return tail.flat();
}

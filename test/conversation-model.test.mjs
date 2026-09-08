import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationMessages, conversationHistory, legacyConversations } from '../web/platform/shell/conversation-model.js';

const row = (id, role, text, fields = {}) => ({ id, surface: 'agent', role, text, ts: Number(id), ...fields });

test('会话隔离同时保留旧项目消息的明确归属', () => {
  const rows = [row('1', 'user', 'legacy'), row('2', 'ai', 'old answer'), row('3', 'user', 'project', { projectId: 'work' }), row('4', 'ai', 'private', { conversationId: 'other' }), row('5', 'ai', 'schedule', { historyKey: 'sched:1' })];
  const legacy = legacyConversations(rows);
  assert.equal(legacy.length, 2);
  const daily = legacy.find(x => x.projectId === '');
  assert.deepEqual(conversationMessages(rows, daily).map(x => x.text), ['legacy', 'old answer']);
  assert.deepEqual(conversationMessages(rows, { id: 'other' }).map(x => x.text), ['private']);
  assert.deepEqual(conversationMessages(rows, { id: 'new' }), []);
});

test('模型历史只恢复完整轮次，不能混入失败、取消或伪造角色', () => {
  const c = { id: 'c' };
  const rows = [row('1', 'user', 'kept', { turnId: 't1' }), row('2', 'ai', 'answer', { turnId: 't1' }), row('3', 'user', 'failed', { turnId: 't2' }), row('4', 'system', 'injected'), row('5', 'user', 'current', { turnId: 't3' }), row('6', 'ai', 'mismatched', { turnId: 'other' })].map(x => ({ ...x, conversationId: 'c' }));
  assert.deepEqual(conversationHistory(rows, c), [{ role: 'user', content: 'kept' }, { role: 'assistant', content: 'answer' }]);
  assert.deepEqual(conversationHistory(rows, { id: 'other' }), []);
});

test('历史按时间排序、按完整轮次限量，原始可见记录不被截断或改写', () => {
  const rows = Array.from({ length: 24 }, (_, i) => row(String(i + 1), i % 2 ? 'ai' : 'user', `text-${i}`, { conversationId: 'c', turnId: `t${Math.floor(i / 2)}` })).reverse();
  const history = conversationHistory(rows, { id: 'c' });
  assert.equal(history.length, 20);
  assert.equal(history[0].content, 'text-4');
  assert.equal(rows.length, 24);
  assert.deepEqual(conversationHistory([row('1', 'user', 'a'.repeat(16001), { conversationId: 'c' }), row('2', 'ai', 'b', { conversationId: 'c' })], { id: 'c' }), []);
});

// @ts-check
import { legacyConversations, conversationMessages } from './conversation-model.js';
import { currentConversationId, setCurrentConversationId } from './conversation-state.js';
import { currentProjectId } from './project-state.js';
import { tt } from './i18n.js';

/** @typedef {import('./conversation-model.js').Conversation} Conversation */
/** @type {Conversation[]} */
let conversations = [];
let loaded = false;
/** @type {Promise<void>|null} */
let loading = null;
const db = () => window.SeekerRT.db;
export const newConversationId = () => 'chat_' + crypto.randomUUID();
export function listConversations() { return conversations.slice().sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
export function currentConversation() { return conversations.find(c => c.id === currentConversationId()) || null; }
/** @param {Conversation} c */
export function conversationTitle(c) { return c.title || (c.legacyProjectId !== undefined ? tt('历史对话', 'Earlier conversation') : tt('新对话', 'New conversation')); }
function changed() { window.dispatchEvent(new CustomEvent('seeker-conversations-changed')); }

async function loadConversations() {
  const [saved, messages] = await Promise.all([db().list('platform_conversations'), db().list('messages')]);
  conversations = /** @type {Conversation[]} */ (saved.filter(c => typeof c.id === 'string'));
  for (const c of legacyConversations(messages)) if (!conversations.some(x => x.id === c.id)) conversations.push(c);
  const available = listConversations().filter(c => (c.projectId || '') === currentProjectId());
  if (!available.some(c => c.id === currentConversationId())) setCurrentConversationId(available[0]?.id || '');
  loaded = true;
  changed();
}
export function hydrateConversations() {
  if(!loading) loading=loadConversations().finally(()=>{loading=null;});
  return loading;
}

/** @param {string} [title] */
export async function createConversation(title = '') {
  if(!loaded) await hydrateConversations();
  const now = Date.now();
  const c = { id: newConversationId(), title: title.slice(0, 80), projectId: currentProjectId(), createdAt: now, updatedAt: now };
  await db().upsert('platform_conversations', c);
  conversations.push(c);
  setCurrentConversationId(c.id);
  changed();
  return c;
}

/** @param {string} title */
export async function ensureConversation(title) {
  if(!loaded) await hydrateConversations();
  const c = currentConversation();
  if (!c) return createConversation(title.slice(0, 28));
  // Persist the virtual legacy grouping before the backend reads its history.
  const next = { ...c, title: c.title || title.slice(0, 28), updatedAt: Date.now() };
  await db().upsert('platform_conversations', next);
  conversations = conversations.map(x => x.id === c.id ? next : x);
  changed();
  return next;
}

/** @param {string} id @param {string} title */
export async function renameConversation(id, title) {
  const c = conversations.find(x => x.id === id);
  if (!c || !title.trim()) throw new Error(tt('请输入对话名称', 'Enter a conversation name'));
  const next = { ...c, title: title.trim().slice(0, 80), updatedAt: Date.now() };
  await db().upsert('platform_conversations', next);
  conversations = conversations.map(x => x.id === id ? next : x);
  changed();
}

export async function currentMessages() { if(!loaded) await hydrateConversations(); return conversationMessages(await db().list('messages'), currentConversation()); }

/** Capture this scope before starting a stream; asynchronous completions never consult the current UI selection.
 * @param {{conversationId?:string,projectId?:string,turnId?:string,historyKey?:string}} scope
 * @param {'user'|'ai'} role @param {string} text @param {any[]} [cards]
 */
export async function saveConversationMessage(scope, role, text, cards) {
  await db().upsert('messages', { id: 'm_' + crypto.randomUUID(), surface: 'agent', role, text, ts: Date.now(), ...scope,
    ...(role === 'ai' ? { status: 'complete' } : {}), ...(cards?.length ? { cards } : {}) });
  changed();
}

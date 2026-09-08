// @ts-check
let current = '';
try { current = localStorage.getItem('seeker-conversation') || ''; } catch { /* local preference is optional */ }
export function currentConversationId() { return current; }
/** @param {string} id */
export function setCurrentConversationId(id) {
  current = id;
  try { localStorage.setItem('seeker-conversation', id); } catch { /* data stays in the database */ }
}

// @ts-check
/**
 * Task Agent 的“有效职业资料”前端镜像规则。
 * Rust 在创建和执行时重复同一规则并拥有最终裁决权；这里仅用于提前隐藏空占位记录。
 */

const ENTRY_FIELDS = {
  work: ['org', 'title', 'summary', 'description', 'bullets'],
  projects: ['name', 'title', 'summary', 'description', 'bullets'],
  edu: ['org', 'title', 'major', 'degree', 'summary', 'description', 'bullets'],
};

const SUBSTANTIVE_FIELDS = [
  'summary', 'skills', 'strengths', 'certs', 'languages', 'honors', 'portfolio', 'research', 'other',
];

/** @param {unknown} value */
function hasText(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasText);
  if (value && typeof value === 'object') return Object.values(value).some(hasText);
  return false;
}

/** @param {Record<string, unknown>} resume */
export function hasProfessionalContent(resume) {
  for (const [section, fields] of Object.entries(ENTRY_FIELDS)) {
    const entries = resume[section];
    if (!Array.isArray(entries)) continue;
    if (entries.some((entry) => entry && typeof entry === 'object' && fields.some((field) => hasText(entry[field])))) return true;
  }
  return SUBSTANTIVE_FIELDS.some((field) => hasText(resume[field]));
}

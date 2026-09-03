// @ts-check
/**
 * Task Agent 输入的前端镜像规则。
 * Rust 在创建和执行时重复同一规则并拥有最终裁决权；这里仅用于提前隐藏空占位记录。
 */

const ENTRY_FIELDS = {
  work: ['org', 'title', 'summary', 'description', 'bullets'],
  projects: ['name', 'title', 'summary', 'description', 'bullets'],
  edu: ['org', 'title', 'major', 'degree', 'summary', 'description', 'bullets'],
};

const SUBSTANTIVE_FIELDS = [
  'summary', 'strengths', 'certs', 'languages', 'honors', 'portfolio', 'research', 'other',
];

const DATE_OR_PLACEHOLDER_WORDS = new Set([
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june',
  'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november',
  'dec', 'december', 'present', 'current', 'now', 'true', 'false', 'yes', 'no', 'null', 'undefined',
  'n', 'a', 'na', 'tbd', 'unknown', 'placeholder', '年', '月', '日', '至今', '当前',
]);
/** @param {string} value @param {boolean} allowBareDomain */
function isLinkOnly(value, allowBareDomain) {
  if (/\s/.test(value)) return false;
  const lower = value.toLowerCase();
  const scheme = lower.indexOf('://');
  if (scheme > 0 && /^[a-z][a-z0-9+.-]*$/.test(lower.slice(0, scheme)) && lower.length > scheme + 3) return true;
  if (lower.startsWith('mailto:') || /^\S+@\S+\.\S+$/.test(lower)) return true;
  if (allowBareDomain && !/[/?#]/.test(lower)) return false;
  let authority = lower.replace(/^\/\//, '').split(/[/?#]/, 1)[0].replace(/\.$/, '');
  const port = authority.lastIndexOf(':');
  if (port > 0 && /^\d+$/.test(authority.slice(port + 1))) authority = authority.slice(0, port);
  const labels = authority.split('.');
  if (labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label) && Number(label) <= 255)) return true;
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return false;
  const tld = labels.at(-1) || '';
  return /^[a-z]{2,24}$/.test(tld) || /^xn--[a-z0-9-]+$/.test(tld);
}

/** @param {string} value @param {boolean} allowBareDomain */
function isSubstantiveText(value, allowBareDomain) {
  const text = value.trim();
  if (!text) return false;
  if (isLinkOnly(text, allowBareDomain)) return false;
  const words = text.match(/\p{L}+/gu) || [];
  return words.length > 0 && !words.every((word) => DATE_OR_PLACEHOLDER_WORDS.has(word.toLowerCase()));
}

/** @param {unknown} value @param {boolean} [allowBareDomain] @returns {boolean} */
function hasSubstantiveText(value, allowBareDomain = false) {
  if (typeof value === 'string') return isSubstantiveText(value, allowBareDomain);
  if (Array.isArray(value)) return value.some((item) => hasSubstantiveText(item, allowBareDomain));
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasSubstantiveText(item, allowBareDomain));
  return false;
}

/** @param {Record<string, unknown>} resume */
export function hasProfessionalContent(resume) {
  for (const [section, fields] of Object.entries(ENTRY_FIELDS)) {
    const entries = resume[section];
    if (!Array.isArray(entries)) continue;
    if (entries.some((entry) => entry && typeof entry === 'object' && fields.some((field) => hasSubstantiveText(entry[field])))) return true;
  }
  return hasSubstantiveText(resume.skills, true) || SUBSTANTIVE_FIELDS.some((field) => hasSubstantiveText(resume[field]));
}

/**
 * 可执行岗位至少需要公司、职位，以及 JD 或必备技能之一。日期、链接和布尔占位均不计入。
 * @param {Record<string, unknown>} job
 */
export function hasJobContent(job) {
  const company = hasSubstantiveText(job.co) || hasSubstantiveText(job.company);
  const role = hasSubstantiveText(job.role) || hasSubstantiveText(job.title);
  const requirements = hasSubstantiveText(job.jd) || hasSubstantiveText(job.description) ||
    hasSubstantiveText(job.need, true) || hasSubstantiveText(job.requiredSkills, true);
  return company && role && requirements;
}

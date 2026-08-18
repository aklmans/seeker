import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : (path.endsWith('.js') ? [path] : []);
  });
}

test('ts-nocheck 债务只允许下降，当前上限锁为 32', () => {
  const unchecked = jsFiles(root).filter((path) => readFileSync(path, 'utf8').includes('@ts-nocheck'));
  assert.ok(unchecked.length <= 32, `@ts-nocheck 从 32 反增到 ${unchecked.length}:\n${unchecked.join('\n')}`);
});

test('数据与隐私持久化边界必须持续受 strict checkJs 约束', () => {
  const critical = [
    'platform/shell/data-store.js',
    'platform/shell/profile.js',
    'apps/jobseek/logic/persistence.js',
  ];
  for (const relative of critical) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.match(source, /^\/\/ @ts-check/m, relative + ' 应显式启用 @ts-check');
    assert.doesNotMatch(source, /@ts-nocheck/, relative + ' 不得退回类型豁免');
  }
});

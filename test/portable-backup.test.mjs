import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPortablePreferences,
  portablePreferenceKey,
  restorePortablePreferences,
} from '../web/platform/runtime/portable-prefs.js';
import { clearCollectionsSafely } from '../web/platform/runtime/data-clear.js';
import { normalizeBackupPolicy, persistBackupPolicy } from '../web/platform/runtime/backup-policy.js';

function storage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  return {
    get length() { return values.size; },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (k) => values.has(k) ? values.get(k) : null,
    setItem: (k, v) => { values.set(k, String(v)); },
    removeItem: (k) => { values.delete(k); },
    clear: () => values.clear(),
    dump: () => Object.fromEntries(values),
  };
}

test('便携偏好只收当前产品白名单，访问码与未知键结构性排除', () => {
  const source = storage({
    'jh-settings': '{"density":"compact"}',
    'jh-theme': 'dark',
    'jh-seeded-assets_notes': '1',
    'seeker-apps': '{"enabled":{}}',
    'jh-democode': 'ticket-secret',
    'api-key': 'secret',
  });
  assert.equal(portablePreferenceKey('jh-seeded-assets_notes'), true);
  assert.equal(portablePreferenceKey('jh-democode'), false);
  assert.deepEqual(collectPortablePreferences(source), {
    'jh-settings': '{"density":"compact"}',
    'jh-theme': 'dark',
    'jh-seeded-assets_notes': '1',
    'seeker-apps': '{"enabled":{}}',
  });
});

test('恢复偏好仍执行白名单和字符串校验', () => {
  const target = storage();
  const n = restorePortablePreferences({
    'jh-lang': 'en',
    'jh-project': 'p1',
    'jh-democode': 'must-not-restore',
    'jh-theme': { bad: true },
  }, target);
  assert.equal(n, 2);
  assert.deepEqual(target.dump(), { 'jh-lang': 'en', 'jh-project': 'p1' });
});

test('安全清空只接受运行时原子 clear 的可恢复成功结果', async () => {
  const calls = [];
  const rt = {
    db: {
      clear: async (collections) => {
        calls.push(collections);
        return { backupPath: '/tmp/seeker-backup.json', deleted: 3 };
      },
    },
  };
  const result = await clearCollectionsSafely(rt, ['jobs', 'jobs', 'messages']);
  assert.deepEqual(calls, [['jobs', 'messages']]);
  assert.deepEqual(result, { backupPath: '/tmp/seeker-backup.json', deleted: 3 });
});

test('备份失败或没有可恢复路径时不降级为逐行删除、不报告成功', async () => {
  let legacyDeletes = 0;
  const failed = {
    db: {
      clear: async () => { throw new Error('disk full'); },
      remove: async () => { legacyDeletes++; },
    },
  };
  await assert.rejects(clearCollectionsSafely(failed, ['jobs']), /disk full/);
  assert.equal(legacyDeletes, 0, '绝不退回旧的 best-effort 逐行删除');

  const lying = { db: { clear: async () => ({ backupPath: '', deleted: 9 }) } };
  await assert.rejects(clearCollectionsSafely(lying, ['jobs']), /备份未返回可恢复路径/);
});

test('自动备份策略以后端返回为准，写失败则交还旧 UI 值', async () => {
  assert.deepEqual(normalizeBackupPolicy({ enabled: false, lastBackupAt: 123 }), { value: 'off', lastBackupAt: 123 });
  assert.deepEqual(normalizeBackupPolicy({ enabled: true, lastBackupAt: null }), { value: 'on', lastBackupAt: null });

  const saved = await persistBackupPolicy('on', 'off', async (enabled) => ({ enabled, lastBackupAt: 456 }));
  assert.deepEqual(saved, { ok: true, value: 'off', lastBackupAt: 456, error: null });

  const failed = await persistBackupPolicy('on', 'off', async () => { throw new Error('disk locked'); });
  assert.equal(failed.ok, false);
  assert.equal(failed.value, 'on', '失败必须回滚到旧 UI 值');
  assert.match(String(failed.error), /disk locked/);
});

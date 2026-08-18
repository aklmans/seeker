import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dbPersistenceAvailable,
  profilePersistenceAvailable,
} from '../web/platform/runtime/persistence-capability.js';

function runtime(rows = []) {
  const upserts = [];
  return {
    upserts,
    available: (feature) => feature === 'db',
    db: {
      list: async () => rows,
      upsert: async (collection, record) => { upserts.push([collection, record]); return record; },
      remove: async () => null,
    },
    profile: { getAll: async () => ({}), set: async () => {} },
  };
}

test('持久化按运行时能力而非桌面 UA：Web rt.db / rt.profile 均可用', () => {
  const web = runtime();
  assert.equal(dbPersistenceAvailable(web), true);
  assert.equal(profilePersistenceAvailable(web), true);
  assert.equal(dbPersistenceAvailable({ ...web, available: () => false }), false);
  assert.equal(dbPersistenceAvailable({ db: {} }), false);
  assert.equal(profilePersistenceAvailable({ profile: { getAll() {} } }), false);
});

test('Web 空 IndexedDB 水合会清掉内存演示种子，不会静默复活', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
  };
  globalThis.window = { SeekerRT: runtime([]), SeekerShell: {} };
  const { hydrateColl, jobsPersistOn } = await import('../web/platform/shell/data-store.js');
  const records = [{ id: 'demo', title: '不应复活' }];
  assert.equal(jobsPersistOn(), true, 'Web runtime 的 db 能力应开启持久化');
  await hydrateColl('jobs', records);
  assert.deepEqual(records, [], '真实空库覆盖内存种子，保持诚实首次空态');
});

test('Web 有数据时水合并写入 onboarding 标记，变更也进入 IndexedDB 契约', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
  };
  const rt = runtime([{ id: 'j1', title: 'Persisted' }]);
  globalThis.window = { SeekerRT: rt, SeekerShell: {} };
  const { hydrateColl, persistColl } = await import('../web/platform/shell/data-store.js');
  const records = [];
  await hydrateColl('jobs', records);
  assert.deepEqual(records, [{ id: 'j1', title: 'Persisted' }]);
  assert.equal(values.get('jh-onboarded'), '1');
  persistColl('jobs', records);
  await Promise.resolve();
  assert.deepEqual(rt.upserts, [['jobs', { id: 'j1', title: 'Persisted' }]]);
});

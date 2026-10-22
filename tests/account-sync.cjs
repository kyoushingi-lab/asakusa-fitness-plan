// Simulated database tests with synthetic accounts; no emails or live API calls.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../account-sync.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const copy = value => JSON.parse(JSON.stringify(value));
function compare(a, b) { return a.revision - b.revision || (a.device_id > b.device_id ? 1 : a.device_id < b.device_id ? -1 : 0); }
function store(scope, device) {
  let rows = new Map(), listeners = new Set(), tracking = true, revision = 1, merges = 0;
  const raw = {};
  function project() { for (const row of rows.values()) { const key = row.kind + ':' + row.key; if (row.deleted) delete raw[key]; else raw[key] = copy(row.value); } }
  return {
    scope, raw, getScope() { return this.scope; }, get merges() { return merges; },
    stateEntries() { return copy([...rows.values()]); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    withoutTracking(fn) { const old = tracking; tracking = false; try { return fn(); } finally { tracking = old; } },
    set(kind, key, value, deleted = false) {
      const logical = kind + ':' + key;
      if (!tracking) { raw[logical] = value; return; }
      const row = { kind, key, value, deleted, revision: ++revision, device_id: device };
      rows.set(logical, row); project(); listeners.forEach(fn => fn([logical]));
    },
    mergeState(incoming) {
      merges++; const changed = [];
      for (const row of incoming) {
        if (row.user_id && this.scope !== 'user:' + row.user_id) continue;
        const key = row.kind + ':' + row.key, old = rows.get(key);
        revision = Math.max(revision, row.revision);
        if (!old || compare(row, old) > 0) { rows.set(key, copy(row)); changed.push(key); }
      }
      project(); if (changed.length) listeners.forEach(fn => fn(changed)); return changed;
    }
  };
}
function history(activeStore) {
  let entries = [], listeners = new Set(), merges = 0;
  return {
    get merges() { return merges; }, flush() {}, getEntries() { return copy(entries); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    add(entry) { entries.push(copy(entry)); listeners.forEach(fn => fn()); },
    merge(incoming) {
      merges++;
      for (const entry of incoming) if (!entries.some(row => row.id === entry.id)) entries.push(copy(entry));
      for (const entry of entries) activeStore.set('latest', entry.exercise, String(entry.kg));
      if (incoming.length) listeners.forEach(fn => fn());
    }
  };
}
function database() {
  return { weights: [], state: [], calls: [], fail: false, pause: null,
    client(uid) {
      const db = this;
      return {
        from(table) {
          let selectedUser = null;
          const query = {
            select() { return query; }, eq(key, value) { assert.equal(key, 'user_id'); selectedUser = value; return query; }, order() { return query; },
            async range(from, to) {
              db.calls.push({ method: 'select', table, uid, selectedUser, from, to });
              if (db.pause) { const pause = db.pause; db.pause = null; await pause; }
              if (db.fail) return { data: null, error: { message: 'synthetic outage' } };
              assert.equal(uid, selectedUser, 'every query must use its captured user');
              const rows = (table === 'weight_entries' ? db.weights : db.state).filter(row => row.user_id === uid);
              return { data: copy(rows.slice(from, to + 1)), error: null };
            },
            async upsert(batch, options) {
              db.calls.push({ method: 'upsert', table, uid, batch: copy(batch) });
              assert.equal(table, 'weight_entries'); assert.equal(options.ignoreDuplicates, true);
              assert.equal(options.onConflict, 'user_id,id'); assert.ok(batch.length <= 100);
              if (db.fail) return { data: null, error: { message: 'synthetic outage' } };
              for (const row of batch) {
                assert.equal(row.user_id, uid);
                if (!db.weights.some(old => old.user_id === uid && old.id === row.id)) db.weights.push(copy(row));
              }
              return { data: null, error: null };
            }
          }; return query;
        },
        async rpc(name, { p_rows, p_expected_user }) {
          assert.ok(name === 'merge_fitness_state' || name === 'import_fitness_state'); assert.ok(p_rows.length <= 100);
          assert.equal(p_expected_user, uid, 'RPC must reject a changed bearer-token owner');
          if (db.rpcTokenOverride && db.rpcTokenOverride !== p_expected_user) return { data: null, error: { code: '42501', message: 'Synthetic account changed before RPC' } };
          db.calls.push({ method: 'rpc', name, uid, rows: copy(p_rows) });
          if (db.fail) return { data: null, error: { message: 'synthetic outage' } };
          if (name === 'import_fitness_state') {
            if (db.beforeImport) await db.beforeImport();
            if (db.failImport) return { data: null, error: { message: 'synthetic import outage' } };
          }
          const results = [];
          for (const row of p_rows) {
            assert.equal(row.user_id, undefined, 'server binds the owner');
            let old = db.state.find(item => item.user_id === uid && item.kind === row.kind && item.key === row.key);
            if (!old) { old = { ...copy(row), user_id: uid }; db.state.push(old); }
            else if (name === 'merge_fitness_state' && compare(row, old) > 0) Object.assign(old, copy(row));
            results.push(copy(old));
          }
          return { data: results, error: null };
        }
      };
    }
  };
}
function device(db, uid = A, name = 'device-a', scope = 'user:' + uid) {
  const listeners = new Map(), statuses = [], projections = [];
  const context = { console, navigator: { onLine: true }, setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  context.window = context;
  context.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(source, context);
  const state = store(scope, name), weights = history(state);
  const controller = context.GymAccountSync.create({ client: db.client(uid), user: { id: uid, email: 'synthetic@example.invalid' }, store: state, history: weights,
    onStatus: value => statuses.push(value), onState: keys => projections.push({ keys: [...keys], raw: copy(state.raw) }) });
  return { controller, state, weights, context, statuses, projections, stop() { controller.stop(); } };
}
const entry = (id, kg = 7.5) => ({ id, exercise: 'chest', kg, date: '2020-01-22', time: '10:00', at: '2020-01-22T01:00:00Z' });
async function scenario(name, fn) { await fn(); console.log('PASS ' + name); }
(async () => {
  await scenario('local guest and mismatched account scopes never make API requests', async () => {
    const db = database(), guest = device(db, A, 'guest', 'guest'), mismatch = device(db, A, 'other', 'user:' + B);
    guest.weights.add(entry('guest-only')); await guest.controller.sync(); await mismatch.controller.sync();
    assert.equal(db.calls.length, 0); guest.stop(); mismatch.stop();
  });
  await scenario('two devices sync weight history, calendar, check-ins, settings and preferences for the same account', async () => {
    const db = database(), a = device(db), b = device(db, A, 'phone');
    a.weights.add(entry('first')); a.state.set('calendar', '2020-01-22', { plan: 'a' });
    a.state.set('checkin', '2020-01-22.mon-chest', true); a.state.set('setting', 'chest.seat', '2');
    a.state.set('preference', 'cycle-fallback', 'b'); a.state.set('latest', 'chest', '7.5');
    await a.controller.sync(); await b.controller.sync();
    assert.equal(b.weights.getEntries().length, 1);
    assert.deepEqual(b.state.raw['calendar:2020-01-22'], { plan: 'a' });
    assert.equal(b.state.raw['checkin:2020-01-22.mon-chest'], true);
    assert.equal(b.state.raw['setting:chest.seat'], '2'); assert.equal(b.state.raw['preference:cycle-fallback'], 'b');
    assert.ok(a.statuses.at(-1).startsWith('已同步')); a.stop(); b.stop();
  });
  await scenario('different accounts cannot read or upload another account history or settings', async () => {
    const db = database(), a = device(db), b = device(db, B, 'friend');
    a.weights.add(entry('private-a', 7.5)); a.state.set('setting', 'chest.seat', '2'); await a.controller.sync();
    b.weights.add(entry('private-b', 15)); b.state.set('setting', 'chest.seat', '7'); await b.controller.sync(); await a.controller.sync();
    assert.deepEqual(a.weights.getEntries().map(row => row.id), ['private-a']);
    assert.deepEqual(b.weights.getEntries().map(row => row.id), ['private-b']);
    assert.equal(a.state.raw['setting:chest.seat'], '2'); assert.equal(b.state.raw['setting:chest.seat'], '7'); a.stop(); b.stop();
  });
  await scenario('offline edits merge by logical date and tombstones survive reconnect', async () => {
    const db = database(), a = device(db), b = device(db, A, 'phone');
    a.state.set('calendar', '2020-01-20', { plan: 'a' }); await a.controller.sync(); await b.controller.sync();
    a.context.navigator.onLine = false; a.state.set('calendar', '2020-01-22', { plan: 'b' }); await a.controller.sync();
    assert.match(a.statuses.at(-1), /离线/);
    b.state.set('calendar', '2020-01-21', { plan: 'c' }); b.state.set('calendar', '2020-01-20', null, true); await b.controller.sync();
    a.context.navigator.onLine = true; await a.controller.sync(); await b.controller.sync();
    assert.equal(a.state.raw['calendar:2020-01-20'], undefined);
    assert.deepEqual(b.state.raw['calendar:2020-01-22'], { plan: 'b' });
    assert.deepEqual(a.state.raw['calendar:2020-01-21'], { plan: 'c' });
    assert.equal(db.state.find(row => row.key === '2020-01-20').deleted, true); a.stop(); b.stop();
  });
  await scenario('RPC returns the winning conflict value and an explicit blank latest load stays blank', async () => {
    const db = database(), a = device(db), b = device(db, A, 'device-z');
    a.weights.add(entry('old-load', 7.5)); a.state.set('latest', 'chest', '');
    b.state.set('setting', 'chest.seat', '7'); a.state.set('setting', 'chest.seat', '2');
    await b.controller.sync(); await a.controller.sync(); await b.controller.sync();
    assert.equal(a.state.raw['latest:chest'], ''); assert.equal(b.state.raw['latest:chest'], '');
    assert.equal(a.projections.at(-1).raw['latest:chest'], '');
    assert.equal(a.state.raw['setting:chest.seat'], b.state.raw['setting:chest.seat']);
    assert.equal(db.weights.length, 1); await a.controller.sync(); assert.equal(db.weights.length, 1); a.stop(); b.stop();
  });
  await scenario('server errors preserve local edits and retry successfully', async () => {
    const db = database(), a = device(db); db.fail = true;
    a.weights.add(entry('pending')); a.state.set('calendar', '2020-01-22', { plan: 'a' }); await a.controller.sync();
    assert.match(a.statuses.at(-1), /本机记录已保留/); assert.equal(a.weights.getEntries().length, 1);
    assert.deepEqual(a.state.raw['calendar:2020-01-22'], { plan: 'a' });
    db.fail = false; await a.controller.sync(); assert.equal(db.weights.length, 1); assert.equal(db.state.length, 1); a.stop();
  });
  await scenario('stop suppresses late downloads and does not upload from the prior account', async () => {
    const db = database(), a = device(db); let release;
    db.pause = new Promise(resolve => { release = resolve; }); a.weights.add(entry('pending-old'));
    const pending = a.controller.sync(); const before = a.statuses.length; a.stop(); release(); await pending;
    assert.equal(a.weights.merges, 0); assert.equal(a.state.merges, 0); assert.equal(db.weights.length, 0);
    assert.equal(a.statuses.length, before); assert.equal(db.calls.length, 1);
  });
  await scenario('RPC rejects a bearer-token account change without uploading state to that account', async () => {
    const db = database(), a = device(db);
    a.state.set('setting', 'chest.seat', '2'); db.rpcTokenOverride = B;
    await a.controller.sync(); assert.equal(db.state.length, 0);
    assert.equal(a.state.raw['setting:chest.seat'], '2'); assert.match(a.statuses.at(-1), /本机记录已保留/); a.stop();
  });
  await scenario('guest import inserts only missing keys and returns server winners including tombstones and concurrent inserts', async () => {
    const db = database(), a = device(db);
    const cloud = (kind, key, value, deleted = false) => ({ user_id: A, kind, key, value, revision: 10, device_id: 'cloud', deleted });
    db.state.push(cloud('setting', 'chest.seat', '2'), cloud('calendar', '2020-01-20', { plan: 'c' }), cloud('latest', 'chest', ''), cloud('calendar', '2020-01-19', null, true));
    const row = (kind, key, value) => ({ kind, key, value, revision: 99999, device_id: 'guest', deleted: false });
    const snapshot = { weights: [entry('guest-import')], states: [row('setting', 'chest.seat', '7'), row('calendar', '2020-01-20', { plan: 'a' }), row('calendar', '2020-01-21', { plan: 'b' }), row('latest', 'chest', '7.5'), row('calendar', '2020-01-19', { plan: 'a' }), row('setting', 'row.height', '5')] };
    const original = copy(snapshot);
    db.beforeImport = () => { if (!db.state.some(row => row.key === 'row.height')) db.state.push(cloud('setting', 'row.height', '9')); };
    assert.equal(await a.controller.importGuest(snapshot), true);
    assert.equal(a.state.raw['setting:chest.seat'], '2'); assert.deepEqual(a.state.raw['calendar:2020-01-20'], { plan: 'c' });
    assert.deepEqual(a.state.raw['calendar:2020-01-21'], { plan: 'b' }); assert.equal(a.state.raw['setting:row.height'], '9');
    assert.equal(a.state.raw['calendar:2020-01-19'], undefined); assert.equal(a.state.raw['latest:chest'], '');
    assert.equal(a.weights.getEntries().length, 1); assert.equal(db.weights.length, 1); assert.deepEqual(snapshot, original);
    assert.equal(await a.controller.importGuest(snapshot), true); assert.equal(db.weights.length, 1);
    assert.equal(db.state.find(row => row.key === '2020-01-19').deleted, true); a.stop();
  });
  await scenario('guest import refuses offline or failed preflight/import RPC and leaves guest data available for retry', async () => {
    const db = database(), a = device(db), snapshot = { weights: [entry('retry-guest')], states: [{ kind: 'setting', key: 'chest.seat', value: '2', revision: 100, device_id: 'guest', deleted: false }] };
    a.context.navigator.onLine = false; assert.equal(await a.controller.importGuest(snapshot), false);
    assert.equal(db.calls.length, 0); assert.equal(a.weights.getEntries().length, 0);
    a.context.navigator.onLine = true; db.fail = true; assert.equal(await a.controller.importGuest(snapshot), false);
    assert.equal(db.calls.filter(call => call.name === 'import_fitness_state').length, 0);
    db.fail = false; db.failImport = true; assert.equal(await a.controller.importGuest(snapshot), false);
    assert.equal(a.weights.getEntries().length, 0); assert.equal(db.state.length, 0); assert.equal(snapshot.weights.length, 1);
    db.failImport = false; assert.equal(await a.controller.importGuest(snapshot), true); assert.equal(db.weights.length, 1); a.stop();
  });
  await scenario('guest import rejects a token switch before its insert-only RPC', async () => {
    const db = database(), a = device(db); db.rpcTokenOverride = B;
    assert.equal(await a.controller.importGuest({ weights: [entry('wrong-token-guest')], states: [{ kind: 'setting', key: 'chest.seat', value: '2', revision: 100, device_id: 'guest', deleted: false }] }), false);
    assert.equal(db.state.length, 0); assert.equal(db.weights.length, 0); assert.equal(a.weights.getEntries().length, 0); a.stop();
  });
  await scenario('stop guards a late import response and prevents merging or uploading old guest weights', async () => {
    const db = database(), a = device(db); let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    db.beforeImport = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const imported = a.controller.importGuest({ weights: [entry('stopped-guest')], states: [{ kind: 'setting', key: 'chest.seat', value: '2', revision: 100, device_id: 'guest', deleted: false }] });
    await started; const before = a.state.merges; a.stop(); release();
    assert.equal(await imported, false); assert.equal(a.state.merges, before); assert.equal(a.weights.getEntries().length, 0); assert.equal(db.weights.length, 0);
  });
  await scenario('guest import rejects snapshots or combined unique histories above 10000 before state insertion', async () => {
    const db = database(), a = device(db), oversized = Array.from({ length: 10001 }, (_, n) => entry('oversized-' + n));
    assert.equal(await a.controller.importGuest({ weights: oversized, states: [] }), false);
    assert.equal(db.calls.filter(call => call.name === 'import_fitness_state').length, 0); assert.equal(a.weights.getEntries().length, 0);
    assert.equal(await a.controller.importGuest({ weights: Array.from({ length: 10001 }, () => entry('same-id')), states: [] }), false);
    assert.equal(db.weights.length, 0);
    for (let n = 0; n < 9999; n++) db.weights.push({ ...entry('seed-' + n), user_id: A });
    const candidate = { weights: [entry('guest-a'), entry('guest-b')], states: [{ kind: 'setting', key: 'chest.seat', value: '2', revision: 100, device_id: 'guest', deleted: false }] };
    assert.equal(await a.controller.importGuest(candidate), false);
    assert.equal(db.state.length, 0); assert.equal(db.calls.filter(call => call.name === 'import_fitness_state').length, 0);
    assert.equal(a.weights.getEntries().length, 9999); assert.equal(candidate.weights.length, 2);
    assert.equal(await a.controller.importGuest({ weights: [entry('seed-0')], states: [] }), true);
    assert.equal(a.weights.getEntries().length, 9999); assert.equal(db.weights.length, 9999); a.stop();
  });
  await scenario('pagination and bounded batches preserve more than 1000 rows', async () => {
    const db = database(), a = device(db);
    for (let n = 0; n < 1002; n++) { a.weights.add(entry('weight-' + n)); a.state.set('setting', 'synthetic-' + n, n); }
    await a.controller.sync(); assert.equal(db.weights.length, 1002); assert.equal(db.state.length, 1002);
    const b = device(db, A, 'phone'); await b.controller.sync();
    assert.equal(b.weights.getEntries().length, 1002); assert.equal(b.state.stateEntries().length, 1002);
    assert.ok(db.calls.some(call => call.table === 'fitness_state' && call.from === 1000)); a.stop(); b.stop();
  });
  console.log('14 account sync scenarios passed (simulated SDK/database; no real email or backend calls).');
})().catch(error => { console.error(error); process.exitCode = 1; });


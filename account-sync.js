(function (root) {
  'use strict';
  var PAGE = 1000, BATCH = 100;
  var STATE_COLUMNS = 'user_id,kind,key,value,revision,device_id,deleted,updated_at';
  var WEIGHT_COLUMNS = 'id,exercise,kg,date,time,at';

  function create(options) {
    options = options || {};
    var client = options.client, store = options.store, history = options.history;
    // Capture the identity; a token refresh must not silently turn this controller
    // into a controller for another account. The bootstrap creates a new one.
    var userId = options.user && String(options.user.id || '');
    var expectedScope = 'user:' + userId;
    var stopped = false, syncing = false, importing = false, rerun = false, applying = false;
    var importPromise = null;
    var debounce = null, interval = null, pending = null, changed = new Set();
    var offStore = null, offHistory = null;
    var doc = root.document;
    function scope() { return store && (typeof store.getScope === 'function' ? store.getScope() : store.scope); }
    function current() { return !stopped && !!userId && scope() === expectedScope; }
    function say(message) { if (current() && typeof options.onStatus === 'function') options.onStatus(message); }
    function visible() { return !doc || !doc.hidden; }
    function rememberKeys(keys) { if (Array.isArray(keys)) keys.forEach(function (key) { changed.add(key); }); }
    function projection(rows) {
      applying = true;
      try {
        rememberKeys(store.mergeState(rows));
        if (typeof store.projectState === 'function') rememberKeys(store.projectState());
      } finally { applying = false; }
    }
    function notifyState() {
      if (!current()) return;
      // A history merge can update raw load values even if CRDT state is unchanged.
      // Passing [] still asks the bootstrap to refresh its UI from the active store.
      var keys = Array.from(changed); changed.clear();
      if (typeof options.onState === 'function') options.onState(keys);
    }
    function schedule() {
      if (!current()) return;
      if (syncing || importing) { rerun = true; return; }
      root.clearTimeout(debounce);
      debounce = root.setTimeout(sync, 1200);
    }
    function localChange(keys) {
      if (applying) { rememberKeys(keys); return; }
      schedule();
    }
    function flush() {
      // flush is a local user change, but it belongs to this sync attempt already.
      applying = true;
      try { history.flush(); } finally { applying = false; }
    }
    function checked(result) {
      if (result && result.error) throw result.error;
      if (!result || !Array.isArray(result.data)) throw new Error('Invalid sync response');
      return result.data;
    }
    async function fetchRows(table, columns, order) {
      var rows = [], offset = 0;
      while (current()) {
        var query = client.from(table).select(columns).eq('user_id', userId);
        order.forEach(function (field) { query = query.order(field, { ascending: true }); });
        var result = await query.range(offset, offset + PAGE - 1);
        if (!current()) return null;
        var page = checked(result); rows = rows.concat(page);
        if (page.length < PAGE) return rows;
        offset += PAGE;
      }
      return null;
    }
    async function perform() {
      if (!current()) return false;
      if (root.navigator && root.navigator.onLine === false) {
        say('当前离线：已保存到本机，联网后自动同步。'); return false;
      }
      syncing = true; changed.clear();
      say('正在同步重量、训练日历、打卡和个人设置…');
      try {
        flush();
        var cloudWeights = await fetchRows('weight_entries', WEIGHT_COLUMNS, ['at', 'id']);
        if (!current() || !cloudWeights) return false;
        var cloudState = await fetchRows('fitness_state', STATE_COLUMNS, ['kind', 'key']);
        if (!current() || !cloudState) return false;
        applying = true;
        try {
          // Legacy history merging derives latest weights. Do not turn that
          // derivation into a newer user edit, especially for an explicit blank.
          if (typeof store.withoutTracking === 'function') store.withoutTracking(function () { history.merge(cloudWeights); });
          else history.merge(cloudWeights);
        } finally { applying = false; }
        // State is versioned independently for every date/control. Pulling one
        // device's calendar cannot replace a different date edited on this device.
        // Project it after history, including the user's explicit blank loads.
        projection(cloudState);
        notifyState();
        if (!current()) return false;
        flush();
        var ids = new Set(cloudWeights.map(function (entry) { return entry.id; }));
        var missing = history.getEntries().filter(function (entry) { return !ids.has(entry.id); });
        for (var start = 0; start < missing.length; start += BATCH) {
          if (!current()) return false;
          var batch = missing.slice(start, start + BATCH).map(function (entry) {
            return { user_id: userId, id: entry.id, exercise: entry.exercise, kg: entry.kg,
              date: entry.date, time: entry.time, at: entry.at };
          });
          var uploaded = await client.from('weight_entries').upsert(batch, { onConflict: 'user_id,id', ignoreDuplicates: true });
          if (!current()) return false;
          if (!uploaded || uploaded.error) throw uploaded && uploaded.error || new Error('Weight upload failed');
        }
        var stateRows = store.stateEntries();
        for (var position = 0; position < stateRows.length; position += BATCH) {
          if (!current()) return false;
          // Ownership and updated_at are bound by the server, never trusted from
          // browser data. An RPC returns winners even when our edit was stale.
          var outgoing = stateRows.slice(position, position + BATCH).map(function (row) {
            return { kind: row.kind, key: row.key, value: row.value, revision: row.revision,
              device_id: row.device_id, deleted: row.deleted === true };
          });
          var merged = await client.rpc('merge_fitness_state', { p_rows: outgoing, p_expected_user: userId });
          if (!current()) return false;
          projection(checked(merged));
        }
        projection([]); notifyState();
        if (!current()) return false;
        say('已同步 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) +
          ' · ' + history.getEntries().length + ' 条重量记录；日历、打卡和设置仅此账号可见。');
        return true;
      } catch (error) {
        if (current()) { projection([]); notifyState(); say('同步暂未成功，本机记录已保留。联网后重试，或点“立即同步”。'); }
        return false;
      } finally {
        syncing = false;
        if (rerun && current()) { rerun = false; schedule(); }
      }
    }
    function runSync() {
      if (!current()) return Promise.resolve(false);
      root.clearTimeout(debounce); debounce = null;
      if (syncing) { rerun = true; return pending; }
      pending = perform(); return pending;
    }
    function sync() {
      if (!current()) return Promise.resolve(false);
      if (importing) { rerun = true; return importPromise || Promise.resolve(false); }
      return runSync();
    }
    async function performImport(snapshot) {
      try {
        // A fresh sync must succeed before even attempting an import. Existing
        // server keys are protected atomically by the insert-only import RPC,
        // including keys written by another device after this initial pull.
        if (await runSync() !== true || !current()) return false;
        var combinedIds = new Set(history.getEntries().map(function(entry){return entry.id;}));
        snapshot.weights.forEach(function(entry){combinedIds.add(entry.id);});
        if(combinedIds.size>10000)throw Error('Too many weight records');
        say('正在合并游客记录，账号已有的日期与设置优先…');
        for (var start = 0; start < snapshot.states.length; start += BATCH) {
          if (!current()) return false;
          var batch = snapshot.states.slice(start, start + BATCH).map(function (row) {
            return { kind: row.kind, key: row.key, value: row.value, revision: row.revision,
              device_id: row.device_id, deleted: row.deleted === true };
          });
          var result = await client.rpc('import_fitness_state', { p_rows: batch, p_expected_user: userId });
          if (!current()) return false;
          projection(checked(result));
        }
        if (!current()) return false;
        applying = true;
        try {
          store.withoutTracking(function () { history.merge(snapshot.weights, true); });
        } finally { applying = false; }
        projection([]); notifyState();
        if (!current()) return false;
        // Reuse the normal owner-bound, append-only weight upload. On a token
        // switch, RLS rejects its explicit user_id; it cannot write to the new user.
        return await runSync() === true && current();
      } catch (error) {
        if (current()) {
          projection([]); notifyState();
          say('游客记录暂未导入完成，原游客记录已保留。联网后可以重试。');
        }
        return false;
      } finally {
        importing = false;
        if (rerun && current()) { rerun = false; schedule(); }
      }
    }
    function importGuest(snapshot) {
      if (!current()) return Promise.resolve(false);
      if (importing) return importPromise;
      if (!snapshot || !Array.isArray(snapshot.weights) || snapshot.weights.length>10000 || !Array.isArray(snapshot.states) || snapshot.states.length>100000) {
        say('游客记录格式无法读取，原记录已保留。请先导出备份。'); return Promise.resolve(false);
      }
      // Snapshot the caller's candidate data; later guest edits are never mutated.
      var candidate;
      try { candidate = JSON.parse(JSON.stringify(snapshot)); }
      catch (error) { return Promise.resolve(false); }
      importing = true;
      importPromise = performImport(candidate); return importPromise;
    }
    function onVisible() { if (visible()) sync(); }
    function stop() {
      stopped = true; rerun = false;
      root.clearTimeout(debounce); root.clearInterval(interval);
      if (typeof offStore === 'function') offStore();
      if (typeof offHistory === 'function') offHistory();
      if (root.removeEventListener) {
        root.removeEventListener('online', sync); root.removeEventListener('focus', onVisible);
      }
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisible);
      changed.clear();
    }
    if (current()) {
      if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function' || !history || !store) throw new Error('Missing account sync dependencies');
      if (typeof store.subscribe === 'function') offStore = store.subscribe(localChange);
      if (typeof history.subscribe === 'function') offHistory = history.subscribe(localChange);
      if (root.addEventListener) { root.addEventListener('online', sync); root.addEventListener('focus', onVisible); }
      if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisible);
      interval = root.setInterval(onVisible, 30000);
    }
    return { sync: sync, stop: stop, importGuest: importGuest };
  }
  root.GymAccountSync = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GymAccountSync;
})(typeof window !== 'undefined' ? window : globalThis);

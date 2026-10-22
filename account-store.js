/* Scoped local records and per-entity merge state. No network or authentication side effects. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GymAccountStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var HISTORY = 'gym-compatible.history.v1', PENDING = 'gym-compatible.pending.v1';
  var ROTATION = 'gym-compatible.rotation.v1', OWNER = 'gym-compatible.sync-owner.v1';
  var SETTING = 'gym-compatible.setting.', LOAD = 'gym-compatible.load.', DONE = 'gym-compatible.done.';
  var MACHINE = /^(pulldown|row|chest|triceps|abs|legpress|glute|legcurl|abductor)$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var shared = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  // A physical device can have multiple independent pages editing in the same millisecond.
  var pageActor = typeof document !== 'undefined' ? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) : '';
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function dateOK(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parsed = new Date(value + 'T00:00:00Z');
    return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === value;
  }
  function sessionOK(value) {
    return value && dateOK(value.date) && /^[abc]$/.test(value.plan) && typeof value.at === 'string' && !isNaN(Date.parse(value.at));
  }
  function parseRotation(raw) {
    if (raw === null) return { version: 1, next: 'a', sessions: [], busy: [] };
    try {
      var data = JSON.parse(raw);
      if (!data || data.version !== 1 || !/^[abc]$/.test(data.next) || !Array.isArray(data.sessions) || !Array.isArray(data.busy) || data.sessions.length > 10000 || data.busy.length > 10000) return null;
      if (!data.sessions.every(sessionOK) || !data.busy.every(dateOK) || new Set(data.sessions.map(function (s) { return s.date; })).size !== data.sessions.length) return null;
      return data;
    } catch (error) { return null; }
  }
  function weightOK(value) {
    return value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 120 && MACHINE.test(value.exercise) && typeof value.kg === 'number' && Number.isFinite(value.kg) && value.kg >= 0 && value.kg <= 9999 && dateOK(value.date) && typeof value.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) && typeof value.at === 'string' && !isNaN(Date.parse(value.at));
  }
  function parseHistory(raw) {
    if (raw === null) return [];
    try { var data = JSON.parse(raw); return Array.isArray(data) && data.length <= 10000 && data.every(weightOK) ? data : null; }
    catch (error) { return null; }
  }
  function parsePending(raw) {
    try {
      var data = JSON.parse(raw || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
      return Object.keys(data).filter(function (key) { return MACHINE.test(key) && weightOK(data[key]) && data[key].exercise === key; }).map(function (key) { return data[key]; });
    } catch (error) { return []; }
  }
  function pendingMap(raw) {
    if (raw === null) return {};
    try {
      var data = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every(function (key) { return MACHINE.test(key) && weightOK(data[key]) && data[key].exercise === key; }) ? data : null;
    } catch (error) { return null; }
  }
  function draftOK(row) {
    return row && MACHINE.test(row.key) && Number.isSafeInteger(row.revision) && row.revision >= 0 && typeof row.device_id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(row.device_id) && typeof row.deleted === 'boolean' && (row.deleted ? row.value === null : weightOK(row.value) && row.value.exercise === row.key);
  }
  function randomDevice() {
    return 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function settingKey(key) {
    var split = key.indexOf('.');
    return split > 0 && MACHINE.test(key.slice(0, split)) && /^[a-z][a-z0-9_-]{0,39}$/.test(key.slice(split + 1));
  }
  function latestValue(value) { return typeof value === 'string' && (value === '' || (value.trim() === value && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 9999)); }
  function rowOK(row) {
    if (!row || typeof row.kind !== 'string' || typeof row.key !== 'string' || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.device_id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(row.device_id) || typeof row.deleted !== 'boolean') return false;
    var value = row.value;
    if (row.kind === 'calendar') {
      if (!dateOK(row.key)) return false;
      if (row.deleted) return value === null;
      return value && typeof value === 'object' && !Array.isArray(value) && typeof value.busy === 'boolean' && (value.session === null || (sessionOK(value.session) && value.session.date === row.key)) && !(value.session && value.busy);
    }
    if (row.kind === 'checkin') return /^\d{4}-\d{2}-\d{2}\.[A-Za-z0-9_-]{1,80}$/.test(row.key) && dateOK(row.key.slice(0, 10)) && (row.deleted ? value === null : typeof value === 'boolean');
    if (row.kind === 'setting') return settingKey(row.key) && (row.deleted ? value === null : typeof value === 'string' && value.length <= 80);
    if (row.kind === 'latest') return MACHINE.test(row.key) && (row.deleted ? value === null : latestValue(value));
    return row.kind === 'preference' && row.key === 'cycle-fallback' && (row.deleted ? value === null : typeof value === 'string' && /^[abc]$/.test(value));
  }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function identity(row) { return row.kind + '\u0000' + row.key; }
  function newer(a, b) { return !b || a.revision > b.revision || (a.revision === b.revision && a.device_id > b.device_id); }
  function compareKeys(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function create(options) {
    options = options || {};
    var scope = options.scope;
    if (scope !== 'guest' && !(typeof scope === 'string' && scope.slice(0, 5) === 'user:' && UUID.test(scope.slice(5)))) throw new Error('Invalid account scope');
    var storage = options.storage;
    if (!storage) {
      try { storage = globalThis.localStorage; } catch (error) { /* Private browsing can deny access to the getter itself. */ }
      if (!storage) storage = { getItem: function () { throw Error('Storage unavailable'); }, setItem: function () { throw Error('Storage unavailable'); } };
    }
    var memory = shared && shared.get(storage);
    if (!memory) { memory = { values: Object.create(null), overrides: Object.create(null) }; if (shared) shared.set(storage, memory); }
    var volatile = false, prefix = 'gym-account.v2|' + scope + '|', stateKey = prefix + '__state';
    var records = Object.create(null), drafts = Object.create(null), weights = Object.create(null), seen = Object.create(null), maxSeen = 0, listeners = [], silent = 0;
    var opPrefix = prefix + '__op|', draftPrefix = prefix + '__draft|', weightPrefix = prefix + '__weight|';
    var lastFingerprint = null, refreshing = false;
    var clock = typeof options.now === 'function' ? options.now : function () { return typeof options.now === 'number' ? options.now : Date.now(); };
    function readPhysical(key) {
      if (own(memory.overrides, key)) return memory.overrides[key];
      try { var value = storage.getItem(key); memory.values[key] = value; return value; }
      catch (error) { volatile = true; return own(memory.values, key) ? memory.values[key] : null; }
    }
    function writePhysical(key, value) {
      memory.values[key] = value;
      try { storage.setItem(key, value); delete memory.overrides[key]; }
      catch (error) { volatile = true; memory.overrides[key] = value; }
    }
    function storageKeys() {
      var keys = new Set(Object.keys(memory.values));
      try { for (var i = 0; i < storage.length; i++) { var key = storage.key(i); if (key !== null) keys.add(key); } }
      catch (error) { volatile = true; }
      return Array.from(keys);
    }
    function logicalKeys() { return storageKeys().filter(function (key) { return key.indexOf(prefix + 'gym-compatible.') === 0; }).map(function (key) { return key.slice(prefix.length); }); }
    function peek(key) { return readPhysical(prefix + key); }
    function get(key) {
      if (refreshStored(false)) project(new Set());
      var value = peek(key); seen[key] = value; return value;
    }
    function put(key, value, changed) { if (peek(key) !== value) { writePhysical(prefix + key, value); if (changed) changed.add(key); } }
    function emit(changed) {
      var keys = Array.from(changed).sort(compareKeys);
      if (keys.length && !silent) listeners.slice().forEach(function (listener) { try { listener(keys.slice()); } catch (error) { /* One view cannot interrupt record persistence. */ } });
      return keys;
    }
    var deviceId = readPhysical('gym-account.device.v2');
    if (!deviceId || !/^[A-Za-z0-9_-]{1,120}$/.test(deviceId)) { deviceId = randomDevice(); writePhysical('gym-account.device.v2', deviceId); }
    if (pageActor) deviceId = deviceId.slice(0, 90) + '-p' + pageActor;
    var rawState = readPhysical(stateKey);
    if (rawState) {
      try {
        var saved = JSON.parse(rawState);
        if (!Array.isArray(saved) || saved.length > 100000 || !saved.every(rowOK)) throw Error('Invalid state');
        saved.forEach(function (row) { if (newer(row, records[identity(row)])) records[identity(row)] = clone(row); maxSeen = Math.max(maxSeen, row.revision); });
      } catch (error) {
        // Preserve a damaged state log before a later explicit local edit replaces it.
        if (readPhysical(stateKey + '.recovery') === null) writePhysical(stateKey + '.recovery', rawState);
      }
    }
    function listState() { return Object.keys(records).sort(compareKeys).map(function (key) { return clone(records[key]); }); }
    function stateEntries() { refreshStored(false); return listState(); }
    function journalKey(base, row) { return base + encodeURIComponent(row.kind || 'draft') + '|' + encodeURIComponent(row.key) + '|' + row.revision + '|' + row.device_id; }
    function rememberWeight(entry) {
      var added = !own(weights, entry.id), key = weightPrefix + encodeURIComponent(entry.id), old;
      try { old = JSON.parse(readPhysical(key)); } catch (error) { /* An invalid journal item cannot replace a valid entry. */ }
      if (added) weights[entry.id] = clone(weightOK(old) && old.id === entry.id ? old : entry);
      if (!weightOK(old)) writePhysical(key, JSON.stringify(weights[entry.id]));
      return added;
    }
    function fingerprint() {
      var size = 0;
      try { size = storage.length || 0; } catch (error) { volatile = true; }
      return size + ':' + Object.keys(memory.overrides).length + ':' + (readPhysical(stateKey) || '');
    }
    function refreshStored(force) {
      if (refreshing) return false;
      var stamp = fingerprint();
      if (!force && stamp === lastFingerprint) return false;
      refreshing = true; var changed = false;
      try {
        var checkpoint;
        try { checkpoint = JSON.parse(readPhysical(stateKey) || '[]'); } catch (error) { checkpoint = []; }
        if (Array.isArray(checkpoint)) checkpoint.forEach(function (row) {
          if (rowOK(row)) { maxSeen = Math.max(maxSeen, row.revision); if (newer(row, records[identity(row)])) { records[identity(row)] = clone(row); changed = true; } }
        });
        storageKeys().forEach(function (key) {
          if (key.indexOf(opPrefix) !== 0 && key.indexOf(draftPrefix) !== 0 && key.indexOf(weightPrefix) !== 0) return;
          var row;
          try { row = JSON.parse(readPhysical(key)); } catch (error) { return; }
          if (key.indexOf(opPrefix) === 0 && rowOK(row)) {
            maxSeen = Math.max(maxSeen, row.revision);
            if (newer(row, records[identity(row)])) { records[identity(row)] = clone(row); changed = true; }
          } else if (key.indexOf(draftPrefix) === 0 && draftOK(row)) {
            maxSeen = Math.max(maxSeen, row.revision);
            if (newer(row, drafts[row.key])) { drafts[row.key] = clone(row); changed = true; }
          } else if (key.indexOf(weightPrefix) === 0 && weightOK(row) && !own(weights, row.id)) { weights[row.id] = clone(row); changed = true; }
        });
        var history = parseHistory(peek(HISTORY));
        if (history) history.forEach(function (entry) { if (!own(weights, entry.id)) { weights[entry.id] = clone(entry); changed = true; } });
      } finally { refreshing = false; lastFingerprint = fingerprint(); }
      return changed;
    }
    function saveState() {
      // Append immutable operations first. A simultaneous checkpoint write can
      // replace the snapshot, but cannot erase another page's distinct journal key.
      listState().forEach(function (row) { var key = journalKey(opPrefix, row); if (readPhysical(key) === null) writePhysical(key, JSON.stringify(row)); });
      Object.keys(drafts).forEach(function (id) { var row = drafts[id], key = journalKey(draftPrefix, row); if (readPhysical(key) === null) writePhysical(key, JSON.stringify(row)); });
      writePhysical(stateKey, JSON.stringify(listState())); lastFingerprint = null;
    }
    function nextRevision() {
      var now = Number(clock()); if (!Number.isFinite(now) || now < 0) now = Date.now();
      maxSeen = Math.max(Math.floor(now), maxSeen + 1);
      if (!Number.isSafeInteger(maxSeen)) throw Error('State revision exhausted');
      return maxSeen;
    }
    function localRow(kind, key, value, deleted) {
      var id = kind + '\u0000' + key, previous = records[id];
      if (previous && previous.deleted === !!deleted && equal(previous.value, value)) return false;
      records[id] = { kind: kind, key: key, value: clone(value), revision: nextRevision(), device_id: deviceId, deleted: !!deleted };
      return true;
    }
    function calendarMap(rotation) {
      var map = Object.create(null);
      if (!rotation) return map;
      rotation.busy.forEach(function (date) { map[date] = { session: null, busy: true }; });
      rotation.sessions.forEach(function (session) { map[session.date] = { session: clone(session), busy: false }; });
      return map;
    }
    function track(key, value, previousValue) {
      if (key.indexOf(LOAD) === 0 && MACHINE.test(key.slice(LOAD.length))) {
        if (!latestValue(value)) throw Error('Invalid latest weight');
        return localRow('latest', key.slice(LOAD.length), value, false);
      }
      if (key.indexOf(SETTING) === 0 && settingKey(key.slice(SETTING.length))) {
        if (value.length > 80) throw Error('Setting exceeds 80 characters');
        return localRow('setting', key.slice(SETTING.length), value, false);
      }
      if (key.indexOf(DONE) === 0) {
        var checkinKey = key.slice(DONE.length), probe = { kind: 'checkin', key: checkinKey, value: value === 'yes', revision: 0, device_id: deviceId, deleted: false };
        if ((value !== 'yes' && value !== 'no') || !rowOK(probe)) throw Error('Invalid check-in');
        return localRow('checkin', checkinKey, value === 'yes', false);
      }
      if (key === ROTATION) {
        var incoming = parseRotation(value);
        if (!incoming) return false; // Keep the caller's raw data readable for recovery; never invent an empty calendar.
        var old = calendarMap(parseRotation(previousValue)), fresh = calendarMap(incoming), changed = false;
        var dates = new Set(Object.keys(old).concat(Object.keys(fresh)));
        dates.forEach(function (date) {
          if (equal(old[date] || null, fresh[date] || null)) return;
          if (localRow('calendar', date, own(fresh, date) ? fresh[date] : null, !own(fresh, date))) changed = true;
        });
        var previousRotation = parseRotation(previousValue);
        if ((!previousRotation || previousValue === null || previousRotation.next !== incoming.next) && localRow('preference', 'cycle-fallback', incoming.next, false)) changed = true;
        return changed;
      }
      if (key === PENDING) {
        var incomingPending = pendingMap(value), previousPending = pendingMap(previousValue) || {}, pendingChanged = false;
        if (!incomingPending) return false;
        new Set(Object.keys(previousPending).concat(Object.keys(incomingPending))).forEach(function (machine) {
          var before = previousPending[machine], after = incomingPending[machine], current = drafts[machine];
          if (equal(before || null, after || null)) return;
          // A late flush removes only the draft it actually committed; a newer
          // draft from another page for the same control remains pending.
          if (!after && current && !current.deleted && (!before || current.value.id !== before.id)) return;
          drafts[machine] = { key: machine, value: after ? clone(after) : null, revision: nextRevision(), device_id: deviceId, deleted: !after };
          pendingChanged = true;
        });
        return pendingChanged;
      }
      return false;
    }
    function project(changed) {
      var calendarRows = [], hasCalendar = false, fallback = null;
      Object.keys(records).forEach(function (id) {
        var row = records[id];
        if (row.kind === 'latest') put(LOAD + row.key, row.deleted ? '' : row.value, changed);
        else if (row.kind === 'setting') put(SETTING + row.key, row.deleted ? '' : row.value, changed);
        else if (row.kind === 'checkin') put(DONE + row.key, !row.deleted && row.value ? 'yes' : 'no', changed);
        else if (row.kind === 'calendar') { hasCalendar = true; if (!row.deleted) calendarRows.push(row); }
        else if (row.kind === 'preference') fallback = row.deleted ? 'a' : row.value;
      });
      if (hasCalendar || fallback !== null) {
        var current = parseRotation(peek(ROTATION));
        // A broken calendar stays untouched, even when valid cloud state arrives.
        if (current) {
          var sessions = [], busy = [];
          calendarRows.sort(function (a, b) { return compareKeys(a.key, b.key); }).forEach(function (row) { if (row.value.session) sessions.push(clone(row.value.session)); else if (row.value.busy) busy.push(row.key); });
          var next = sessions.length ? { a: 'b', b: 'c', c: 'a' }[sessions[sessions.length - 1].plan] : fallback || current.next;
          put(ROTATION, JSON.stringify({ version: 1, next: next, sessions: sessions, busy: busy }), changed);
        }
      }
      var history = parseHistory(peek(HISTORY));
      if (history) {
        var ids = new Set(history.map(function (entry) { return entry.id; }));
        Object.keys(weights).sort(compareKeys).forEach(function (id) { if (!ids.has(id)) { history.push(clone(weights[id])); ids.add(id); } });
        if (history.length || peek(HISTORY) !== null) put(HISTORY, JSON.stringify(history), changed);
      }
      if (Object.keys(drafts).length && pendingMap(peek(PENDING))) {
        var pending = {};
        Object.keys(drafts).sort(compareKeys).forEach(function (key) { if (!drafts[key].deleted) pending[key] = clone(drafts[key].value); });
        put(PENDING, JSON.stringify(pending), changed);
      }
    }
    function projectState() { refreshStored(false); var changed = new Set(); project(changed); return emit(changed); }
    function refreshFromStorage() { refreshStored(true); var changed = new Set(); project(changed); return emit(changed); }
    function set(key, value) {
      if (typeof key !== 'string' || key.indexOf('gym-compatible.') !== 0 || key.length > 250 || typeof value !== 'string') throw Error('Invalid logical record');
      if (key.indexOf(SETTING) === 0 && value.length > 80) throw Error('Setting exceeds 80 characters');
      if (key.indexOf(LOAD) === 0 && MACHINE.test(key.slice(LOAD.length)) && !latestValue(value)) throw Error('Invalid latest weight');
      refreshStored(false);
      var submitted = value, previous = own(seen, key) ? seen[key] : peek(key), changed = new Set(), tracked = false;
      // Keep recoverable raw input separate before an explicit import repairs malformed history/calendar.
      if ((key === HISTORY && parseHistory(previous) === null) || (key === ROTATION && parseRotation(previous) === null)) {
        if (peek(key + '.recovery') === null) writePhysical(prefix + key + '.recovery', previous);
      }
      if (key === HISTORY && parseHistory(value)) {
        parseHistory(value).forEach(rememberWeight);
        var currentHistory = parseHistory(peek(key)) || [], existingIds = new Set(currentHistory.map(function (entry) { return entry.id; }));
        Object.keys(weights).sort(compareKeys).forEach(function (id) { if (!existingIds.has(id)) currentHistory.push(clone(weights[id])); });
        value = JSON.stringify(currentHistory);
      }
      if (!silent) tracked = track(key, value, previous);
      put(key, value, changed);
      if (tracked) { saveState(); project(changed); }
      // Retain what this caller actually saw/submitted, not dates or drafts
      // discovered only through another page's physical cache.
      seen[key] = key === PENDING || key === ROTATION ? submitted : value;
      emit(changed);
    }
    function mergeState(rows) {
      if (!Array.isArray(rows) || rows.length > 100000 || !rows.every(rowOK) || rows.some(function (row) { return own(row, 'user_id') && (scope === 'guest' || row.user_id !== scope.slice(5)); })) throw Error('Invalid account state');
      // Deep-clone the complete batch before changing any state; malformed/cyclic input is atomic.
      var incoming = rows.map(function (row) { return { kind: row.kind, key: row.key, value: clone(row.value), revision: row.revision, device_id: row.device_id, deleted: row.deleted }; }), dirty = false;
      refreshStored(false);
      incoming.forEach(function (row) {
        maxSeen = Math.max(maxSeen, row.revision);
        if (newer(row, records[identity(row)])) { records[identity(row)] = row; dirty = true; }
      });
      if (dirty) saveState();
      return projectState();
    }
    function withoutTracking(callback) { silent++; try { return callback(); } finally { silent--; } }
    function migrate() {
      var marker = 'gym-account.migrated.v2|' + scope;
      if (readPhysical(marker) === '1') return;
      var owner = readPhysical(OWNER), destination = owner ? 'user:' + owner : 'guest';
      var legacyKeys = storageKeys().filter(function (key) { return key.indexOf('gym-compatible.') === 0; });
      var actual = false;
      if (scope === destination) {
        legacyKeys.forEach(function (key) {
          var value = readPhysical(key);
          if (value === null) return;
          if (peek(key) === null) writePhysical(prefix + key, value);
          if (key === HISTORY) actual = actual || !!(parseHistory(value) || []).length;
          else if (key === PENDING) actual = actual || parsePending(value).length > 0;
          else if (key === ROTATION) { var data = parseRotation(value); actual = actual || !!(data && (data.sessions.length || data.busy.length || data.next !== 'a')); }
          else if ((key.indexOf(LOAD) === 0 && value !== '') || key.indexOf(DONE) === 0 || key.indexOf(SETTING) === 0) actual = true;
        });
        if (actual) Object.keys(options.seedSettings || {}).forEach(function (key) { if (key.indexOf(SETTING) === 0 && settingKey(key.slice(SETTING.length)) && typeof options.seedSettings[key] === 'string' && options.seedSettings[key].length <= 80 && peek(key) === null) writePhysical(prefix + key, options.seedSettings[key]); });
      }
      var dirty = false;
      logicalKeys().forEach(function (key) { try { if (track(key, peek(key), null)) dirty = true; } catch (error) { /* Malformed legacy fields remain intact without becoming sync state. */ } });
      if (dirty) saveState();
      project(new Set());
      writePhysical(marker, '1');
    }
    refreshStored(true);migrate();
    (parseHistory(peek(HISTORY)) || []).forEach(rememberWeight);
    // A previous tab may have refreshed a cache from append-only weight history.
    // Explicit current-state clears remain authoritative when reopening this scope.
    project(new Set());
    seen = Object.create(null);
    function guestStore() { return create({ scope: 'guest', storage: storage, seedSettings: options.seedSettings, now: clock }); }
    function guestData() {
      var guest = guestStore(), rawHistory = guest.get(HISTORY), weights = parseHistory(rawHistory), rawRotation = guest.get(ROTATION), rotation = parseRotation(rawRotation);
      var pending = parsePending(guest.get(PENDING));
      if (weights) {
        var ids = new Set(weights.map(function (row) { return row.id; }));
        pending.forEach(function (row) { if (!ids.has(row.id)) { weights.push(row); ids.add(row.id); } });
      }
      var states = guest.stateEntries();
      return { guest: guest, weights: weights, rotation: rotation, pending: pending, states: states };
    }
    function guestSummary() {
      var data = guestData(), result = { weights: data.weights ? data.weights.length : 0, calendar: data.rotation ? data.rotation.sessions.length + data.rotation.busy.length : 0, checkins: 0, settings: 0, latest: 0, pending: data.pending.length };
      data.states.forEach(function (row) { if (!row.deleted) { if (row.kind === 'checkin') result.checkins++; else if (row.kind === 'setting') result.settings++; else if (row.kind === 'latest') result.latest++; } });
      result.hasData = result.weights + result.calendar + result.checkins + result.settings + result.latest > 0;
      return result;
    }
    function guestSnapshot() {
      // Preparing an import is deliberately read-only: do not instantiate another
      // store (which could migrate/project data), advance versions or repair caches.
      function snapshotOf(targetScope) {
        var base = 'gym-account.v2|' + targetScope + '|';
        function raw(key) { return readPhysical(base + key); }
        var history = parseHistory(raw(HISTORY)), rotation = parseRotation(raw(ROTATION));
        if (!history || !rotation) throw Error('Unreadable records: export a backup before importing');
        var state = Object.create(null), savedDrafts = Object.create(null), savedWeights = Object.create(null);
        history.forEach(function (entry) { if (!own(savedWeights, entry.id)) savedWeights[entry.id] = clone(entry); });
        function stateRow(row) { if (rowOK(row) && newer(row, state[identity(row)])) state[identity(row)] = clone(row); }
        try { var checkpoint = JSON.parse(readPhysical(base + '__state') || '[]'); if (Array.isArray(checkpoint)) checkpoint.forEach(stateRow); } catch (error) { /* Journals may still contain valid state. */ }
        storageKeys().forEach(function (key) {
          if (key.indexOf(base + '__op|') !== 0 && key.indexOf(base + '__draft|') !== 0 && key.indexOf(base + '__weight|') !== 0) return;
          var row;
          try { row = JSON.parse(readPhysical(key)); } catch (error) { return; }
          if (key.indexOf(base + '__op|') === 0) stateRow(row);
          else if (key.indexOf(base + '__draft|') === 0 && draftOK(row) && newer(row, savedDrafts[row.key])) savedDrafts[row.key] = clone(row);
          else if (key.indexOf(base + '__weight|') === 0 && weightOK(row) && !own(savedWeights, row.id)) savedWeights[row.id] = clone(row);
        });
        var pending = Object.create(null);
        parsePending(raw(PENDING)).forEach(function (entry) { pending[entry.exercise] = entry; });
        Object.keys(savedDrafts).forEach(function (key) { var row = savedDrafts[key]; if (row.deleted) delete pending[key]; else pending[key] = row.value; });
        Object.keys(pending).forEach(function (key) { var entry = pending[key]; if (!own(savedWeights, entry.id)) savedWeights[entry.id] = clone(entry); });
        return { history: Object.keys(savedWeights).sort(compareKeys).map(function (id) { return savedWeights[id]; }), rotation: rotation, state: state, raw: raw };
      }
      var guest = snapshotOf('guest'), target = snapshotOf(scope);
      var dates = new Set(target.rotation.sessions.map(function (session) { return session.date; }).concat(target.rotation.busy));
      var states = Object.keys(guest.state).sort(compareKeys).map(function (key) { return guest.state[key]; }).filter(function (row) {
        if (row.deleted || row.kind === 'preference' || own(target.state, identity(row))) return false;
        if (row.kind === 'calendar') return !dates.has(row.key);
        if (row.kind === 'setting') return target.raw(SETTING + row.key) === null;
        if (row.kind === 'latest') return target.raw(LOAD + row.key) === null;
        if (row.kind === 'checkin') return target.raw(DONE + row.key) === null;
        return false;
      });
      if(guest.history.length>10000)throw Error('Too many weight records: export a backup before importing');
      return { weights: clone(guest.history), states: clone(states) };
    }
    function importGuest() {
      var result = { weights: 0, calendar: 0, checkins: 0, settings: 0, latest: 0, changedKeys: [] };
      if (scope === 'guest') return result;
      var data = guestData(), targetHistory = parseHistory(get(HISTORY)), targetRotation = parseRotation(get(ROTATION));
      if (!data.weights || !data.rotation || !targetHistory || !targetRotation) throw Error('Unreadable records: export a backup before importing');
      var changed = new Set(), ids = new Set(targetHistory.map(function (entry) { return entry.id; }));
      data.weights.forEach(function (entry) { if (!ids.has(entry.id)) { targetHistory.push(clone(entry)); ids.add(entry.id); result.weights++; } });
      if (targetHistory.length > 10000) throw Error('Too many weight records');
      // All validation above happens before the first target mutation.
      if (result.weights) { set(HISTORY, JSON.stringify(targetHistory)); changed.add(HISTORY); }
      var targetDates = new Set(targetRotation.sessions.map(function (s) { return s.date; }).concat(targetRotation.busy));
      data.rotation.sessions.forEach(function (session) { if (!targetDates.has(session.date) && !own(records, 'calendar\u0000' + session.date)) { targetRotation.sessions.push(clone(session)); targetDates.add(session.date); result.calendar++; } });
      data.rotation.busy.forEach(function (date) { if (!targetDates.has(date) && !own(records, 'calendar\u0000' + date)) { targetRotation.busy.push(date); targetDates.add(date); result.calendar++; } });
      if (result.calendar) { targetRotation.sessions.sort(function (a, b) { return compareKeys(a.date, b.date); }); if (targetRotation.sessions.length) targetRotation.next = { a: 'b', b: 'c', c: 'a' }[targetRotation.sessions[targetRotation.sessions.length - 1].plan]; set(ROTATION, JSON.stringify(targetRotation)); changed.add(ROTATION); }
      data.states.forEach(function (row) {
        if (row.deleted) return;
        var logical, count;
        if (row.kind === 'checkin') { logical = DONE + row.key; count = 'checkins'; }
        else if (row.kind === 'setting') { logical = SETTING + row.key; count = 'settings'; }
        else if (row.kind === 'latest') { logical = LOAD + row.key; count = 'latest'; }
        else return;
        if (get(logical) === null && !own(records, identity(row))) { set(logical, row.kind === 'checkin' ? row.value ? 'yes' : 'no' : row.value); result[count]++; changed.add(logical); }
      });
      result.changedKeys = Array.from(changed).sort(compareKeys);
      return result;
    }
    var api = {
      get: get, set: set, stateEntries: stateEntries, mergeState: mergeState,
      projectState: projectState, refreshFromStorage: refreshFromStorage, withoutTracking: withoutTracking,
      guestSummary: guestSummary, guestSnapshot: guestSnapshot, importGuest: importGuest,
      getScope: function () { return scope; }, isVolatile: function () { return volatile; },
      subscribe: function (listener) { if (typeof listener !== 'function') throw Error('Invalid subscriber'); listeners.push(listener); return function () { listeners = listeners.filter(function (fn) { return fn !== listener; }); }; }
    };
    Object.defineProperty(api, 'scope', { value: scope, enumerable: true, writable: false });
    return api;
  }
  return { create: create };
});

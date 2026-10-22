// Synthetic browser integration only: SDK Auth is mocked, every remote request
// is intercepted, and no email or Supabase user is created by this test.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  playwright = require('C:/Users/YE XINXI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const engine = process.argv[2] || 'webkit', root = path.resolve(__dirname, '..');
const A = '71111111-1111-4111-8111-111111111111', B = '72222222-2222-4222-8222-222222222222';
const API = 'https://fitness-accounts.example.invalid', SESSION = '__fitness_accounts_test.session';
const TODAY = '2020-01-10', CLOCK = new Date(TODAY + 'T12:00:00+09:00');
const email = uid => uid === A ? 'account-a@example.invalid' : 'account-b@example.invalid';
const clone = value => JSON.parse(JSON.stringify(value));
const winner = (a, b) => a.revision - b.revision || (a.device_id > b.device_id ? 1 : a.device_id < b.device_id ? -1 : 0);
function session(uid) {
  if (!uid) return null;
  const exp = 4102444800;
  const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' +
    Buffer.from(JSON.stringify({ sub: uid, exp, role: 'authenticated' })).toString('base64url') + '.synthetic';
  return { access_token: token, refresh_token: 'synthetic-refresh', expires_at: exp, expires_in: 3600,
    token_type: 'bearer', user: { id: uid, email: email(uid), aud: 'authenticated', role: 'authenticated' } };
}
function mockSDK() {
  const key = '__fitness_accounts_test.session';
  const handlers = new Set();
  const requests = { email: [], anonymous: 0, createUser: 0, logout: [] };
  function read() { const value = localStorage.getItem(key); return value ? JSON.parse(value) : null; }
  function emit(next, event) {
    if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key);
    handlers.forEach(handler => handler(event || (next ? 'SIGNED_IN' : 'SIGNED_OUT'), next));
  }
  async function remote(url, method = 'GET', body, extraHeaders) {
    const active = read(), headers = { apikey: 'synthetic-public-key', 'Content-Type': 'application/json', ...extraHeaders };
    if (active) headers.Authorization = 'Bearer ' + active.access_token;
    try {
      const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(), data = text ? JSON.parse(text) : null;
      return response.ok ? { data, error: null } : { data: null, error: data || { message: 'Synthetic failure' } };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  }
  window.__fitnessAccountsAuth = { emit, requests, read };
  window.supabase = { createClient(url) {
    return {
      auth: {
        getSession: async () => ({ data: { session: read() }, error: null }),
        getUser: async () => ({ data: { user: read() && read().user }, error: null }),
        onAuthStateChange(fn) { handlers.add(fn); return { data: { subscription: { unsubscribe() { handlers.delete(fn); } } } }; },
        async signInWithOtp(payload) { requests.email.push(payload); return { data: { user: null, session: null }, error: null }; },
        async signInAnonymously() { requests.anonymous++; throw Error('Guests must remain local'); },
        async signUp() { requests.createUser++; throw Error('Unexpected user creation'); },
        async signOut(options) { requests.logout.push(options); emit(null, 'SIGNED_OUT'); return { error: null }; }
      },
      from(table) {
        const parameters = new URLSearchParams(), order = [];
        const query = {
          select(columns) { parameters.set('select', columns); return query; },
          eq(column, value) { parameters.set(column, 'eq.' + value); return query; },
          order(column, options) { order.push(column + (options && options.ascending === false ? '.desc' : '.asc')); parameters.set('order', order.join(',')); return query; },
          range(from, to) { parameters.set('offset', from); parameters.set('limit', to - from + 1); return remote(url + '/rest/v1/' + table + '?' + parameters); },
          upsert(batch, options) {
            const suffix = '?on_conflict=' + encodeURIComponent(options.onConflict);
            return remote(url + '/rest/v1/' + table + suffix, 'POST', batch, { Prefer: options.ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates' });
          }
        }; return query;
      },
      rpc(name, payload) { return remote(url + '/rest/v1/rpc/' + name, 'POST', payload); }
    };
  } };
}
function database() { return { weights: [], state: [], calls: [], fail: false }; }
function state(uid, kind, key, value, revision = 100) {
  return { user_id: uid, kind, key, value, revision, device_id: 'remote-fixture', deleted: false, updated_at: '2020-01-06T00:00:00Z' };
}
function training(date, plan) { return { date, plan, at: date + 'T01:00:00Z', completed: [], skipped: {} }; }
function weight(uid, id, exercise, kg) { return { user_id: uid, id, exercise, kg, date: '2020-01-06', time: '10:00', at: '2020-01-06T01:00:00Z' }; }
let browser, server, origin;
const contexts = new Set();
async function device(db, initialUid = null, configuration = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Tokyo' });
  contexts.add(context);
  await context.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(origin + '/') || url.startsWith(API + '/') ? route.fallback() : route.abort('blockedbyclient');
  });
  if (initialUid) await context.addInitScript(({ key, initial }) => {
    if (!localStorage.getItem('__fitness_accounts_test.initialized')) {
      localStorage.setItem(key, JSON.stringify(initial)); localStorage.setItem('__fitness_accounts_test.initialized', 'yes');
    }
  }, { key: SESSION, initial: session(initialUid) });
  await context.route('**/cloud-config.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.GYM_CLOUD=' + JSON.stringify({ url: API, key: 'synthetic-public-key', emailLoginPaused: false, ...configuration }) + ';' }));
  await context.route('**/vendor/supabase.js*', route => route.fulfill({ contentType: 'application/javascript', body: '(' + mockSDK.toString() + ')();' }));
  await context.route(API + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), token = (request.headers().authorization || '').replace(/^Bearer /, '');
    const uid = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub : null;
    db.calls.push({ uid, path: url.pathname, method: request.method() });
    assert.ok(uid === A || uid === B, 'guests must not call the data API');
    if (db.fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic outage"}' });
    if (url.pathname.startsWith('/auth/')) throw Error('Real auth endpoints are forbidden in this integration test');
    let result;
    if (url.pathname === '/rest/v1/rpc/merge_fitness_state' || url.pathname === '/rest/v1/rpc/import_fitness_state') {
      const payload = request.postDataJSON(), input = payload.p_rows;
      assert.equal(payload.p_expected_user, uid, 'RPC expected owner must match the bearer token');
      assert.ok(input.length <= 100); result = [];
      for (const row of input) {
        assert.equal(row.user_id, undefined, 'RPC ownership must be server-bound');
        let stored = db.state.find(old => old.user_id === uid && old.kind === row.kind && old.key === row.key);
        if (!stored) { stored = { ...clone(row), user_id: uid }; db.state.push(stored); }
        else if (url.pathname.endsWith('/merge_fitness_state') && winner(row, stored) > 0) Object.assign(stored, clone(row));
        result.push(clone(stored));
      }
    } else if (request.method() === 'GET') {
      assert.equal(url.searchParams.get('user_id'), 'eq.' + uid, 'every SELECT must filter the active owner');
      const table = url.pathname.endsWith('/weight_entries') ? db.weights : db.state;
      const from = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
      result = clone(table.filter(row => row.user_id === uid).slice(from, from + limit));
    } else if (url.pathname.endsWith('/weight_entries') && request.method() === 'POST') {
      assert.match(request.headers().prefer, /ignore-duplicates/);
      const batch = request.postDataJSON(); assert.ok(batch.length <= 100);
      for (const row of batch) {
        assert.equal(row.user_id, uid);
        if (!db.weights.some(old => old.user_id === uid && old.id === row.id)) db.weights.push(clone(row));
      }
      return route.fulfill({ status: 201, body: '' });
    } else throw Error('Unexpected mocked API request: ' + request.method() + ' ' + url.pathname);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  await page.clock.install({ time: CLOCK }); await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#mon-row input.load') && !document.querySelector('#mon-row input.load').disabled);
  await page.waitForFunction(() => { const status = document.querySelector('#runtimeStatus'); return status && (status.classList.contains('runtime-ready') || status.textContent.includes('组件暂未加载')); });
  assert.equal(await page.locator('#runtimeStatus').getAttribute('class'), 'runtime-ready', await page.locator('#runtimeStatus').textContent());
  return { context, page, errors, async close() { assert.deepEqual(errors, [], 'uncaught browser errors'); contexts.delete(context); await context.close(); } };
}
async function expose(locator) {
  await locator.evaluate(element => { let parent = element.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } });
}
async function inputSetting(page, key, value) {
  const locator = page.locator('[data-setting="' + key + '"]').first(); await expose(locator); await locator.fill(value); await locator.blur();
}
async function completed(page, date, plan) {
  const field = page.locator('#cycleDate'); await expose(field); await field.fill(date);
  await page.locator('#cycleNext').selectOption(plan); await page.locator('#cycleComplete').click();
  await page.waitForFunction(({ date, plan }) => Array.from(document.querySelectorAll('#cycleLog li')).some(row => row.textContent.includes(date) && row.textContent.includes(plan.toUpperCase())), { date, plan });
}
async function synced(page) { await page.waitForFunction(() => document.querySelector('#syncStatus').textContent.startsWith('已同步')); }
async function accountOptions(page) {
  if (!await page.locator('#accountOptions').evaluate(element => element.open)) await page.locator('#accountOptionsLabel').click();
}
async function sync(page) { await accountOptions(page); await page.locator('#syncNow').click(); await synced(page); }
async function guest(page) {
  await page.waitForFunction(() => document.querySelector('#syncLogout').hidden && /游客/.test(document.querySelector('#accountMode').textContent));
}
async function loggedIn(page, uid) {
  await page.waitForFunction(address => !document.querySelector('#syncLogout').hidden &&
    [document.querySelector('#accountName'), document.querySelector('#syncAccount')].some(element => element && element.textContent.includes(address)), email(uid));
  await synced(page);
}
async function login(page, uid, withEvent = true) {
  if (withEvent) await page.evaluate(next => { setTimeout(() => window.__fitnessAccountsAuth.emit(next, 'SIGNED_IN'), 0); }, session(uid));
  else { await page.evaluate(({ key, next }) => localStorage.setItem(key, JSON.stringify(next)), { key: SESSION, next: session(uid) }); await page.reload(); }
  await loggedIn(page, uid);
}
async function logout(page) { await accountOptions(page); await page.locator('#syncLogout').click(); await guest(page); }
async function scenario(name, fn) { await fn(); console.log('PASS ' + name); }
(async () => {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright[engine].launch(engine === 'chromium' && process.env.ACCOUNT_CHROME_PATH ? { executablePath: process.env.ACCOUNT_CHROME_PATH } : {});
  await scenario('guest stays local and login link requests send no real email or anonymous signup', async () => {
    const db = database(), d = await device(db); await guest(d.page);
    await d.page.locator('#guestContinue').click();
    await d.page.locator('#mon-row input.load').fill('17.5'); await d.page.locator('#mon-row input.load').blur();
    await inputSetting(d.page, 'row.fore_aft', '10');
    await accountOptions(d.page); await d.page.locator('#syncEmail').fill(email(A)); await d.page.locator('#syncSend').click();
    const auth = await d.page.evaluate(() => window.__fitnessAccountsAuth.requests);
    assert.equal(auth.anonymous, 0); assert.equal(auth.createUser, 0); assert.equal(auth.email.length, 1);
    assert.equal(auth.email[0].email, email(A)); assert.equal(db.calls.length, 0); await d.close();
  });
  await scenario('first account starts blank and login/logout/auth reloads never mix account data', async () => {
    const db = database(), d = await device(db); await guest(d.page);
    await d.page.locator('#mon-row input.load').fill('17.5'); await inputSetting(d.page, 'row.fore_aft', '10');
    await completed(d.page, '2020-01-06', 'a'); await d.page.locator('#mon-row .done').check();
    await login(d.page, A);
    for (const input of await d.page.locator('input.load').all()) assert.equal(await input.inputValue(), '');
    for (const input of await d.page.locator('[data-setting]').all()) assert.equal(await input.inputValue(), '');
    assert.equal(await d.page.locator('#mon-row .done').isChecked(), false);
    assert.doesNotMatch(await d.page.locator('#cycleLog').textContent(), /2020-01-06/);
    assert.equal(db.weights.length, 0, 'guest history must not auto-upload');
    await d.page.locator('#mon-row input.load').fill('25'); await inputSetting(d.page, 'row.fore_aft', '8'); await sync(d.page);
    await login(d.page, B);
    assert.equal(await d.page.locator('#mon-row input.load').inputValue(), '');
    assert.equal(await d.page.locator('[data-setting="row.fore_aft"]').first().inputValue(), '');
    assert.equal(await d.page.locator('#historyRows tr').count(), 0);
    await login(d.page, A, false);
    assert.equal(await d.page.locator('#mon-row input.load').inputValue(), '25');
    assert.equal(await d.page.locator('[data-setting="row.fore_aft"]').first().inputValue(), '8');
    await logout(d.page);
    assert.equal(await d.page.locator('#mon-row input.load').inputValue(), '17.5');
    assert.equal(await d.page.locator('[data-setting="row.fore_aft"]').first().inputValue(), '10');
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-06.*A/);
    await d.close();
  });
  await scenario('remote weights, calendar, check-ins and personal settings hydrate into the active UI', async () => {
    const db = database(); db.weights.push(weight(A, 'remote-row', 'row', 17.5));
    db.state.push(state(A, 'calendar', '2020-01-06', { session: training('2020-01-06', 'b'), busy: false }),
      state(A, 'calendar', '2020-01-07', { session: null, busy: true }),
      state(A, 'checkin', TODAY + '.mon-row', true), state(A, 'setting', 'row.fore_aft', '8'), state(A, 'latest', 'row', '17.5'));
    const d = await device(db, A); await loggedIn(d.page, A);
    assert.equal(await d.page.locator('#mon-row input.load').inputValue(), '17.5');
    assert.match(await d.page.locator('#historyRows').textContent(), /2020-01-06/);
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-06.*B/);
    assert.match(await d.page.locator('#cycleCalendar [data-date="2020-01-07"]').textContent(), /忙碌/);
    assert.equal(await d.page.locator('#mon-row .done').isChecked(), true);
    assert.equal(await d.page.locator('[data-setting="row.fore_aft"]').first().inputValue(), '8');
    assert.equal((await d.page.locator('[data-setting-value="row.fore_aft"]').first().textContent()).trim(), '8');
    await d.close();
  });
  await scenario('guest import requires a click and preserves existing account records on the same date', async () => {
    const db = database(); db.state.push(state(A, 'calendar', '2020-01-06', { session: training('2020-01-06', 'c'), busy: false }), state(A, 'setting', 'row.fore_aft', '8'));
    const d = await device(db); await guest(d.page);
    await d.page.locator('#mon-row input.load').fill('17.5'); await inputSetting(d.page, 'row.fore_aft', '10');
    await completed(d.page, '2020-01-06', 'a'); await completed(d.page, '2020-01-08', 'b');
    await login(d.page, A);
    assert.equal(await d.page.locator('#historyRows tr').count(), 0);
    assert.doesNotMatch(await d.page.locator('#cycleLog').textContent(), /2020-01-08/);
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-06.*C/);
    await expose(d.page.locator('#importGuest'));
    await d.page.locator('#importGuest').waitFor({ state: 'visible' });
    await d.page.waitForFunction(() => !document.querySelector('#importGuest').disabled);
    const importedReload = d.page.waitForEvent('framenavigated', { predicate: frame => frame === d.page.mainFrame() });
    await d.page.locator('#importGuest').click();
    await importedReload; await d.page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready')); await synced(d.page);
    await d.page.waitForFunction(() => document.querySelector('#historyRows').textContent.includes('17.5'));
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-06.*C/);
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-08.*B/);
    assert.equal(await d.page.locator('[data-setting="row.fore_aft"]').first().inputValue(), '8');
    await sync(d.page); const second = await device(db, A); await loggedIn(second.page, A);
    assert.match(await second.page.locator('#cycleLog').textContent(), /2020-01-06.*C/);
    assert.match(await second.page.locator('#cycleLog').textContent(), /2020-01-08.*B/);
    assert.match(await second.page.locator('#historyRows').textContent(), /17.5/);
    await second.close(); await d.close();
  });
  await scenario('guest import refreshes a stale account cache before preserving remote same-day records and settings', async () => {
    const db = database(), d = await device(db); await guest(d.page);
    await d.page.locator('#mon-row input.load').fill('17.5'); await inputSetting(d.page, 'row.fore_aft', '10');
    await completed(d.page, '2020-01-06', 'a'); await completed(d.page, '2020-01-08', 'b');
    await login(d.page, A); assert.equal(await d.page.locator('#historyRows tr').count(), 0);
    // Another device writes after this page finished its initial hydration.
    // The import must first pull these rows; a local timestamp must not replace them.
    db.state.push(state(A, 'calendar', '2020-01-06', { session: training('2020-01-06', 'c'), busy: false }, 200), state(A, 'setting', 'row.fore_aft', '8', 200));
    await expose(d.page.locator('#importGuest'));
    const importedReload = d.page.waitForEvent('framenavigated', { predicate: frame => frame === d.page.mainFrame() });
    await d.page.locator('#importGuest').click();
    await importedReload; await d.page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready'));
    await d.page.waitForFunction(() => document.querySelector('#historyRows').textContent.includes('17.5'));
    await synced(d.page);
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-06.*C/);
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-08.*B/);
    assert.equal(await d.page.locator('[data-setting="row.fore_aft"]').first().inputValue(), '8');
    await sync(d.page);
    assert.equal(db.state.find(row => row.user_id === A && row.kind === 'calendar' && row.key === '2020-01-06').value.session.plan, 'c');
    assert.equal(db.state.find(row => row.user_id === A && row.kind === 'setting' && row.key === 'row.fore_aft').value, '8');
    await d.close();
  });
  await scenario('personal adjustment inputs stay equal across repeated machine cards and a second device', async () => {
    const db = database(), d = await device(db, A); await loggedIn(d.page, A);
    const all = d.page.locator('[data-setting="row.fore_aft"]'); assert.ok(await all.count() >= 2, 'A and C must expose the same machine setting');
    await inputSetting(d.page, 'row.fore_aft', '9');
    for (const input of await all.all()) assert.equal(await input.inputValue(), '9');
    for (const value of await d.page.locator('[data-setting-value="row.fore_aft"]').all()) assert.equal((await value.textContent()).trim(), '9');
    await sync(d.page); const second = await device(db, A); await loggedIn(second.page, A);
    for (const input of await second.page.locator('[data-setting="row.fore_aft"]').all()) assert.equal(await input.inputValue(), '9');
    await second.close(); await d.close();
  });
  await scenario('same-origin tabs refresh calendar, history, check-ins and settings without resetting a running timer', async () => {
    const db = database(), d = await device(db, A); await loggedIn(d.page, A);
    const second = await d.context.newPage(); let navigations = 0;
    await second.goto(origin); await second.clock.setSystemTime(CLOCK);
    await second.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready')); await loggedIn(second, A);
    second.on('framenavigated', frame => { if (frame === second.mainFrame()) navigations++; });
    await second.locator('#play').click(); assert.match(await second.locator('#play').textContent(), /暂停/);
    await inputSetting(d.page, 'row.fore_aft', '9');
    await second.waitForFunction(() => document.querySelector('[data-setting="row.fore_aft"]').value === '9');
    await d.page.locator('#mon-row input.load').fill('17.5'); await d.page.locator('#mon-row input.load').blur();
    await second.waitForFunction(() => document.querySelector('#historyRows').textContent.includes('17.5'));
    await completed(d.page, '2020-01-06', 'a');
    await second.waitForFunction(() => /2020-01-06.*A/.test(document.querySelector('#cycleLog').textContent));
    await d.page.locator('#mon-row .done').check(); await second.waitForFunction(() => document.querySelector('#mon-row .done').checked);
    await completed(second, '2020-01-08', 'b');
    await d.page.waitForFunction(() => /2020-01-08.*B/.test(document.querySelector('#cycleLog').textContent));
    await second.locator('#mon-row input.load').fill('20'); await second.locator('#mon-row input.load').blur();
    await d.page.waitForFunction(() => document.querySelector('#historyRows').children.length === 2);
    assert.match(await d.page.locator('#historyRows').textContent(), /17.5/); assert.match(await d.page.locator('#historyRows').textContent(), /20 kg/);
    assert.match(await second.locator('#play').textContent(), /暂停/); assert.equal(navigations, 0);
    await second.close(); await d.close();
  });
  await scenario('an unchanged cloud sync preserves undo for a deleted calendar record', async () => {
    const db = database(), d = await device(db, A); await loggedIn(d.page, A);
    await completed(d.page, '2020-01-06', 'a');
    await d.page.locator('#cycleEdit').click(); await d.page.locator('#cycleUndo').click();
    assert.equal(await d.page.locator('#cycleRestore').isVisible(), true);
    await sync(d.page); assert.equal(await d.page.locator('#cycleRestore').isVisible(), true);
    await d.page.locator('#cycleRestore').click();
    assert.match(await d.page.locator('#cycleLog').textContent(), /2020-01-06.*A/); await d.close();
  });
  await scenario('paused email hides login while guests retain local history and existing accounts can still sync', async () => {
    const db = database(), d = await device(db, null, { emailLoginPaused: true }); await guest(d.page);
    assert.equal(await d.page.locator('#accountOptions').evaluate(element => element.open), false);
    assert.equal(await d.page.locator('#syncLogin').isVisible(), false); assert.equal(await d.page.locator('#guestContinue').isVisible(), true);
    await d.page.locator('#guestContinue').click();
    await d.page.locator('#mon-row input.load').fill('11.25'); await d.page.locator('#mon-row input.load').blur();
    await accountOptions(d.page);
    assert.equal(await d.page.locator('#syncLogin').isVisible(), false); assert.equal(await d.page.locator('#syncSend').isDisabled(), true);
    assert.match(await d.page.locator('#accountOptionsLabel').textContent(), /邮箱登录暂缓/);
    assert.equal(await d.page.locator('#historyRows tr').count(), 1); assert.equal(db.calls.length, 0);
    assert.equal(await d.page.evaluate(() => window.__fitnessAccountsAuth.requests.email.length), 0);
    await d.page.reload(); await guest(d.page);
    await d.page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready'));
    assert.equal(await d.page.locator('#mon-row input.load').inputValue(), '11.25');
    assert.equal(await d.page.locator('#historyRows tr').count(), 1); assert.equal(await d.page.locator('#syncLogin').isVisible(), false);
    assert.equal(await d.page.evaluate(() => window.__fitnessAccountsAuth.requests.email.length), 0); await d.close();
    const existing = await device(db, A, { emailLoginPaused: true }); await loggedIn(existing.page, A);
    await existing.page.locator('#mon-row input.load').fill('25'); await sync(existing.page);
    assert.equal(db.weights.filter(row => row.user_id === A).length, 1);
    assert.equal(await existing.page.locator('#syncLogin').isVisible(), false);
    assert.equal(await existing.page.evaluate(() => window.__fitnessAccountsAuth.requests.email.length), 0); await existing.close();
  });
  console.log(engine + ': 9 account browser scenarios passed (synthetic fixtures, mocked SDK Auth and database).');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const context of contexts) await context.close(); if (browser) await browser.close(); if (server) server.close();
});



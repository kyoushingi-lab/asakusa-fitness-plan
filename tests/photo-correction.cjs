// Synthetic 2020 records and example.invalid accounts only. No real Auth, email,
// Google or Supabase requests: the browser can reach only this local test server.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; playwright = require('C:/Users/YE XINXI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const engine = process.argv[2] || 'webkit', root = path.resolve(__dirname, '..');
const A = '81111111-1111-4111-8111-111111111111', B = '82222222-2222-4222-8222-222222222222';
const HISTORY = 'gym-compatible.history.v1', ROTATION = 'gym-compatible.rotation.v1', PENDING = 'gym-compatible.pending.v1';
const SETTING = 'gym-compatible.setting.', LOAD = 'gym-compatible.load.', DONE = 'gym-compatible.done.2020-01-10.mon-chest';
const correctedKeys = new Set(['chest.seat', 'chest.adjustment', 'triceps.seat', 'triceps.adjustment']);
const clock = new Date('2020-01-10T12:00:00+09:00');
const prefix = scope => 'gym-account.v2|' + scope + '|';
const history = JSON.stringify([{ id: 'synthetic-row-2020', exercise: 'row', kg: 15, date: '2020-01-06', time: '10:00', at: '2020-01-06T01:00:00.000Z' }]);
const rotation = JSON.stringify({ version: 1, next: 'b', sessions: [{ date: '2020-01-06', plan: 'a', at: '2020-01-06T01:00:00.000Z', completed: ['row'], skipped: {} }], busy: ['2020-01-07'] });
function legacy(adjustment = 'D', withChestWeight = true) {
  return { [SETTING + 'chest.seat']: '2', [SETTING + 'triceps.seat']: '7', [SETTING + 'triceps.adjustment']: adjustment,
    [SETTING + 'row.fore_aft']: '10', [HISTORY]: history, [ROTATION]: rotation, [DONE]: 'yes', [LOAD + 'row']: '15',
    ...(withChestWeight ? { [LOAD + 'chest']: '7.5' } : {}) };
}
function inactive(scope, seat, adjustment = 'E') {
  const p = prefix(scope);
  return { ['gym-account.migrated.v2|' + scope]: '1', [p + SETTING + 'chest.seat']: seat,
    [p + SETTING + 'triceps.seat']: '4', [p + SETTING + 'triceps.adjustment']: adjustment,
    [p + HISTORY]: history, [p + ROTATION]: rotation, [p + DONE]: 'no', [p + LOAD + 'chest']: '' };
}
function mockSDK(userId) {
  window.__photoCorrectionRequests = [];
  window.supabase = { createClient() {
    const user = userId ? { id: userId, email: 'photo-fixture@example.invalid' } : null;
    return {
      auth: {
        async getSession() { return { data: { session: user ? { user } : null }, error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        async signInWithOtp() { throw Error('Email must remain paused'); }
      },
      from(table) {
        const query = { select() { return query; }, eq() { return query; }, order() { return query; },
          async range() { window.__photoCorrectionRequests.push(table + ':select'); return { data: [], error: null }; },
          async upsert() { window.__photoCorrectionRequests.push(table + ':upsert'); return { error: null }; } };
        return query;
      },
      async rpc(name, payload) {
        window.__photoCorrectionRequests.push(name);
        if (payload.p_expected_user !== userId) throw Error('Wrong synthetic owner');
        return { data: payload.p_rows.map(row => ({ ...row, user_id: userId })), error: null };
      }
    };
  } };
}
let browser, server, origin;
const contexts = new Set();
async function device({ seed = {}, userId = null, javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Asia/Tokyo', javaScriptEnabled });
  contexts.add(context);
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.fallback() : route.abort('blockedbyclient'));
  await context.route('**/cloud-config.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.GYM_CLOUD={url:"https://photo-test.example.invalid",key:"synthetic-public-key",emailLoginPaused:true};' }));
  await context.route('**/vendor/supabase.js*', route => route.fulfill({ contentType: 'application/javascript', body: '(' + mockSDK.toString() + ')(' + JSON.stringify(userId) + ');' }));
  await context.addInitScript(seed => {
    if (localStorage.getItem('__photo_test_seeded')) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    localStorage.setItem('__photo_test_seeded', 'yes');
  }, seed);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  if (javaScriptEnabled) await page.clock.install({ time: clock });
  await page.goto(origin);
  if (javaScriptEnabled) {
    await page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready'));
    if (userId) await page.waitForFunction(() => document.querySelector('#syncStatus').textContent.startsWith('已同步'));
  }
  return { page, async close() { assert.deepEqual(errors, [], 'uncaught browser exceptions'); contexts.delete(context); await context.close(); } };
}
async function snapshot(page, scope, otherScopes = []) {
  return page.evaluate(({ scope, otherScopes, protectedLogical }) => {
    const base = 'gym-account.v2|' + scope + '|';
    const keys = Array.from({ length: localStorage.length }, (_, n) => localStorage.key(n)).sort();
    const ownSettingKeys = new Set(['chest.seat', 'chest.adjustment', 'triceps.seat', 'triceps.adjustment']);
    const protectedValues = Object.fromEntries(protectedLogical.map(key => [key, localStorage.getItem(base + key)]));
    const globalLegacy = Object.fromEntries(keys.filter(key => key.startsWith('gym-compatible.')).map(key => [key, localStorage.getItem(key)]));
    const others = Object.fromEntries(keys.filter(key => otherScopes.some(other => key.startsWith('gym-account.v2|' + other + '|') || key === 'gym-account.migrated.v2|' + other)).map(key => [key, localStorage.getItem(key)]));
    const state = JSON.parse(localStorage.getItem(base + '__state') || '[]').filter(row => row.kind !== 'setting' || !ownSettingKeys.has(row.key)).sort((a, b) => (a.kind + a.key).localeCompare(b.kind + b.key));
    const unrelatedSettings = Object.fromEntries(keys.filter(key => key.startsWith(base + 'gym-compatible.setting.') && !ownSettingKeys.has(key.slice((base + 'gym-compatible.setting.').length))).map(key => [key, localStorage.getItem(key)]));
    return { protectedValues, globalLegacy, others, protectedState: JSON.stringify(state), unrelatedSettings };
  }, { scope, otherScopes, protectedLogical: [HISTORY, PENDING, ROTATION, DONE, LOAD + 'chest', LOAD + 'row', LOAD + 'triceps'] });
}
async function settings(page, scope) {
  return page.evaluate(({ base, setting }) => Object.fromEntries(['chest.seat', 'chest.adjustment', 'triceps.seat', 'triceps.adjustment'].map(key => [key, localStorage.getItem(base + setting + key)])), { base: prefix(scope), setting: SETTING });
}
async function apply(page) {
  assert.equal(await page.locator('#equipmentCorrection').evaluate(element => element.open), false, 'photo correction starts folded');
  await page.locator('#equipmentCorrection > summary').click();
  await page.locator('#applySettingCorrection').click();
}
async function assertCorrected(page, scope, oldAdjustment = '') {
  assert.deepEqual(await settings(page, scope), { 'chest.seat': '7', 'chest.adjustment': 'D', 'triceps.seat': '2', 'triceps.adjustment': oldAdjustment });
  assert.deepEqual(await page.locator('[data-setting-value="chest.seat"]').allTextContents(), ['7', '7']);
  assert.deepEqual(await page.locator('[data-setting-value="chest.adjustment"]').allTextContents(), ['D', 'D']);
  assert.deepEqual(await page.locator('[data-setting="chest.seat"]').evaluateAll(elements => elements.map(element => element.value)), ['7', '7']);
  assert.deepEqual(await page.locator('[data-setting="chest.adjustment"]').evaluateAll(elements => elements.map(element => element.value)), ['D', 'D']);
  assert.deepEqual(await page.locator('[data-setting-value="triceps.seat"]').allTextContents(), ['2']);
  assert.equal(await page.locator('[data-setting$=".undefined"],[data-setting-value$=".undefined"]').count(), 0);
  assert.equal(await page.evaluate(() => Array.from({ length: localStorage.length }, (_, n) => localStorage.key(n)).some(key => key.includes('.undefined'))), false);
}
async function scenario(name, body) { await body(); console.log('PASS ' + name); }
(async () => {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream'); response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright[engine].launch();
  await scenario('original legacy guest settings correct automatically; history, dates, check-ins, other scopes and A/C values are preserved', async () => {
    const scope = 'guest', other = 'user:' + B, fixture = legacy(), d = await device({ seed: { ...fixture, ...inactive(other, '9') } });
    const initial = await settings(d.page, scope);
    assert.equal(initial['chest.seat'], '7'); assert.equal(initial['triceps.seat'], '2'); assert.equal(initial['triceps.adjustment'], '');
    const before = await snapshot(d.page, scope, [other]);
    assert.equal(before.protectedValues[HISTORY], history); assert.equal(before.protectedValues[ROTATION], rotation); assert.equal(before.protectedValues[DONE], 'yes');
    await assertCorrected(d.page, scope);
    assert.deepEqual(await snapshot(d.page, scope, [other]), before, 'only the four correction settings may change');
    assert.equal(await d.page.locator('#mon-chest input.load').inputValue(), '7.5'); assert.equal(await d.page.locator('#mon-triceps input.load').inputValue(), '');
    assert.equal(await d.page.locator('#mon-chest .done').isChecked(), true);
    await d.page.reload(); await d.page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready'));
    await assertCorrected(d.page, scope); assert.deepEqual(await snapshot(d.page, scope, [other]), before); await d.close();
  });
  await scenario('original signed-in legacy owner corrects automatically and leaves guest and other account values unchanged', async () => {
    const scope = 'user:' + A, other = 'user:' + B;
    const d = await device({ userId: A, seed: { ...legacy(), 'gym-compatible.sync-owner.v1': A, ...inactive('guest', '3'), ...inactive(other, '9') } });
    const before = await snapshot(d.page, scope, ['guest', other]);
    await assertCorrected(d.page, scope);
    assert.deepEqual(await snapshot(d.page, scope, ['guest', other]), before); await d.close();
  });
  await scenario('a custom triceps adjustment E and unknown chest/triceps weights are retained', async () => {
    const d = await device({ seed: legacy('E', false) }), before = await snapshot(d.page, 'guest');
    assert.equal(before.protectedValues[LOAD + 'chest'], null); assert.equal(before.protectedValues[LOAD + 'triceps'], null);
    await apply(d.page); await assertCorrected(d.page, 'guest', 'E');
    assert.deepEqual(await snapshot(d.page, 'guest'), before);
    assert.equal(await d.page.locator('#mon-chest input.load').inputValue(), ''); assert.equal(await d.page.locator('#mon-triceps input.load').inputValue(), ''); await d.close();
  });
  await scenario('a fresh guest has no automatic settings and only gets the requested correction after clicking', async () => {
    const d = await device(), before = await snapshot(d.page, 'guest');
    for (const input of await d.page.locator('[data-setting]').all()) assert.equal(await input.inputValue(), '');
    assert.deepEqual(await settings(d.page, 'guest'), { 'chest.seat': null, 'chest.adjustment': null, 'triceps.seat': null, 'triceps.adjustment': null });
    await apply(d.page);
    assert.deepEqual(await settings(d.page, 'guest'), { 'chest.seat': '7', 'chest.adjustment': 'D', 'triceps.seat': '2', 'triceps.adjustment': null });
    assert.deepEqual(await snapshot(d.page, 'guest'), before);
    assert.equal(await d.page.evaluate(() => Array.from({ length: localStorage.length }, (_, n) => localStorage.key(n)).some(key => key.includes('.undefined'))), false); await d.close();
  });
  await scenario('independent scopes matching old seat numbers are not auto-corrected without legacy provenance', async () => {
    const p = prefix('guest');
    const seed = { ...inactive('guest', '2', 'D'), [p + SETTING + 'triceps.seat']: '7' };
    const d = await device({ seed });
    assert.equal((await settings(d.page, 'guest'))['chest.seat'], '2');
    assert.equal((await settings(d.page, 'guest'))['triceps.seat'], '7');
    await d.close();
  });
  await scenario('automatic correction runs once and later personal edits survive reload', async () => {
    const d = await device({ seed: legacy() });
    await assertCorrected(d.page, 'guest');
    await d.page.locator('#mon-chest .setting-editor > summary').click();
    await d.page.locator('#mon-triceps .setting-editor > summary').click();
    await d.page.locator('#mon-chest [data-setting="chest.seat"]').fill('2');
    await d.page.locator('#mon-triceps [data-setting="triceps.seat"]').fill('7');
    await d.page.reload(); await d.page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready'));
    assert.equal((await settings(d.page, 'guest'))['chest.seat'], '2');
    assert.equal((await settings(d.page, 'guest'))['triceps.seat'], '7');
    await d.close();
  });
  await scenario('without JavaScript the correction explanation and corrected photos expand natively', async () => {
    const d = await device({ javaScriptEnabled: false });
    for (const id of ['mon-pulldown', 'fri-pulldown']) {
      assert.equal(await d.page.locator('#' + id + ' .fixed-settings').count(), 0, 'pulldown needs no adjustment record');
      assert.equal(await d.page.locator('#' + id + ' [data-last-weight="pulldown"]').count(), 1, 'weight/date record remains available');
    }
    await d.page.locator('#equipmentCorrection > summary').click();
    assert.match(await d.page.locator('#equipmentCorrection').textContent(), /胸推机：座位7、调节D；三头肌机：座位2/);
    assert.equal(await d.page.locator('#applySettingCorrection').isDisabled(), true);
    for (const id of ['mon-chest', 'fri-chest']) {
      const card = d.page.locator('#' + id);
      assert.deepEqual(await card.locator('.fixed-settings dd').allTextContents(), ['7', 'D']);
      assert.deepEqual(await card.locator('.setting-photos img').evaluateAll(images => images.map(image => image.getAttribute('src'))), ['assets/settings/chest-press-seat-7.jpg', 'assets/settings/chest-press-adjustment-d.jpg']);
      await card.locator('.setting-photos > summary').click();
      await d.page.waitForFunction(selector => Array.from(document.querySelectorAll(selector)).every(image => image.complete && image.naturalWidth > 0), '#' + id + ' .setting-photos img');
    }
    assert.deepEqual(await d.page.locator('#mon-triceps .fixed-settings dd').allTextContents(), ['2']);
    assert.equal(await d.page.locator('#mon-triceps .setting-photos img').getAttribute('src'), 'assets/settings/triceps-seat-2.jpg');
    await d.page.locator('#mon-triceps .setting-photos > summary').click();
    await d.page.waitForFunction(() => { const image = document.querySelector('#mon-triceps .setting-photos img'); return image.complete && image.naturalWidth > 0; });
    await d.close();
  });
  console.log(engine + ': 7 photo correction scenarios passed (synthetic local data; Auth and cloud fully mocked).');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const context of contexts) await context.close(); if (browser) await browser.close(); if (server) server.close();
});

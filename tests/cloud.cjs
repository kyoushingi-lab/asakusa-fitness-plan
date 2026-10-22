// Synthetic 2020 workout fixtures and example.test accounts only. The real,
// vendored Supabase SDK runs against intercepted Auth/REST requests; no mail is sent.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; playwright = require('C:/Users/YE XINXI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const engine = process.argv[2] || 'webkit', root = path.resolve(__dirname, '..');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const AUTH_KEY = 'sb-fitness-test-auth-token', API = 'https://fitness-test.supabase.co';
const copy = value => JSON.parse(JSON.stringify(value));
const email = id => id === B ? 'friend@example.test' : 'fitness@example.test';
function session(id = A) {
  const exp = 4102444800;
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: id, exp, role: 'authenticated' })).toString('base64url') + '.test';
  return { access_token: token, refresh_token: 'test-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user: { id, email: email(id), aud: 'authenticated', role: 'authenticated' } };
}
let browser, server, origin, fail = false;
const records = [], states = [], requests = [], contexts = new Set();
const newer = (one, two) => one.revision - two.revision || (one.device_id > two.device_id ? 1 : one.device_id < two.device_id ? -1 : 0);
function owner(request) {
  const token = (request.headers().authorization || '').replace(/^Bearer /, '');
  if (token.split('.').length !== 3) return null;
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub || null; } catch { return null; }
}
function privateWeights(id = A) { return records.filter(row => row.user_id === id); }
async function device(id = A) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Asia/Tokyo' });
  contexts.add(context);
  await context.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(origin + '/') || url.startsWith(API + '/') ? route.fallback() : route.abort('blockedbyclient');
  });
  if (id) await context.addInitScript(({ key, initial }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
  }, { key: AUTH_KEY, initial: session(id) });
  await context.route('**/cloud-config.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.GYM_CLOUD=' + JSON.stringify({ url: API, key: 'test-public-key' }) + ';' }));
  await context.route(API + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), uid = owner(request);
    requests.push({ uid, method: request.method(), path: url.pathname });
    if (url.pathname.startsWith('/rest/v1/')) {
      assert.ok(uid === A || uid === B, 'REST data requires a synthetic authenticated account');
      if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary synthetic outage' }) });
      if (url.pathname === '/rest/v1/rpc/merge_fitness_state' || url.pathname === '/rest/v1/rpc/import_fitness_state') {
        const payload = request.postDataJSON(), input = payload.p_rows, result = []; assert.ok(input.length <= 100);
        assert.equal(payload.p_expected_user, uid, 'RPC expected owner must match the bearer token');
        for (const incoming of input) {
          assert.equal(incoming.user_id, undefined, 'state owner is bound by the RPC');
          let current = states.find(row => row.user_id === uid && row.kind === incoming.kind && row.key === incoming.key);
          if (!current) { current = { ...copy(incoming), user_id: uid }; states.push(current); }
          else if (url.pathname.endsWith('/merge_fitness_state') && newer(incoming, current) > 0) Object.assign(current, copy(incoming));
          result.push(copy(current));
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
      }
      if (request.method() === 'GET') {
        assert.equal(url.searchParams.get('user_id'), 'eq.' + uid, 'every query must filter its JWT owner');
        const from = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
        const source = url.pathname.endsWith('/weight_entries') ? records : states;
        const fields = url.pathname.endsWith('/weight_entries') ? ['at', 'id'] : ['kind', 'key'];
        const rows = source.filter(row => row.user_id === uid).sort((one, two) => {
          for (const field of fields) { const order = String(one[field]).localeCompare(String(two[field])); if (order) return order; } return 0;
        });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows.slice(from, from + limit)) });
      }
      if (request.method() === 'POST' && url.pathname.endsWith('/weight_entries')) {
        const batch = request.postDataJSON(); assert.ok(batch.length <= 100); assert.match(request.headers().prefer, /ignore-duplicates/);
        for (const entry of batch) {
          assert.equal(entry.user_id, uid);
          if (!records.some(row => row.user_id === uid && row.id === entry.id)) records.push(copy(entry));
        }
        return route.fulfill({ status: 201, body: '' });
      }
      throw Error('Unexpected synthetic REST operation: ' + request.method() + ' ' + url.pathname);
    }
    if (url.pathname === '/auth/v1/otp') return route.fulfill({ contentType: 'application/json', body: '{}' });
    if (url.pathname.endsWith('/user')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(session(uid || id || A).user) });
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    throw Error('Unexpected Auth network call (all real mail/user creation is forbidden): ' + url.pathname);
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  await page.clock.install({ time: new Date('2020-01-10T12:00:00+09:00') }); await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#runtimeStatus').classList.contains('runtime-ready'));
  return { c: context, p: page, async close() { assert.deepEqual(errors, [], 'uncaught page errors'); contexts.delete(context); await context.close(); } };
}
async function synced(page, count) {
  await page.waitForFunction(expected => {
    const status = document.querySelector('#syncStatus').textContent;
    return status.startsWith('已同步') && (expected === null || status.includes(expected + ' 条'));
  }, count === undefined ? null : count);
}
async function sync(page, count) { await page.locator('#syncNow').click(); await synced(page, count); }
async function expose(locator) { await locator.evaluate(element => { let parent = element.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } }); }
(async () => {
  fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream'); response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright[engine].launch();
  const guest = await device(null);
  await guest.p.waitForFunction(() => /游客/.test(document.querySelector('#syncStatus').textContent));
  await guest.p.locator('#syncEmail').fill('fitness@example.test');
  const requestEvent = guest.p.waitForRequest(request => request.url().includes('/auth/v1/otp'));
  await guest.p.locator('#syncSend').click(); const loginRequest = await requestEvent;
  assert.equal(loginRequest.postDataJSON().email, 'fitness@example.test');
  assert.equal(new URL(loginRequest.url()).searchParams.get('redirect_to'), origin + '/');
  await guest.p.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('登录链接已发送'));
  assert.equal(requests.filter(request => request.path.startsWith('/rest/v1/')).length, 0);
  await guest.close(); console.log('PASS real SDK login request uses the correct return URL; mail endpoint is intercepted');

  const a = await device(); await synced(a.p, 0);
  await a.p.locator('#mon-row input.load').fill('17.5'); await sync(a.p, 1);
  assert.equal(privateWeights().length, 1); assert.equal(privateWeights()[0].date, '2020-01-10');
  const b = await device(); await synced(b.p, 1);
  assert.equal(await b.p.locator('#historyRows tr').count(), 1); assert.equal(await b.p.locator('#fri-row input.load').inputValue(), '17.5');
  console.log('PASS same-account second device downloads dated history and latest load');

  await b.c.setOffline(true); await b.p.locator('#mon-row input.load').fill('20'); await b.p.locator('#syncNow').click();
  assert.match(await b.p.locator('#syncStatus').textContent(), /离线/); assert.equal(privateWeights().length, 1);
  await b.c.setOffline(false); await synced(b.p, 2); await sync(a.p, 2);
  assert.equal(await a.p.locator('#historyRows tr').count(), 2); assert.equal(await a.p.locator('#mon-row input.load').inputValue(), '20');
  console.log('PASS offline save retries on reconnection and reaches the other device');

  await a.p.locator('#mon-row input.load').fill(''); await sync(a.p, 2); await sync(b.p, 2);
  assert.equal(await a.p.locator('#mon-row input.load').inputValue(), ''); assert.equal(await b.p.locator('#mon-row input.load').inputValue(), '');
  assert.equal(privateWeights().length, 2); console.log('PASS repeated sync neither duplicates records nor restores intentionally cleared weight');

  fail = true; await a.p.locator('#mon-chest input.load').fill('15'); await a.p.locator('#syncNow').click();
  await a.p.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('本机记录已保留'));
  assert.equal(await a.p.locator('#historyRows tr').count(), 3);
  fail = false; await sync(a.p, 3); assert.equal(privateWeights().length, 3);
  console.log('PASS server error preserves local history and retries without data loss');

  const dateOnly = { app: 'asakusa-personal-profile', version: 1, entries: [{ id: 'date-only:2020-01-04:glute:33.75', exercise: 'glute', kg: 33.75, date: '2020-01-04', time: '00:00', at: '2020-01-03T15:00:00.000Z' }], sessions: [{ date: '2020-01-04', plan: 'b', completed: ['glute'], skipped: {} }] };
  await expose(b.p.locator('#importWorkout'));
  await b.p.locator('#importWorkout').setInputFiles({ name: 'synthetic-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dateOnly)) });
  await b.p.locator('#applyWorkoutImport').click(); await synced(b.p, 4); assert.equal(privateWeights().length, 4);
  const c = await device(); await synced(c.p, 4);
  assert.equal(await c.p.locator('#historyRows tr').count(), 4);
  assert.match(await c.p.locator('#historyRows').textContent(), /2020-01-04 时间未记录/);
  assert.equal(await c.p.locator('#wed-glute [data-last-weight]').textContent(), '33.75 kg'); await c.close();
  console.log('PASS imported date-only history syncs automatically and retains unknown time on another device');

  const originalA = copy(privateWeights());
  await a.p.evaluate(({ key, next }) => localStorage.setItem(key, JSON.stringify(next)), { key: AUTH_KEY, next: session(B) }); await a.p.reload(); await synced(a.p, 0);
  assert.equal(await a.p.locator('#historyRows tr').count(), 0);
  for (const input of await a.p.locator('input.load').all()) assert.equal(await input.inputValue(), '');
  await a.p.locator('#mon-chest input.load').fill('22.5'); await sync(a.p, 1);
  assert.equal(privateWeights(B).length, 1); assert.deepEqual(privateWeights(A), originalA);
  await a.p.evaluate(({ key, next }) => localStorage.setItem(key, JSON.stringify(next)), { key: AUTH_KEY, next: session(A) }); await a.p.reload(); await synced(a.p, 4);
  assert.equal(await a.p.locator('#historyRows tr').count(), 4); assert.equal(await a.p.locator('#mon-chest input.load').inputValue(), '15');
  assert.ok(requests.some(request => request.uid === B && request.path.startsWith('/rest/v1/')));
  console.log('PASS switching accounts starts with private blank data, safely uploads only its own weights, and preserves the original account');

  await expose(b.p.locator('#syncNow')); await b.p.locator('#sync').scrollIntoViewIfNeeded();
  await b.p.screenshot({ path: path.join(__dirname, '../test-results/sync-' + engine + '.png') });
  await a.close(); await b.close(); console.log(engine + ': 7 cloud integration scenarios passed (simulated server, real vendored SDK).');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const context of contexts) await context.close(); if (browser) await browser.close(); if (server) server.close();
});

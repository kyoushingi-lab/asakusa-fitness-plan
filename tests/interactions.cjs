// Integration checks exercise the shipped HTML in a real browser.
const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(require('node:path').join(__dirname,'../test-results'),{recursive:true});
const http = require('node:http');
const assert = require('node:assert/strict');
const { webkit, chromium } = require('playwright');
const file = path.resolve(process.argv[2] || path.join(__dirname,'../index.html'));
const engine = process.argv[3] || 'webkit';
const results = [];
let browser, server, origin;
async function test(name, body, options = {}) {
  if (process.argv[4] && !name.includes(process.argv[4])) return;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Asia/Tokyo', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  try { await body(page, context); results.push({ name, pass: true }); console.log('PASS', name); }
  catch(e) { results.push({ name, pass: false, error: e.message }); console.log('FAIL', name, e.message.split('\n')[0]); }
  finally { await context.close(); }
}
async function open(page) { await page.goto(origin); }
async function frozen(page, iso = '2026-10-19T03:00:00+09:00') { await page.clock.install({ time: new Date(iso) }); await open(page); }
async function text(page, id) { return page.locator(id).innerText(); }
async function main() {
  server = http.createServer((req,res) => {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=pathname==='/'?file:path.resolve(path.dirname(file),'.'+pathname);
    if(target!==file&&!target.startsWith(path.dirname(file)+path.sep)){res.writeHead(403);res.end();return;}
    if(!fs.existsSync(target)){res.writeHead(404);res.end();return;}
    const mime={'.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.html':'text/html'};
    res.setHeader('Content-Type',(mime[path.extname(target)]||'application/octet-stream')+'; charset=utf-8');res.end(fs.readFileSync(target));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch());
  await test('all 15 cards show real embedded photos and native photo enlargement works', async p => {
    await open(p); assert.equal(await p.locator('.machine-picture img').count(),15);
    const images = await p.locator('.machine-picture img').evaluateAll(imgs => imgs.map(i=>({src:i.src,loaded:i.complete&&i.naturalWidth>=600,alt:i.alt})));
    assert.ok(images.every(i=>i.loaded && (i.src.startsWith('data:image/')||i.src.startsWith(origin+'/assets/')) && i.alt.length>5));
    assert.equal(new Set(images.map(i=>i.src)).size,9);
    for (const card of await p.locator('details.machine').all()) {
      const viewer=card.locator('.photo-viewer');assert.equal(await viewer.evaluate(e=>e.open),false);
      await viewer.locator('summary').tap();assert.equal(await viewer.locator('img').isVisible(),true);
      assert.ok(await viewer.locator('img').evaluate(i=>i.complete&&i.naturalWidth>=600));
      await viewer.locator('summary').tap();assert.equal(await viewer.locator('img').isVisible(),false);
    }
  });
  await test('the ten remaining workout cards open their correct manufacturer videos', async (p,c) => {
    await c.route('https://**/*', r=>r.fulfill({contentType:'text/html',body:'<title>Video target verified</title>'}));
    await open(p);assert.equal(await p.locator('details.machine a.video-link').count(),15);
    const cases=[['mon-pulldown','NAIEnMjN-6w'],['fri-pulldown','NAIEnMjN-6w'],['mon-abs','yUHmHlVdVqM'],['wed-abs','yUHmHlVdVqM'],['wed-legpress','yyla8aCTMWo'],['fri-legpress','yyla8aCTMWo'],['wed-glute','7nazTC6EshM'],['fri-glute','7nazTC6EshM'],['wed-legcurl','SiwJ_T62l9c'],['wed-abductor','H98IP8rARy4']];
    for(const [id,videoId] of cases){const [tab]=await Promise.all([p.waitForEvent('popup'),p.locator('#'+id+' a.video-link').tap()]);await tab.waitForLoadState('domcontentloaded');assert.equal(tab.url(),'https://www.youtube.com/watch?v='+videoId);await tab.close();}
  });
  await test('photos and native enlargement remain available in script-disabled offline files', async p => {
    await p.goto(require('node:url').pathToFileURL(file).href);
    assert.equal(await p.locator('.machine-picture img').count(),15);
    await p.locator('#wed-glute .photo-viewer summary').tap();
    assert.equal(await p.locator('#wed-glute .photo-viewer img').isVisible(),true);
    assert.ok(await p.locator('#wed-glute .photo-viewer img').evaluate(i=>i.complete&&i.naturalWidth>=600));
  },{javaScriptEnabled:false});
  await test('confirmed equipment settings appear on every matching training day without inventing row weight', async p => {
    await open(p);
    for (const id of ['mon-chest','fri-chest']) assert.match(await text(p, '#'+id+' .personal-setup'), /座位 2[\s\S]*7\.5 kg/);
    for (const id of ['mon-row','fri-row']) {
      const settings = await text(p, '#'+id+' .personal-setup');
      assert.match(settings, /前后调节 10[\s\S]*高度第 9 格/);
      assert.match(settings, /重量未记录/);
      assert.equal(await p.locator('#'+id+' input.load').inputValue(),'');
    }
    assert.match(await text(p,'#mon-triceps .personal-setup'), /座位 7[\s\S]*调节 D/);
    assert.equal(await p.locator('#mon-triceps input.load').inputValue(),'');
  });
  await test('confirmed chest load is an editable default and never overwrites saved or intentionally cleared weights', async p => {
    await open(p); assert.equal(await p.locator('#mon-chest input.load').inputValue(),'7.5');
    await p.locator('#mon-chest input.load').fill('15'); await p.reload();
    assert.equal(await p.locator('#fri-chest input.load').inputValue(),'15');
    await p.locator('#fri-chest input.load').fill(''); await p.reload();
    assert.equal(await p.locator('#mon-chest input.load').inputValue(),'');
  });
  await test('all five video buttons open the correct external video and retain the running workout page', async (p,c) => {
    await c.route('https://**/*', r => r.fulfill({contentType:'text/html',body:'<title>External video navigation test</title>'}));
    await frozen(p); await p.locator('#play').tap();
    const cases = [['mon-chest','https://www.youtube.com/watch?v=lmINcLKC4Z8'],['fri-chest','https://www.youtube.com/watch?v=lmINcLKC4Z8'],['mon-row','https://www.youtube.com/watch?v=4A1xAwd7jWs'],['fri-row','https://www.youtube.com/watch?v=4A1xAwd7jWs'],['mon-triceps','https://player.vimeo.com/video/708844777?app_id=58479&autopause=0&badge=0&h=958ad4edde&player_id=0']];
    for (const [id,url] of cases) {
      const [video] = await Promise.all([p.waitForEvent('popup'),p.locator('#'+id+' a.video-link').tap()]);
      await video.waitForLoadState('domcontentloaded'); assert.equal(video.url(),url); await video.close();
    }
    assert.equal(p.url(),origin+'/'); assert.match(await text(p,'#play'),/暂停/);
    const before = await text(p,'#clock');
    await p.clock.fastForward(2000);
    assert.ok((await text(p,'#clock')) < before, 'timer continues advancing after video tabs close');
  });
  await test('all 15 machine cards toggle by touch, including illustration and title', async p => {
    await open(p); assert.equal(await p.locator('details.machine').count(), 15);
    for (const card of await p.locator('details.machine').all()) {
      const before = await card.evaluate(e => e.open);
      await card.locator('.machine-picture').tap(); assert.equal(await card.evaluate(e => e.open), !before);
      await card.locator('strong').first().tap(); assert.equal(await card.evaluate(e => e.open), before);
    }
  });
  await test('day navigation and diet links reach real sections', async p => {
    await open(p); for (const target of ['wed','fri','mon','diet','cardio','tips']) {
      await Promise.all([p.waitForURL(url=>url.hash==='#'+target),p.locator(`a[href="#${target}"]`).first().tap()]);
      assert.equal(new URL(p.url()).hash, '#'+target);
    }
  });
  await test('weights persist before blur and synchronize repeated machines', async p => {
    await open(p); await p.locator('input.load[data-key="pulldown"]').first().fill('17.5');
    assert.equal(await p.locator('input.load[data-key="pulldown"]').last().inputValue(), '17.5');
    await p.reload(); assert.equal(await p.locator('input.load[data-key="pulldown"]').first().inputValue(), '17.5');
  });
  await test('weight history saves a settled value with local date, survives reload, and deduplicates repeated cards', async p => {
    await frozen(p);
    await p.locator('#mon-row input.load').fill('17');
    await p.locator('#mon-row input.load').fill('17.5');
    await p.clock.fastForward(1200);
    assert.equal(await p.locator('#historyRows tr').count(),1);
    assert.match(await text(p,'#historyRows'), /2026-10-19[\s\S]*划船[\s\S]*17\.5/);
    await p.locator('#fri-row input.load').fill('17.5');
    await p.clock.fastForward(1200);
    assert.equal(await p.locator('#historyRows tr').count(),1);
    await p.reload();
    assert.equal(await p.locator('#historyRows tr').count(),1);
    await p.locator('#mon-row input.load').fill('20');
    await p.reload();
    assert.equal(await p.locator('#historyRows tr').count(),2);
    assert.match(await text(p,'#historyRows tr:first-child'),/20/);
  });
  await test('same weight on a new local day becomes a separate dated entry and invalid or empty weights do not', async p => {
    await frozen(p,'2026-10-19T23:59:58+09:00');
    await p.locator('#mon-chest input.load').fill('7.5');
    await p.clock.fastForward(1200);
    await p.clock.fastForward(2000);
    await p.locator('#fri-chest input.load').fill('7.5');
    await p.clock.fastForward(1200);
    assert.equal(await p.locator('#historyRows tr').count(),2);
    assert.match(await text(p,'#historyRows tr:first-child'),/2026-10-20/);
    await p.locator('#mon-chest input.load').fill('-1');
    await p.clock.fastForward(1200);
    await p.locator('#mon-chest input.load').fill('');
    await p.clock.fastForward(1200);
    assert.equal(await p.locator('#historyRows tr').count(),2);
  });
  await test('machine micro-weights such as 3.75 and 11.25 kg are valid dated records', async p=>{
    await frozen(p);await p.locator('#mon-chest input.load').fill('11.25');await p.clock.fastForward(1200);
    assert.equal(await p.locator('#mon-chest input.load').evaluate(e=>e.validity.valid),true);
    assert.match(await text(p,'#historyRows'),/11\.25 kg/);
    await p.locator('#mon-row input.load').fill('3.75');await p.clock.fastForward(1200);
    assert.equal(await p.locator('#historyRows tr').count(),2);
    await p.reload();assert.equal(await p.locator('#mon-chest input.load').inputValue(),'11.25');
  });
  await test('history JSON export restores dates and weights in another browser without duplicating imports', async (p,c) => {
    await frozen(p);await p.locator('#mon-row input.load').fill('22.5');
    const downloadEvent=p.waitForEvent('download');await p.locator('#exportHistory').click();
    const download=await downloadEvent;const buffer=fs.readFileSync(await download.path());
    const backup=JSON.parse(buffer.toString());assert.equal(backup.entries[0].kg,22.5);assert.equal(backup.entries[0].date,'2026-10-19');
    await p.evaluate(()=>localStorage.clear());await p.reload();
    assert.equal(await p.locator('#historyRows tr').count(),0);
    const payload={name:'backup.json',mimeType:'application/json',buffer};
    await p.locator('#importHistory').setInputFiles(payload);
    await p.waitForFunction(()=>document.querySelector('#historyRows').children.length===1);
    assert.equal(await p.locator('#fri-row input.load').inputValue(),'22.5');
    await p.locator('#importHistory').setInputFiles(payload);
    await p.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('导入 0'));
    assert.equal(await p.locator('#historyRows tr').count(),1);
    const invalid={...backup,entries:[{...backup.entries[0],exercise:'<script>',date:'2026-02-31'}]};
    await p.locator('#importHistory').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await p.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('导入失败'));
    assert.equal(await p.locator('#historyRows tr').count(),1);
    await p.locator('#historyFilter').selectOption('chest');assert.equal(await p.locator('#historyRows tr').count(),0);
    await p.locator('#historyFilter').selectOption('row');assert.equal(await p.locator('#historyRows tr').count(),1);
    const csvEvent=p.waitForEvent('download');await p.locator('#exportCsv').click();const csv=fs.readFileSync(await (await csvEvent).path(),'utf8');
    assert.match(csv,/2026-10-19,03:00,坐姿划船,22.5/);
  });
  await test('unreadable history is preserved without blocking latest weights or the timer', async p => {
    await p.addInitScript(()=>localStorage.setItem('gym-compatible.history.v1','broken history'));
    await open(p);assert.match(await text(p,'#historyStatus'),/保留原数据/);
    await p.locator('#mon-row input.load').fill('15');await p.locator('#play').click();
    assert.match(await text(p,'#play'),/暂停/);
    assert.equal(await p.evaluate(()=>localStorage.getItem('gym-compatible.history.v1')),'broken history');
  });
  await test('local Japanese date is used for check-in, and reload restores it', async p => {
    await frozen(p); await p.locator('input.done').first().check();
    assert.equal(await p.evaluate(() => localStorage.getItem('gym-compatible.done.2026-10-19.mon-pulldown')), 'yes');
    await p.reload(); assert.equal(await p.locator('input.done').first().isChecked(), true);
  });
  await test('an open page switches check-ins after local midnight', async p => {
    await frozen(p, '2026-10-19T23:59:58+09:00'); await p.locator('input.done').first().check();
    await p.clock.fastForward(4000); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await p.locator('input.done').first().isChecked(), false);
    await p.locator('input.done').first().check();
    assert.equal(await p.evaluate(() => localStorage.getItem('gym-compatible.done.2026-10-20.mon-pulldown')), 'yes');
  });
  await test('timer automatically continues at the six-minute boundary', async p => {
    await frozen(p); await p.locator('#play').tap(); await p.clock.fastForward(361000);
    assert.match(await text(p,'#timerLabel'), /第2\/5段/); assert.equal(await text(p,'#clock'),'05:59'); assert.match(await text(p,'#play'), /暂停/);
  });
  await test('timer catches up after backgrounding, completes at 30 minutes and stays complete', async p => {
    await frozen(p); await p.locator('#play').tap(); await p.clock.fastForward(1801000);
    assert.equal(await text(p,'#clock'),'00:00'); assert.match(await text(p,'#timerLabel'), /完成/);
    await p.clock.fastForward(60000); assert.equal(await text(p,'#clock'),'00:00');
  });
  await test('pause freezes time, resume preserves elapsed time, and reset stops', async p => {
    await frozen(p); await p.locator('#play').tap(); await p.clock.fastForward(2500); await p.locator('#play').tap();
    const paused = await text(p,'#clock'); await p.clock.fastForward(5000); assert.equal(await text(p,'#clock'), paused);
    await p.locator('#play').tap(); await p.clock.fastForward(1000); assert.equal(await text(p,'#clock'), '05:57');
    await p.locator('#reset').tap(); await p.clock.fastForward(2000); assert.equal(await text(p,'#clock'), '06:00'); assert.match(await text(p,'#play'), /开始/);
  });
  await test('manual next preserves running state and final next completes', async p => {
    await frozen(p); await p.locator('#play').tap(); await p.locator('#next').tap(); await p.clock.fastForward(1000);
    assert.equal(await text(p,'#clock'),'05:59');
    for(let i=0;i<4;i++) await p.locator('#next').tap();
    assert.equal(await text(p,'#clock'),'00:00'); assert.match(await text(p,'#timerLabel'), /完成/);
  });
  await test('storage read exception cannot break timer initialization', async p => {
    await p.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('Denied','SecurityError'); }; });
    await frozen(p); await p.locator('#play').tap(); await p.clock.fastForward(1000);
    assert.equal(await text(p,'#clock'),'05:59');
  });
  await test('storage write denial keeps controls working and explains temporary records', async p => {
    await p.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Full','QuotaExceededError'); }; });
    await open(p); await p.locator('input.done').first().check(); await p.locator('input.load').first().fill('12.5'); await p.locator('#play').tap();
    assert.match(await text(p,'#storageStatus'), /临时|无法保存/); assert.match(await text(p,'#play'), /暂停/);
  });
  await test('script-disabled preview clearly explains limitations and leaves every instruction readable', async p => {
    await open(p); assert.equal(await p.locator('.machine-details:visible').count(),15);
    assert.match(await p.locator('body').innerText(), /文件预览|只读预览/);
    assert.equal(await p.locator('#play').isDisabled(), true);
  }, { javaScriptEnabled: false });
  await test('no horizontal overflow at small phone and desktop widths', async p => {
    await open(p); for (const width of [320,375,390,430,1024]) {
      await p.setViewportSize({width,height:844}); assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at '+width);
    }
  });
  await test('local HTML file also runs and has no uncaught script errors', async p => {
    const errors=[];p.on('pageerror', e=>errors.push(e.message));
    await p.goto(require('node:url').pathToFileURL(file).href); await p.locator('#play').tap(); assert.match(await text(p,'#play'), /暂停/);assert.deepEqual(errors,[]);
  });
}
main().catch(e => { console.error(e); process.exitCode=1; }).finally(async () => {
  if(browser) await browser.close(); if(server) server.close();
  fs.writeFileSync(path.join(__dirname,`../test-results/interactions-${engine}.json`), JSON.stringify(results,null,2));
  console.log(`${engine}: ${results.filter(r=>r.pass).length}/${results.length} passed`);
  if(results.some(r=>!r.pass)) process.exitCode=1;
});

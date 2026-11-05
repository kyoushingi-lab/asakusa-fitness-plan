// All dates and loads below are synthetic test fixtures, not personal workout history.
// Focused mobile checks for equipment profiles and native, script-free photo browsing.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const site = path.resolve(__dirname, '..');
const engine = process.argv[2] || 'chromium';
const playwright = require('playwright');

async function main() {
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
    const file = path.resolve(site, '.' + pathname);
    if (!file.startsWith(site + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const type = { '.css':'text/css', '.js':'text/javascript', '.jpg':'image/jpeg' }[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);res.end(fs.readFileSync(file));
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(43827, '127.0.0.1', resolve);});
  let browser;
  try {
    browser = engine === 'webkit' ? await playwright.webkit.launch() : await playwright.chromium.launch();
    const context = await browser.newContext({ viewport: { width:390,height:844 }, hasTouch:true, isMobile:true, javaScriptEnabled:false });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    // This context intentionally disables scripts: the public read-only fallback
    // retains its example settings. A fresh interactive guest must start blank,
    // which interactions.cjs verifies after the account initializer is ready.
    assert.equal(await page.locator('.machine-profile').count(), 15, 'every training card shows its separate profile');
    for(const id of ['mon-chest','fri-chest']) {
      const card=page.locator('#'+id);
      assert.match(await card.locator('.fixed-settings').innerText(),/座位\s*7[\s\S]*调节档位\s*D/,'chest settings use the corrected seat 7 and D labels');
      assert.deepEqual(await card.locator('.setting-photos img').evaluateAll(images=>images.map(i=>i.getAttribute('src'))),['assets/settings/chest-press-seat-7.jpg','assets/settings/chest-press-adjustment-d.jpg']);
      assert.match(await card.locator('.setting-photos').textContent(),/2 张[\s\S]*胸推机 · 座位 7[\s\S]*胸推机 · 调节 D/);
      const correctedGallery=card.locator('.setting-photos');
      assert.equal(await correctedGallery.evaluate(el=>el.open),false);
      await correctedGallery.locator('summary').tap();
      await page.waitForFunction(el=>Array.from(el.querySelectorAll('img')).every(i=>i.complete&&i.naturalWidth>=960),await correctedGallery.elementHandle());
      await correctedGallery.locator('summary').tap();
      assert.equal(await card.locator('input.load').getAttribute('data-key'),'chest','chest weight history stays bound to chest');
      assert.equal(await card.locator('input.load').getAttribute('data-default-weight'),'7.5','existing chest default is not reassigned to another exercise');
    }
    const triceps=page.locator('#mon-triceps');
    assert.deepEqual(await triceps.locator('.fixed-settings dd').allTextContents(),['2'],'triceps only retains the corrected seat 2');
    assert.equal(await triceps.locator('.setting-photos img').getAttribute('src'),'assets/settings/triceps-seat-2.jpg');
    assert.match(await triceps.locator('.setting-photos').textContent(),/1 张[\s\S]*三头肌机 · 座位 2/);
    await triceps.locator('.setting-photos summary').tap();
    await page.waitForFunction(el=>el.complete&&el.naturalWidth>=960,await triceps.locator('.setting-photos img').elementHandle());
    await triceps.locator('.setting-photos summary').tap();
    assert.equal(await triceps.locator('input.load').getAttribute('data-key'),'triceps');
    assert.equal(await triceps.locator('input.load').getAttribute('data-default-weight'),null,'chest default must not move to triceps');
    for(const file of ['chest-press-seat-2.jpg','triceps-seat-7.jpg','triceps-adjustment-d.jpg']) {
      assert.equal(await page.locator('.machine [src="assets/settings/'+file+'"],.machine [href="assets/settings/'+file+'"]').count(),0,'outdated mislabeled photos are absent from the page');
    }
    assert.match(await page.locator('#mon-row .fixed-settings').innerText(), /前后调节.*10.*高度.*9/s);
    assert.match(await page.locator('#wed-legpress .fixed-settings').innerText(), /调节档位.*5/s);
    assert.doesNotMatch(await page.locator('#wed-legpress .fixed-settings').innerText(), /kg|公斤|重量/);
    assert.equal(await page.locator('#wed-legpress [data-last-weight="legpress"]').innerText(), '待记录');
    assert.match(await page.locator('#wed-glute .model-status').innerText(), /已确认.*HS-HG/s);
    assert.equal(await page.locator('.photo-viewer,.identify-tip').count(),0,'duplicate enlargement and identification modules are removed from every card');
    for(const id of ['mon-abs','wed-abs']) {
      const card=page.locator('#'+id);
      assert.equal(await card.locator('.equipment-thumb').getAttribute('src'),'assets/abs-insignia.jpg','whole-machine photo is the main thumbnail');
      assert.equal(await card.locator('.equipment-thumb').evaluate(i=>i.complete&&i.naturalWidth===1000),true,'whole-machine photo loads directly on the card');
      assert.match(await card.locator('.model-status').innerText(), /Life Fitness.*SS-AB/s);
      const closeups=card.locator('img[src="assets/settings/abdominal-height-4.jpg"]');
      assert.equal(await closeups.count(),1,'height-4 detail appears once, only in adjustment gallery');
      assert.equal(await card.locator('.setting-photos img[src="assets/settings/abdominal-height-4.jpg"]').count(),1);
      assert.equal(await card.locator('.setting-photos').evaluate(e=>e.open),false);
      await card.locator('.setting-photos > summary').tap();
      assert.equal(await closeups.isVisible(),true);
      assert.equal(await closeups.evaluate(i=>i.complete&&i.naturalWidth>600),true);
      await card.locator('.setting-photos > summary').tap();
    }
    assert.equal(await page.locator('.machine img[src="assets/abs.jpg"]').count(),0,'wrong abs whole-machine photo is removed');
    assert.equal(await page.locator('#mon-pulldown .model-status').count(),0,'repetitive generic model paragraph is removed');
    assert.match(await page.locator('#mon-pulldown .equipment-image-label').innerText(), /参考机型/,'unconfirmed photo keeps a concise reference badge');
    assert.doesNotMatch(await page.locator('body').innerText(), /整机图用于辨认训练类型，尚未确认浅草店具体型号/);
    assert.equal(await page.locator('.setting-photos[open]').count(),0,'setting photos start collapsed');
    const gallery = page.locator('#wed-legcurl .setting-photos');
    await gallery.locator('summary').tap();
    assert.equal(await gallery.evaluate(el=>el.open),true,'native expansion works with JavaScript disabled');
    assert.equal(await gallery.locator('img').count(),2);
    assert.equal(await gallery.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),true);
    assert.match(await gallery.innerText(), /M.*C/s);
    assert.equal(await page.locator('.machine-profile [data-last-weight]').count(),15);
    assert.equal(await page.locator('.machine-profile [data-last-date]').count(),15);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'profile fits a 390px mobile screen');
    await context.close();
    console.log(`PASS ${engine} equipment profiles: corrected chest 7/D and triceps 2 photos/settings, chest weight binding preserved, A/B SS-AB main photos, native adjustment viewing without JavaScript and mobile width`);
  } finally { if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

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
    assert.equal(await page.locator('.machine-profile').count(), 15, 'every training card shows its separate profile');
    assert.match(await page.locator('#mon-row .fixed-settings').innerText(), /前后调节.*10.*高度.*9/s);
    assert.match(await page.locator('#wed-legpress .fixed-settings').innerText(), /调节档位.*5/s);
    assert.doesNotMatch(await page.locator('#wed-legpress .fixed-settings').innerText(), /kg|公斤|重量/);
    assert.equal(await page.locator('#wed-legpress [data-last-weight="legpress"]').innerText(), '待记录');
    assert.match(await page.locator('#wed-glute .model-status').innerText(), /已确认.*HS-HG/s);
    for(const id of ['mon-abs','wed-abs']) {
      const card=page.locator('#'+id);
      assert.equal(await card.locator('.equipment-thumb').getAttribute('src'),'assets/abs-insignia.jpg','whole-machine photo is the main thumbnail');
      assert.equal(await card.locator('.photo-viewer img').getAttribute('src'),'assets/abs-insignia.jpg','enlargement shows the same whole machine');
      assert.match(await card.locator('.model-status').innerText(), /Life Fitness.*SS-AB/s);
      assert.match(await card.locator('.photo-viewer figcaption').textContent(), /厂家.*非.*实拍/s);
      const closeups=card.locator('img[src="assets/settings/abdominal-height-4.jpg"]');
      assert.equal(await closeups.count(),1,'height-4 detail appears once, only in adjustment gallery');
      assert.equal(await card.locator('.setting-photos img[src="assets/settings/abdominal-height-4.jpg"]').count(),1);
      assert.equal(await card.locator('.setting-photos').evaluate(e=>e.open),false);
      await card.locator('.setting-photos > summary').tap();
      assert.equal(await closeups.isVisible(),true);
      assert.equal(await closeups.evaluate(i=>i.complete&&i.naturalWidth>600),true);
      await card.locator('.setting-photos > summary').tap();
      await card.locator('.photo-viewer > summary').tap();
      assert.equal(await card.locator('.photo-viewer img').evaluate(i=>i.complete&&i.naturalWidth===1000),true);
      await card.locator('.photo-viewer > summary').tap();
    }
    assert.equal(await page.locator('.machine img[src="assets/abs.jpg"]').count(),0,'wrong abs whole-machine photo is removed');
    assert.match(await page.locator('#mon-pulldown .model-status').innerText(), /参考机型.*尚未确认/s);
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
    console.log(`PASS ${engine} equipment profiles: A/B SS-AB whole-machine photos, height closeup only in collapsed gallery, 15 separate profiles, native photo expansion without JavaScript and mobile width`);
  } finally { if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

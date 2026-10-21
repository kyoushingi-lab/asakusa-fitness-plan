// All dates and loads below are synthetic test fixtures, not personal workout history.
// Focused mobile checks for equipment profiles and native, script-free photo browsing.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const site = path.resolve(__dirname, '..');
const modulePath = path.join(site, 'work/equipment-transform.cjs');
const upgrade = fs.existsSync(modulePath) ? require(modulePath) : { transform: html => html, css: '', copyAssets() {} };
const engine = process.argv[2] || 'chromium';
const playwright = require('playwright');

async function main() {
  upgrade.copyAssets(site);
  const before = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const html = upgrade.transform(before).replace('</head>', `<style>${upgrade.css}</style></head>`);
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
    assert.match(await page.locator('#mon-abs .model-status').innerText(), /Life Fitness.*型号待核实/s);
    assert.equal(await page.locator('.machine img[src="assets/abs.jpg"]').count(),0,'wrong abs whole-machine photo is removed');
    assert.match(await page.locator('#mon-abs .photo-viewer figcaption').textContent(), /调节位置实拍，非整机图/);
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
    assert.equal(upgrade.transform(upgrade.transform(before)),upgrade.transform(before),'transform is idempotent');
    await context.close();
    console.log(`PASS ${engine} equipment profiles: 15 cards, separate settings/weights, correct photo/model labels, native photo expansion without JavaScript, mobile width and idempotence`);
  } finally { if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

// All dates and loads below are synthetic test fixtures, not personal workout history.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const engine=process.argv[3]||'chromium';
const results=[];
let browser,server,origin;
async function test(name,body){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Tokyo'});
  const page=await context.newPage();page.setDefaultTimeout(1500);
  try{await page.clock.install({time:new Date('2020-10-21T12:00:00+09:00')});await page.goto(origin);await body(page);results.push({name,pass:true});console.log('PASS '+name);}
  catch(error){results.push({name,pass:false,error:error.message});console.log('FAIL '+name+' — '+error.message.split('\n')[0]);}
  finally{await context.close();}
}
const txt=(page,id)=>page.locator(id).innerText();
async function main(){
  server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.jpg':'image/jpeg'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await (engine==='webkit'?webkit.launch():chromium.launch());
  await test('slope and speed are large, readable and fit a narrow phone',async page=>{
    assert.equal(await page.locator('#timerGrade').count(),1);
    assert.equal(await txt(page,'#timerGrade'),'3');assert.equal(await txt(page,'#timerSpeed'),'4');
    assert.ok(await page.locator('#timerGrade').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=32));
    for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    assert.equal(await txt(page,'#clock'),'06:00');assert.match(await txt(page,'#totalClock'),/30:40/);
  });
  await test('first boundary allows ten seconds to adjust next slope and speed',async page=>{
    await page.locator('#play').tap();await page.clock.fastForward(360000);
    assert.match(await txt(page,'#timerLabel'),/调整参数.*第2\/5段/);assert.equal(await txt(page,'#clock'),'00:10');
    assert.equal(await txt(page,'#timerGrade'),'7');assert.equal(await txt(page,'#timerSpeed'),'5');
    assert.match(await txt(page,'#totalClock'),/24:00/);
    await page.clock.fastForward(9000);assert.equal(await txt(page,'#clock'),'00:01');
    await page.clock.fastForward(1000);assert.match(await txt(page,'#timerLabel'),/^第2\/5段/);assert.equal(await txt(page,'#clock'),'06:00');
  });
  await test('all four gaps preserve thirty minutes of exercise and finish at thirty-forty',async page=>{
    await page.locator('#play').tap();
    for(const [jump,stage,grade,speed] of [[360000,2,'7','5'],[370000,3,'5','6'],[610000,4,'10','4.5'],[250000,5,'0','3.5']]){
      await page.clock.fastForward(jump);assert.match(await txt(page,'#timerLabel'),new RegExp('调整参数.*第'+stage+'/5段'));
      assert.equal(await txt(page,'#clock'),'00:10');assert.equal(await txt(page,'#timerGrade'),grade);assert.equal(await txt(page,'#timerSpeed'),speed);
    }
    await page.clock.fastForward(249000);assert.equal(await txt(page,'#clock'),'00:01');
    await page.clock.fastForward(1000);assert.match(await txt(page,'#timerLabel'),/30分钟爬坡已完成/);assert.equal(await txt(page,'#clock'),'00:00');
    assert.equal(await page.locator('#play').isDisabled(),true);await page.clock.fastForward(30000);assert.equal(await txt(page,'#clock'),'00:00');
  });
  await test('gap pause resume and reset keep the expected time and parameters',async page=>{
    await page.locator('#play').tap();await page.clock.fastForward(363000);await page.locator('#play').tap();
    assert.equal(await txt(page,'#clock'),'00:07');await page.clock.fastForward(30000);assert.equal(await txt(page,'#clock'),'00:07');
    await page.locator('#play').tap();await page.clock.fastForward(7000);assert.equal(await txt(page,'#clock'),'06:00');
    await page.locator('#reset').tap();assert.equal(await txt(page,'#clock'),'06:00');assert.equal(await txt(page,'#timerGrade'),'3');
    assert.match(await txt(page,'#play'),/开始/);await page.clock.fastForward(5000);assert.equal(await txt(page,'#clock'),'06:00');
  });
  await test('manual next enters a gap and ready button can start the next segment early',async page=>{
    await page.locator('#next').tap();assert.match(await txt(page,'#timerLabel'),/调整参数.*第2\/5段/);assert.equal(await txt(page,'#clock'),'00:10');
    await page.clock.fastForward(5000);assert.equal(await txt(page,'#clock'),'00:10');assert.match(await txt(page,'#next'),/参数已调好/);
    await page.locator('#next').tap();assert.match(await txt(page,'#timerLabel'),/^第2\/5段/);assert.equal(await txt(page,'#clock'),'06:00');
    await page.locator('#play').tap();await page.locator('#next').tap();await page.clock.fastForward(3000);assert.equal(await txt(page,'#clock'),'00:07');
    await page.locator('#next').tap();await page.clock.fastForward(1000);assert.equal(await txt(page,'#clock'),'09:59');assert.match(await txt(page,'#play'),/暂停/);
  });
  await test('wall-clock catch-up crosses gaps correctly after a background return',async page=>{
    await page.locator('#play').tap();const started=await page.evaluate(()=>Date.now());await page.clock.setSystemTime(new Date(started+745000));
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    assert.match(await txt(page,'#timerLabel'),/^第3\/5段/);assert.equal(await txt(page,'#clock'),'09:55');assert.equal(await txt(page,'#timerGrade'),'5');
    await page.clock.setSystemTime(new Date(started+1860000));await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.match(await txt(page,'#timerLabel'),/完成/);assert.equal(await txt(page,'#clock'),'00:00');
  });
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)server.close();
  const dir=path.join(__dirname,'../test-results');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'timer-upgrade-'+engine+'.json'),JSON.stringify(results,null,2));
  console.log(engine+': '+results.filter(x=>x.pass).length+'/'+results.length+' passed');if(results.some(x=>!x.pass))process.exitCode=1;
});

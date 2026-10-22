// All dates and loads below are synthetic test fixtures, not personal workout history.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {webkit,chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),engine=process.argv[2]||'webkit';
const fixture={app:'asakusa-personal-profile',version:1,entries:[{id:'date-only:2020-01-04:legpress:6.25',exercise:'legpress',kg:6.25,date:'2020-01-04',time:'00:00',at:'2020-01-03T15:00:00.000Z'}],sessions:[{date:'2020-01-02',plan:'a',completed:['pulldown','row','chest','triceps'],skipped:{abs:'器械被占用'}},{date:'2020-01-04',plan:'b',completed:['glute','legpress','legcurl','abductor','abs'],skipped:{}}]};
let browser,server;
async function ready(page){await page.waitForFunction(()=>/交互已启用|组件暂未加载/.test(document.querySelector('#runtimeStatus').textContent));assert.match(await page.locator('#runtimeStatus').textContent(),/交互已启用/);}
(async()=>{try{
 server=http.createServer((req,res)=>{let name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await (engine==='webkit'?webkit:chromium).launch();
 const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Asia/Tokyo'});const p=await c.newPage();p.setDefaultTimeout(5000);await p.clock.install({time:new Date('2020-01-04T18:00:00+09:00')});
 await p.goto('http://127.0.0.1:'+server.address().port);
 await ready(p);
 assert.equal(await p.locator('#cyclePanel').evaluate(e=>e.open),false);await p.locator('#cyclePanel > summary').tap();assert.equal(await p.locator('#cycleDate').isVisible(),true);console.log('PASS native calendar starts collapsed and opens on tap');
 await p.locator('#cycleComplete').tap();assert.match(await p.locator('#cycleRecommendation').textContent(),/B/);
 assert.equal(await p.evaluate(()=>localStorage.getItem('gym-compatible.rotation.v1')),null,'new calendar records stay outside the legacy global namespace');
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('gym-account.v2|guest|gym-compatible.rotation.v1')).sessions.length),1);
 await p.locator('.workout-import').evaluate(e=>e.open=true);await p.locator('#importWorkout').setInputFiles({name:'private.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await p.locator('#applyWorkoutImport').click();assert.match(await p.locator('#cycleRecommendation').textContent(),/C/);assert.match(await p.locator('#historyRows').innerText(),/时间未记录/);
 assert.equal(await p.locator('#wed-legpress input.load').inputValue(),'6.25');
 assert.equal(await p.evaluate(()=>localStorage.getItem('gym-account.v2|guest|gym-compatible.load.legpress')),'6.25');
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('gym-account.v2|guest|gym-compatible.history.v1'))[0].kg),6.25);
 assert.equal(await p.evaluate(()=>localStorage.getItem('gym-compatible.history.v1')),null,'private import writes only to the current guest scope');
 await p.locator('#cycleHistory summary').tap();assert.match(await p.locator('#cycleLog').innerText(),/2020-01-02.*A/);assert.match(await p.locator('#cycleLog').innerText(),/腹肌.*器械被占用/);assert.match(await p.locator('#cycleLog').innerText(),/2020-01-04.*B/);
 await p.locator('.workout-import').evaluate(e=>e.open=true);await p.locator('#importWorkout').setInputFiles({name:'private.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await p.locator('#applyWorkoutImport').click();
 assert.equal(await p.locator('#historyRows tr').count(),1);await p.reload();await ready(p);assert.match(await p.locator('#cycleRecommendation').textContent(),/C/);assert.equal(await p.locator('#historyRows tr').count(),1);console.log('PASS private import corrects dates in current guest scope, preserves skipped abs, date-only load and deduplicates');
 await p.locator('.workout-import').evaluate(e=>e.open=true);await p.locator('#importWorkout').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...fixture,sessions:[{date:'2020-01-99',plan:'a'}]}))});assert.equal(await p.locator('#applyWorkoutImport').isVisible(),false);assert.equal(await p.locator('#historyRows tr').count(),1);console.log('PASS invalid private bundle does not change records');
 await c.close();const nc=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844},isMobile:true,hasTouch:true});const np=await nc.newPage();await np.goto('http://127.0.0.1:'+server.address().port);await np.locator('#cyclePanel > summary').tap();assert.equal(await np.locator('#cycleGo').isVisible(),true);assert.equal(await np.locator('.machine').count(),15);await nc.close();console.log('PASS calendar opens and all exercises remain available without JavaScript');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

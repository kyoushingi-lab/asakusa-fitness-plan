// All dates and loads below are synthetic test fixtures, not personal workout history.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
fs.mkdirSync(require('node:path').join(__dirname,'../test-results'),{recursive:true});
const {webkit,chromium}=require('playwright');
const engine=process.argv[2]||'webkit';const root=path.resolve(__dirname,'..');let browser,server;
const uid='11111111-1111-4111-8111-111111111111';
function session(id=uid){const exp=Math.floor(Date.now()/1000)+3600;const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,exp,role:'authenticated'})).toString('base64url')+'.test';return{access_token:token,refresh_token:'test-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id,email:'fitness@example.test',aud:'authenticated',role:'authenticated'}};}
(async()=>{
server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
browser=await(engine==='webkit'?webkit.launch():chromium.launch());
let records=[],requests=0,blockedRequests=0,fail=false;
async function device(id=uid){const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
if(id)await c.addInitScript(s=>{if(!localStorage.getItem('sb-fitness-test-auth-token'))localStorage.setItem('sb-fitness-test-auth-token',JSON.stringify(s));},session(id));
await c.route('**/cloud-config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.GYM_CLOUD={url:"https://fitness-test.supabase.co",key:"test-public-key"};'}));
await c.route('https://fitness-test.supabase.co/**',async r=>{requests++;const req=r.request(),url=new URL(req.url());if(url.pathname.includes('/rest/v1/')){
const token=req.headers().authorization?.split(' ')[1];if(token&&JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub!==uid)blockedRequests++;
if(fail){await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'temporary outage'})});return;}
if(req.method()==='GET'){await r.fulfill({contentType:'application/json',body:JSON.stringify(records.map(({user_id,...e})=>e))});return;}
if(req.method()==='POST'){const batch=req.postDataJSON();assert.ok(batch.every(e=>e.user_id===uid));assert.equal(req.headers().prefer.includes('ignore-duplicates'),true);for(const e of batch)if(!records.some(x=>x.id===e.id))records.push(e);await r.fulfill({status:201,body:''});return;}
}await r.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/user')?session(id).user:{})});});
const p=await c.newPage();p.setDefaultTimeout(10000);await p.goto(origin);return{c,p};}
const guest=await device(null);await guest.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('尚未登录'));
await guest.p.locator('#syncEmail').fill('fitness@example.test');const requestEvent=guest.p.waitForRequest(r=>r.url().includes('/auth/v1/otp'));await guest.p.locator('#syncSend').click();const loginRequest=await requestEvent;
assert.equal(loginRequest.postDataJSON().email,'fitness@example.test');assert.equal(new URL(loginRequest.url()).searchParams.get('redirect_to'),origin+'/');await guest.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('登录链接已发送'));assert.equal(await guest.p.locator('#syncSend').isDisabled(),true);await guest.c.close();console.log('PASS login email uses the correct return URL and limits repeat requests (mocked mail)');
const a=await device();await a.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.startsWith('已同步'));
await a.p.locator('#mon-row input.load').fill('17.5');await a.p.locator('#syncNow').click();await a.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('1 条'));
assert.equal(records.length,1);const b=await device();await b.p.waitForFunction(()=>document.querySelector('#historyRows').children.length===1);assert.equal(await b.p.locator('#fri-row input.load').inputValue(),'17.5');console.log('PASS same-account second device downloads dated history and latest load');
await b.c.setOffline(true);await b.p.locator('#mon-row input.load').fill('20');await b.p.locator('#syncNow').click();assert.match(await b.p.locator('#syncStatus').innerText(),/离线/);assert.equal(records.length,1);
await b.c.setOffline(false);await b.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('2 条'));
await a.p.locator('#syncNow').click();await a.p.waitForFunction(()=>document.querySelector('#historyRows').children.length===2);assert.equal(await a.p.locator('#mon-row input.load').inputValue(),'20');console.log('PASS offline save retries on reconnection and reaches other device');
await a.p.locator('#mon-row input.load').fill('');await a.p.locator('#syncNow').click();await a.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.startsWith('已同步'));assert.equal(await a.p.locator('#mon-row input.load').inputValue(),'');assert.equal(records.length,2);console.log('PASS repeated sync neither duplicates records nor restores intentionally cleared weight');
fail=true;await a.p.locator('#mon-chest input.load').fill('15');await a.p.locator('#syncNow').click();await a.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('本机记录已保留'));assert.equal(await a.p.locator('#historyRows tr').count(),3);
fail=false;await a.p.locator('#syncNow').click();await a.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('3 条'));assert.equal(records.length,3);console.log('PASS server error preserves local history and retries without data loss');
const dateOnly={app:'asakusa-personal-profile',version:1,entries:[{id:'date-only:2020-01-04:glute:33.75',exercise:'glute',kg:33.75,date:'2020-01-04',time:'00:00',at:'2020-01-03T15:00:00.000Z'}],sessions:[{date:'2020-01-04',plan:'b',completed:['glute'],skipped:{}}]};
await b.p.locator('.workout-import > summary').click();await b.p.locator('#importWorkout').setInputFiles({name:'synthetic-profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(dateOnly))});await b.p.locator('#applyWorkoutImport').click();await b.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('4 条'));
assert.equal(records.length,4);const c=await device();await c.p.waitForFunction(()=>document.querySelector('#historyRows').children.length===4);assert.match(await c.p.locator('#historyRows').innerText(),/2020-01-04 时间未记录/);assert.equal(await c.p.locator('#wed-glute [data-last-weight]').innerText(),'33.75 kg');await c.c.close();console.log('PASS imported date-only history automatically syncs and retains unknown time on another device');
await a.p.evaluate(s=>localStorage.setItem('sb-fitness-test-auth-token',JSON.stringify(s)),session('22222222-2222-4222-8222-222222222222'));await a.p.reload();await a.p.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('另一个账号'));assert.equal(blockedRequests,0);console.log('PASS different account cannot upload or merge the existing browser history');
await b.p.locator('#sync').scrollIntoViewIfNeeded();await b.p.screenshot({path:path.join(__dirname,'../test-results/sync-'+engine+'.png')});
await a.c.close();await b.c.close();console.log(engine+': 7 cloud integration scenarios passed (simulated server, real client)');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)server.close();});

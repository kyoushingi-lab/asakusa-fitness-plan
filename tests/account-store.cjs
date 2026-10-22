// Synthetic fixtures only: dates, user IDs and loads below are test data, not personal training history.
const assert=require('node:assert/strict');
let Gym;
try{Gym=require('../account-store.js');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
class MemoryStorage{
  constructor(seed={}){this.data=new Map(Object.entries(seed));}
  get length(){return this.data.size;}
  key(index){return [...this.data.keys()][index]||null;}
  getItem(key){return this.data.has(key)?this.data.get(key):null;}
  setItem(key,value){this.data.set(String(key),String(value));}
  removeItem(key){this.data.delete(key);}
}
const A='user:11111111-1111-4111-8111-111111111111',B='user:22222222-2222-4222-8222-222222222222';
const HISTORY='gym-compatible.history.v1',PENDING='gym-compatible.pending.v1',ROTATION='gym-compatible.rotation.v1',OWNER='gym-compatible.sync-owner.v1';
const LOAD='gym-compatible.load.chest',SETTING='gym-compatible.setting.chest.seat',DONE='gym-compatible.done.2020-10-21.mon-chest';
const session=(date,plan)=>({date,plan,at:date+'T00:00:00.000Z'});
const rotation=(sessions=[],busy=[],next='a')=>JSON.stringify({version:1,next,sessions,busy});
const entry=(id='entry1',exercise='chest',kg=7.5)=>({id,exercise,kg,date:'2020-10-21',time:'09:00',at:'2020-10-21T00:00:00.000Z'});
function create(storage,scope='guest',extra={}){assert.ok(Gym&&typeof Gym.create==='function','GymAccountStore.create must be exported');return Gym.create({storage,scope,now:()=>1000,...extra});}
const results=[];
function test(name,body){try{body();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.stack});console.log('FAIL '+name+' — '+error.message);}}
test('new guest and accounts start empty and never share logical values',()=>{
  const storage=new MemoryStorage(),guest=create(storage),a=create(storage,A),b=create(storage,B);
  for(const store of [guest,a,b]){assert.equal(store.get(HISTORY),null);assert.equal(store.get(ROTATION),null);assert.equal(store.get(SETTING),null);assert.deepEqual(store.stateEntries(),[]);}
  a.set(LOAD,'12.5');a.set(SETTING,'2');assert.equal(b.get(LOAD),null);assert.equal(guest.get(LOAD),null);assert.equal(b.get(SETTING),null);assert.equal(a.getScope(),A);
});
test('legacy owner records migrate only into that owner, preserving original bytes',()=>{
  const legacy={[OWNER]:A.slice(5),[HISTORY]:JSON.stringify([entry()]),[LOAD]:'7.5',[ROTATION]:rotation([session('2020-10-21','a')],[],'b'),[DONE]:'yes'};
  const storage=new MemoryStorage(legacy),guest=create(storage),b=create(storage,B),a=create(storage,A,{seedSettings:{[SETTING]:'2'}});
  assert.equal(guest.get(HISTORY),null);assert.equal(b.get(HISTORY),null);assert.equal(a.get(HISTORY),legacy[HISTORY]);assert.equal(a.get(SETTING),'2');
  for(const [key,value]of Object.entries(legacy))assert.equal(storage.getItem(key),value);
  assert.equal(b.guestSummary().weights,0);assert.equal(b.importGuest().weights,0);assert.equal(b.get(LOAD),null);
});
test('unowned legacy data becomes guest data and seeds settings only with real legacy data',()=>{
  const storage=new MemoryStorage({[HISTORY]:JSON.stringify([entry()]),[LOAD]:'7.5'}),a=create(storage,A,{seedSettings:{[SETTING]:'2'}}),guest=create(storage,'guest',{seedSettings:{[SETTING]:'2'}});
  assert.equal(a.get(HISTORY),null);assert.equal(a.get(SETTING),null);assert.equal(guest.get(SETTING),'2');assert.equal(guest.get(LOAD),'7.5');assert.equal(a.guestSummary().weights,1);
  assert.equal(create(new MemoryStorage({[HISTORY]:'[]'}),'guest',{seedSettings:{[SETTING]:'2'}}).get(SETTING),null);
});
test('legacy migration runs once and does not recopy subsequently edited global keys',()=>{
  const storage=new MemoryStorage({[LOAD]:'7.5'}),first=create(storage);first.set(LOAD,'10');storage.setItem(LOAD,'99');
  assert.equal(create(storage).get(LOAD),'10');assert.equal(storage.getItem(LOAD),'99');
});
test('scope is immutable so a deferred draft flush cannot write into a later account',()=>{
  const storage=new MemoryStorage(),a=create(storage,A),b=create(storage,B);const flush=()=>a.set(PENDING,JSON.stringify({chest:entry('pending')}));
  try{a.scope=B;}catch(error){}flush();assert.equal(a.scope,A);assert.equal(b.get(PENDING),null);assert.match(a.get(PENDING),/pending/);
});
test('legacy calendar, check-ins and explicit blank latest become separate state rows',()=>{
  const storage=new MemoryStorage({[ROTATION]:rotation([session('2020-10-21','a')],['2020-10-22'],'b'),[DONE]:'no',[LOAD]:''});const store=create(storage);
  const rows=store.stateEntries();assert.equal(rows.filter(x=>x.kind==='calendar').length,2);
  assert.equal(rows.find(x=>x.kind==='checkin').value,false);assert.equal(rows.find(x=>x.kind==='latest').value,'');assert.equal(store.get(LOAD),'');
});
test('state revisions increase with frozen or backwards clocks and survive reloads',()=>{
  const storage=new MemoryStorage();let time=100;const store=create(storage,A,{now:()=>time});store.set(LOAD,'10');const first=store.stateEntries().find(x=>x.kind==='latest');
  time=1;store.set(LOAD,'11');const second=store.stateEntries().find(x=>x.kind==='latest');assert.ok(second.revision>first.revision);
  const reload=create(storage,A,{now:()=>0});reload.set(LOAD,'12');const third=reload.stateEntries().find(x=>x.kind==='latest');assert.ok(third.revision>second.revision);assert.equal(third.device_id,first.device_id);
});
test('per-date calendar merge preserves independent concurrent dates',()=>{
  const one=create(new MemoryStorage(),A),two=create(new MemoryStorage(),A);one.set(ROTATION,rotation([session('2020-10-19','a')],[],'b'));two.set(ROTATION,rotation([session('2020-10-21','b')],[],'c'));
  one.mergeState(two.stateEntries());two.mergeState(one.stateEntries());
  assert.deepEqual(JSON.parse(one.get(ROTATION)).sessions.map(s=>s.date),['2020-10-19','2020-10-21']);assert.equal(JSON.parse(one.get(ROTATION)).next,'c');assert.deepEqual(JSON.parse(two.get(ROTATION)),JSON.parse(one.get(ROTATION)));
});
test('a calendar tombstone defeats stale offline data and all-deleted fallback survives',()=>{
  const one=create(new MemoryStorage(),A);one.set(ROTATION,rotation([session('2020-10-21','b')],[],'c'));const stale=one.stateEntries();one.set(ROTATION,rotation([],[],'b'));
  const removed=one.stateEntries().find(x=>x.kind==='calendar');assert.equal(removed.deleted,true);one.mergeState(stale);assert.deepEqual(JSON.parse(one.get(ROTATION)).sessions,[]);assert.equal(JSON.parse(one.get(ROTATION)).next,'b');
  const two=create(new MemoryStorage(),A);two.mergeState(one.stateEntries());assert.deepEqual(JSON.parse(two.get(ROTATION)).sessions,[]);assert.equal(JSON.parse(two.get(ROTATION)).next,'b');
});
test('training and busy are mutually exclusive in the same calendar entity',()=>{
  const store=create(new MemoryStorage(),A);store.set(ROTATION,rotation([] ,['2020-10-21']));store.set(ROTATION,rotation([session('2020-10-21','a')],[],'b'));
  const row=store.stateEntries().find(x=>x.kind==='calendar');assert.equal(row.value.busy,false);assert.equal(row.value.session.plan,'a');assert.equal(store.stateEntries().filter(x=>x.kind==='calendar').length,1);
});
test('false check-ins and empty latest values synchronize instead of resurrecting old values',()=>{
  const store=create(new MemoryStorage(),A);store.set(DONE,'yes');store.set(LOAD,'10');const stale=store.stateEntries();store.set(DONE,'no');store.set(LOAD,'');store.mergeState(stale);
  const other=create(new MemoryStorage(),A);other.mergeState(store.stateEntries());assert.equal(other.get(DONE),'no');assert.equal(other.get(LOAD),'');
});
test('same-revision ties use device id and ignored rows cannot mutate returned data',()=>{
  const store=create(new MemoryStorage(),A);store.mergeState([{kind:'latest',key:'chest',value:'10',revision:200,device_id:'device-b',deleted:false},{kind:'latest',key:'chest',value:'5',revision:200,device_id:'device-a',deleted:false}]);assert.equal(store.get(LOAD),'10');
  const rows=store.stateEntries();rows[0].value='77';assert.equal(store.get(LOAD),'10');
  assert.throws(()=>store.mergeState([{kind:'checkin',key:'bad',value:'yes',revision:999,device_id:'z',deleted:false}]));assert.equal(store.get(LOAD),'10');
});
test('remote merge is idempotent, does not create local revisions and permits unsubscribe',()=>{
  const store=create(new MemoryStorage(),A),events=[];const unsubscribe=store.subscribe(keys=>events.push(keys));const row={kind:'latest',key:'chest',value:'8',revision:500,device_id:'remote',deleted:false};
  assert.deepEqual(store.mergeState([row]),[LOAD]);const snapshot=store.stateEntries();assert.deepEqual(store.mergeState([row]),[]);assert.deepEqual(store.stateEntries(),snapshot);assert.equal(events.length,1);unsubscribe();store.set(LOAD,'9');assert.equal(events.length,1);
});
test('history cache merges without tracking and state projection restores intentional blanks',()=>{
  const store=create(new MemoryStorage(),A),events=[];store.subscribe(keys=>events.push(keys));store.set(LOAD,'');const snapshot=store.stateEntries();events.length=0;
  store.withoutTracking(()=>{store.set(LOAD,'25');store.set(HISTORY,JSON.stringify([entry()]));});assert.equal(store.get(LOAD),'25');assert.deepEqual(store.stateEntries(),snapshot);assert.deepEqual(events,[]);
  assert.deepEqual(store.projectState(),[LOAD]);assert.equal(store.get(LOAD),'');assert.deepEqual(store.stateEntries(),snapshot);assert.equal(events.length,1);
});
test('state projection leaves history-derived latest values alone when no latest entity exists',()=>{
  const store=create(new MemoryStorage(),A);store.withoutTracking(()=>store.set(LOAD,'7.5'));assert.deepEqual(store.mergeState([]),[]);assert.equal(store.get(LOAD),'7.5');assert.deepEqual(store.stateEntries(),[]);
});
test('reload projects authoritative state over a history-only cache refresh',()=>{
  const storage=new MemoryStorage(),store=create(storage,A);store.set(LOAD,'');store.withoutTracking(()=>store.set(LOAD,'25'));
  assert.equal(create(storage,A).get(LOAD),'');
});
test('browser global export can be loaded without CommonJS or network',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),context={};vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../account-store.js'),'utf8'),context);
  assert.equal(typeof context.GymAccountStore.create,'function');const store=context.GymAccountStore.create({scope:'guest',storage:new MemoryStorage(),now:()=>10});store.set(LOAD,'3.75');assert.equal(store.get(LOAD),'3.75');
});
test('explicit guest import deduplicates weights and preserves target dates, settings and clears',()=>{
  const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);guest.set(HISTORY,JSON.stringify([entry('guest'),entry('shared')]));guest.set(PENDING,JSON.stringify({row:entry('pending','row',12)}));guest.set(ROTATION,rotation([session('2020-10-19','a'),session('2020-10-21','b')],[],'c'));guest.set(DONE,'yes');guest.set(SETTING,'2');guest.set(LOAD,'7.5');
  target.set(HISTORY,JSON.stringify([entry('shared')]));target.set(ROTATION,rotation([session('2020-10-21','c')],[],'a'));target.set(SETTING,'9');target.set(LOAD,'');target.set(DONE,'no');assert.equal(target.guestSummary().weights,3);
  const result=target.importGuest();assert.equal(result.weights,2);assert.equal(JSON.parse(target.get(HISTORY)).length,3);assert.equal(JSON.parse(target.get(ROTATION)).sessions.find(s=>s.date==='2020-10-21').plan,'c');assert.equal(JSON.parse(target.get(ROTATION)).sessions.length,2);
  assert.equal(target.get(SETTING),'9');assert.equal(target.get(LOAD),'');assert.equal(target.get(DONE),'no');assert.equal(target.importGuest().weights,0);assert.equal(JSON.parse(guest.get(HISTORY)).length,2);
});
test('guest import fills missing fields and creates sync state only after explicit action',()=>{
  const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);guest.set(SETTING,'2');guest.set(LOAD,'7.5');guest.set(DONE,'yes');assert.deepEqual(target.stateEntries(),[]);
  const imported=target.importGuest();assert.equal(imported.settings,1);assert.equal(imported.checkins,1);assert.equal(target.get(SETTING),'2');assert.equal(target.get(DONE),'yes');assert.equal(target.get(LOAD),'7.5');assert.ok(target.stateEntries().length>=3);
});
test('corrupt legacy history and rotation are preserved through migration and remote projection',()=>{
  const storage=new MemoryStorage({[HISTORY]:'{broken-history',[ROTATION]:'{broken-rotation'}),store=create(storage);
  assert.equal(store.get(HISTORY),'{broken-history');assert.equal(store.get(ROTATION),'{broken-rotation');
  store.mergeState([{kind:'calendar',key:'2020-10-21',value:{session:session('2020-10-21','a'),busy:false},revision:2000,device_id:'remote',deleted:false}]);assert.equal(store.get(ROTATION),'{broken-rotation');assert.equal(store.get(HISTORY),'{broken-history');assert.equal(storage.getItem(ROTATION),'{broken-rotation');
});
test('guest import rejects corrupt target history before mutating other fields',()=>{
  const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);guest.set(SETTING,'2');target.set(HISTORY,'{broken');assert.throws(()=>target.importGuest());assert.equal(target.get(SETTING),null);assert.equal(target.get(HISTORY),'{broken');
});
test('storage denial keeps the immutable scoped store usable in memory',()=>{
  const storage={get length(){throw Error('denied');},getItem(){throw Error('denied');},setItem(){throw Error('denied');},key(){throw Error('denied');}};const store=create(storage,A);store.set(LOAD,'7.5');assert.equal(store.get(LOAD),'7.5');assert.equal(store.isVolatile(),true);assert.equal(create(storage,B).get(LOAD),null);
});
test('settings length is bounded and invalid remote rows reject the whole batch atomically',()=>{
  const store=create(new MemoryStorage(),A);assert.throws(()=>store.set(SETTING,'x'.repeat(81)));assert.equal(store.get(SETTING),null);
  assert.throws(()=>store.mergeState([{kind:'latest',key:'chest',value:'10',revision:20,device_id:'remote',deleted:false},{kind:'setting',key:'chest.seat',value:'x'.repeat(81),revision:21,device_id:'remote',deleted:false}]));assert.equal(store.get(LOAD),null);assert.deepEqual(store.stateEntries(),[]);
});
test('same-browser stores merge current physical state before edits and cannot project stale values',()=>{
  const storage=new MemoryStorage(),a=create(storage,A),b=create(storage,A);
  a.set(LOAD,'10');const firstRevision=a.stateEntries().find(x=>x.kind==='latest').revision;b.set(LOAD,'20');assert.ok(b.stateEntries().find(x=>x.kind==='latest').revision>firstRevision);
  a.projectState();assert.equal(b.get(LOAD),'20');a.set(SETTING,'2');b.set('gym-compatible.setting.row.height','9');
  const reload=create(storage,A);assert.equal(reload.stateEntries().filter(x=>x.kind==='setting').length,2);
});
test('stale calendar UI never deletes or resurrects dates the caller did not change',()=>{
  const storage=new MemoryStorage(),a=create(storage,A),b=create(storage,A);assert.equal(a.get(ROTATION),null);assert.equal(b.get(ROTATION),null);
  a.set(ROTATION,rotation([session('2020-10-19','a')],[],'b'));b.set(ROTATION,rotation([session('2020-10-21','b')],[],'c'));
  assert.deepEqual(JSON.parse(b.get(ROTATION)).sessions.map(x=>x.date),['2020-10-19','2020-10-21']);
  const c=create(storage,A),d=create(storage,A);const cSeen=JSON.parse(c.get(ROTATION)),dSeen=JSON.parse(d.get(ROTATION));
  cSeen.sessions=cSeen.sessions.filter(x=>x.date!=='2020-10-19');c.set(ROTATION,JSON.stringify(cSeen));
  dSeen.sessions.find(x=>x.date==='2020-10-21').plan='c';d.set(ROTATION,JSON.stringify(dSeen));
  assert.deepEqual(JSON.parse(d.get(ROTATION)).sessions.map(x=>x.date),['2020-10-21']);assert.equal(JSON.parse(d.get(ROTATION)).sessions[0].plan,'c');
});
test('append-only local journals survive an overwritten shared state snapshot',()=>{
  const storage=new MemoryStorage(),a=create(storage,A),b=create(storage,A);a.set(SETTING,'2');const oldSnapshot=[...storage.data.entries()].find(([key])=>key.endsWith('|__state'));
  b.set('gym-compatible.setting.row.height','9');storage.setItem(oldSnapshot[0],oldSnapshot[1]);
  assert.equal(create(storage,A).stateEntries().filter(x=>x.kind==='setting').length,2);
});
test('same-browser history append unions stale arrays and exposes both entries after reload',()=>{
  const storage=new MemoryStorage(),a=create(storage,A),b=create(storage,A);a.get(HISTORY);b.get(HISTORY);
  a.set(HISTORY,JSON.stringify([entry('from-a')]));b.set(HISTORY,JSON.stringify([entry('from-b')]));
  assert.deepEqual(JSON.parse(create(storage,A).get(HISTORY)).map(x=>x.id).sort(),['from-a','from-b']);
});
test('pending drafts from different controls survive stale flushes and old clears cannot remove a newer draft',()=>{
  const storage=new MemoryStorage(),a=create(storage,A),b=create(storage,A);a.get(PENDING);b.get(PENDING);
  a.set(PENDING,JSON.stringify({chest:entry('a-draft')}));b.set(PENDING,JSON.stringify({row:entry('b-draft','row',9)}));
  assert.deepEqual(Object.keys(JSON.parse(create(storage,A).get(PENDING))).sort(),['chest','row']);
  a.set(PENDING,'{}');assert.deepEqual(Object.keys(JSON.parse(b.get(PENDING))),['row']);
  const c=create(storage,A),d=create(storage,A);c.get(PENDING);d.get(PENDING);c.set(PENDING,JSON.stringify({chest:entry('older-chest')}));d.set(PENDING,JSON.stringify({chest:entry('newer-chest')}));c.set(PENDING,'{}');
  assert.equal(JSON.parse(create(storage,A).get(PENDING)).chest.id,'newer-chest');
});
test('different browser pages use distinct writer identities even on one physical device',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../account-store.js'),'utf8'),storage=new MemoryStorage();
  function page(){const context={document:{}};vm.createContext(context);vm.runInContext(source,context);return context.GymAccountStore.create({scope:A,storage,now:()=>1000});}
  const a=page(),b=page();a.set(LOAD,'10');const actor=a.stateEntries().find(x=>x.kind==='latest').device_id;b.set(LOAD,'20');assert.notEqual(actor,b.stateEntries().find(x=>x.kind==='latest').device_id);
});
test('guestSnapshot reads history plus valid pending records without changing storage or revisions',()=>{
  const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);
  guest.set(HISTORY,JSON.stringify([entry('saved'),entry('duplicate')]));guest.set(PENDING,JSON.stringify({chest:entry('duplicate'),row:entry('pending','row',9),invalid:{bad:true}}));guest.set(SETTING,'2');
  const before=[...storage.data.entries()],versions=target.stateEntries();assert.equal(typeof target.guestSnapshot,'function');const snapshot=target.guestSnapshot();
  assert.deepEqual(snapshot.weights.map(x=>x.id).sort(),['duplicate','pending','saved']);assert.ok(snapshot.states.some(x=>x.kind==='setting'&&x.key==='chest.seat'));
  assert.deepEqual([...storage.data.entries()],before);assert.deepEqual(target.stateEntries(),versions);assert.equal(target.get(SETTING),null);
  snapshot.weights[0].kg=999;assert.notEqual(target.guestSnapshot().weights[0].kg,999);
});
test('guestSnapshot omits existing account identities, raw fields, preferences and guest deletions',()=>{
  const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);
  guest.set(ROTATION,rotation([session('2020-10-19','a'),session('2020-10-21','b')],[],'c'));guest.set(ROTATION,rotation([session('2020-10-21','b')],[],'c'));
  guest.set(SETTING,'2');guest.set(LOAD,'7.5');guest.set(DONE,'yes');guest.set('gym-compatible.setting.row.height','9');
  target.withoutTracking(()=>{target.set(SETTING,'');target.set(LOAD,'');target.set(DONE,'no');});target.set(ROTATION,rotation([session('2020-10-21','c')],[],'a'));
  const snapshot=target.guestSnapshot();assert.deepEqual(snapshot.states.map(x=>[x.kind,x.key]),[['setting','row.height']]);
  assert.equal(target.get(SETTING),'');assert.equal(target.get(LOAD),'');assert.equal(target.get(DONE),'no');
});
test('guestSnapshot preserves account calendar tombstones and includes only missing live dates',()=>{
  const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);
  guest.set(ROTATION,rotation([session('2020-10-19','a'),session('2020-10-21','b')],[],'c'));
  target.set(ROTATION,rotation([session('2020-10-19','a')],[],'b'));target.set(ROTATION,rotation([],[],'a'));
  assert.deepEqual(target.guestSnapshot().states.filter(x=>x.kind==='calendar').map(x=>x.key),['2020-10-21']);
});
test('guestSnapshot rejects unreadable guest or account history/calendar before any write',()=>{
  for(const [side,key]of [['guest',HISTORY],['guest',ROTATION],['target',HISTORY],['target',ROTATION]]){
    const storage=new MemoryStorage(),guest=create(storage),target=create(storage,A);(side==='guest'?guest:target).set(key,'{corrupt');
    const before=[...storage.data.entries()];assert.equal(typeof target.guestSnapshot,'function');assert.throws(()=>target.guestSnapshot());assert.deepEqual([...storage.data.entries()],before);
  }
});
test('guestSnapshot rejects 10000 saved weights plus a new pending weight without changing either scope',()=>{
  const history=Array.from({length:10000},(_,index)=>entry('saved-'+index));
  const prefix='gym-account.v2|guest|',storage=new MemoryStorage({[prefix+HISTORY]:JSON.stringify(history),[prefix+PENDING]:JSON.stringify({chest:entry('one-more-draft')})});
  const target=create(storage,A),before=[...storage.data.entries()],versions=target.stateEntries();
  assert.throws(()=>target.guestSnapshot(),/Too many weight records/);
  assert.deepEqual([...storage.data.entries()],before);assert.deepEqual(target.stateEntries(),versions);assert.equal(target.get(HISTORY),null);
  assert.equal(JSON.parse(storage.getItem(prefix+HISTORY)).length,10000);assert.equal(JSON.parse(storage.getItem(prefix+PENDING)).chest.id,'one-more-draft');
});
console.log(results.filter(r=>r.pass).length+'/'+results.length+' account-store tests passed');
if(results.some(r=>!r.pass))process.exitCode=1;

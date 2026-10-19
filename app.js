
(function () {
  'use strict';
    function initWeightHistory(read, write, loads, localDay) {
    var names = {pulldown:'高位下拉',row:'坐姿划船',chest:'胸推',triceps:'三头肌',abs:'腹肌训练',legpress:'腿推',glute:'臀推',legcurl:'腿弯举',abductor:'髋外展'};
    var historyKey = 'gym-compatible.history.v1';
    var pendingKey = 'gym-compatible.pending.v1';
    var raw = read(historyKey), entries = [], locked = false, timers = {}, pending = {};
    var message = document.getElementById('historyStatus');
    var filter = document.getElementById('historyFilter');
    var rows = document.getElementById('historyRows');
    function valid(entry) {
      if (!entry || !Object.prototype.hasOwnProperty.call(names,entry.exercise) || typeof entry.id !== 'string' || entry.id.length>120) return false;
      if (typeof entry.kg !== 'number' || !Number.isFinite(entry.kg) || entry.kg<0 || entry.kg%0.5!==0) return false;
      if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
      var date = new Date(entry.date+'T00:00:00Z');
      return !isNaN(date) && date.toISOString().slice(0,10)===entry.date && typeof entry.at==='string' && !isNaN(Date.parse(entry.at)) && typeof entry.time==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time);
    }
    try {
      if (raw) { entries = JSON.parse(raw); if (!Array.isArray(entries) || !entries.every(valid)) throw new Error('Invalid history'); }
    } catch(error) { entries=[]; locked=true; }
    function render() {
      rows.replaceChildren();
      var shown = entries.filter(function(e){return !filter.value || e.exercise===filter.value;}).slice().sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);});
      // Render the recent 100 entries; exports always include the complete history.
      shown.slice(0,100).forEach(function(entry){
        var row = document.createElement('tr');
        [entry.date+' '+entry.time,names[entry.exercise],entry.kg+' kg'].forEach(function(value){var cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);});
        rows.appendChild(row);
      });
      document.getElementById('historyEmpty').hidden=shown.length>0;
      message.textContent=locked ? '历史数据暂时无法读取，已保留原数据。请先导出备份；导入有效备份可恢复记录功能。' : '共 '+entries.length+' 条记录'+(shown.length>100?'；当前显示最近 100 条，完整历史可导出。':'。');
      for(var i=0;i<loads.length;i++) {
        var field=loads[i], key=field.getAttribute('data-key');
        var latest=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];
        var hint=field.closest('.finish-row').querySelector('.weight-saved');
        hint.textContent=latest ? '最近记录：'+latest.date+' '+latest.time+' · '+latest.kg+' kg' : '填写后自动保存日期和重量';
      }
    }
    Object.keys(names).forEach(function(key){var option=document.createElement('option');option.value=key;option.textContent=names[key];filter.appendChild(option);});
    filter.disabled=false;filter.addEventListener('change',render);
    for(var i=0;i<loads.length;i++) {
      var hint=document.createElement('p');hint.className='weight-saved';loads[i].closest('.finish-row').appendChild(hint);
    }
    function storePending(){write(pendingKey,JSON.stringify(pending));}
    var listeners=[];
    function notify(){listeners.forEach(function(fn){fn();});}
    function refreshWeights(changed){
      changed.forEach(function(key){
        var latest=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];
        if(latest){write('gym-compatible.load.'+key,String(latest.kg));for(var i=0;i<loads.length;i++)if(loads[i].getAttribute('data-key')===key && document.activeElement!==loads[i])loads[i].value=latest.kg;}
      });
    }
    function commit(key) {
      window.clearTimeout(timers[key]);
      var entry=pending[key]; if(!entry) return;
      if(locked) return;
      var last=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];
      if (!last || last.date!==entry.date || last.kg!==entry.kg) {
        entries.push(entry);write(historyKey,JSON.stringify(entries));
      }
      delete pending[key];storePending();render();notify();
    }
    function flush(){Object.keys(pending).forEach(commit);}
    try { var saved=JSON.parse(read(pendingKey)||'{}');Object.keys(saved).forEach(function(key){if(valid(saved[key]) && saved[key].exercise===key) pending[key]=saved[key];});flush(); } catch(error) { /* A malformed draft cannot disable existing history. */ }
    function queue(field) {
      var key=field.getAttribute('data-key');window.clearTimeout(timers[key]);
      if(!field.validity.valid || field.value===''){delete pending[key];storePending();return;}
      var now=new Date();
      pending[key]={id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),exercise:key,kg:Number(field.value),date:localDay(),time:('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2),at:now.toISOString()};
      // Persist the draft immediately so closing or reloading before debounce cannot lose it.
      storePending();timers[key]=window.setTimeout(function(){commit(key);},1000);
    }
    for(var j=0;j<loads.length;j++){
      loads[j].addEventListener('input',function(){queue(this);});
      loads[j].addEventListener('blur',function(){commit(this.getAttribute('data-key'));});
    }
    window.addEventListener('pagehide',flush);
    document.addEventListener('visibilitychange',function(){if(document.hidden)flush();});
    function download(content,type,extension){
      var url=URL.createObjectURL(new Blob([content],{type:type}));var link=document.createElement('a');link.href=url;link.download='浅草训练记录-'+localDay()+extension;document.body.appendChild(link);link.click();link.remove();window.setTimeout(function(){URL.revokeObjectURL(url);},30000);
    }
    var exportButton=document.getElementById('exportHistory');exportButton.disabled=false;
    exportButton.addEventListener('click',function(){
      flush();var latest={};Object.keys(names).forEach(function(key){var value=read('gym-compatible.load.'+key);if(value!==null)latest[key]=value;});
      download(JSON.stringify({app:'asakusa-fitness',version:1,exportedAt:new Date().toISOString(),entries:entries,latest:latest,unreadableHistory:locked?raw:null},null,2),'application/json;charset=utf-8','.json');
    });
    var csvButton=document.getElementById('exportCsv');csvButton.disabled=false;
    csvButton.addEventListener('click',function(){flush();var lines=['日期,时间,器械,重量(kg)'];entries.slice().sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);}).forEach(function(e){lines.push([e.date,e.time,names[e.exercise],e.kg].join(','));});download('\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8','.csv');});
    var importer=document.getElementById('importHistory');importer.disabled=false;
    importer.addEventListener('change',function(){
      var file=this.files[0];if(!file)return;
      if(file.size>5000000){message.textContent='备份过大，请选择 5 MB 以内的 JSON 备份。';this.value='';return;}
      var reader=new FileReader();
      reader.onload=function(){
        try {
          var data=JSON.parse(reader.result);
          if(data.app!=='asakusa-fitness'||data.version!==1||!Array.isArray(data.entries)||data.entries.length>10000||!data.entries.every(valid))throw new Error('Invalid backup');
          var latest=data.latest||{};
          Object.keys(latest).forEach(function(key){var value=latest[key];if(!Object.prototype.hasOwnProperty.call(names,key)||typeof value!=='string'||(value!==''&&(!/^\d+(\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)%0.5!==0)))throw new Error('Invalid weight');});
          flush();var ids=new Set(entries.map(function(e){return e.id;})),added=0;
          data.entries.forEach(function(entry){if(!ids.has(entry.id)){entries.push({id:entry.id,exercise:entry.exercise,kg:entry.kg,date:entry.date,time:entry.time,at:entry.at});ids.add(entry.id);added++;}});
          if(locked&&raw)write(historyKey+'.recovery',raw);
          locked=false;write(historyKey,JSON.stringify(entries));
          Object.keys(names).forEach(function(key){
            var newest=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];
            var value=newest?String(newest.kg):Object.prototype.hasOwnProperty.call(latest,key)?latest[key]:null;
            if(value!==null){write('gym-compatible.load.'+key,value);for(var n=0;n<loads.length;n++)if(loads[n].getAttribute('data-key')===key)loads[n].value=value;}
          });
          render();notify();message.textContent='已导入 '+added+' 条新记录；重复备份不会重复添加。';
        } catch(error){message.textContent='导入失败：备份格式或记录内容无效，原有记录未被更改。';}
        importer.value='';
      };
      reader.onerror=function(){message.textContent='无法读取文件，请重新选择备份。';importer.value='';};reader.readAsText(file);
    });
    render();
    return {
      flush:flush,
      getEntries:function(){return entries.map(function(e){return Object.assign({},e);});},
      subscribe:function(fn){listeners.push(fn);},
      merge:function(incoming){
        if(locked)throw new Error('本机历史无法读取，请先导出备份并恢复。');
        if(!Array.isArray(incoming)||!incoming.every(valid))throw new Error('云端记录格式无效。');
        var before={};Object.keys(names).forEach(function(key){var last=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];before[key]=last&&last.id;});
        var ids=new Set(entries.map(function(e){return e.id;}));
        incoming.forEach(function(e){if(!ids.has(e.id)){entries.push({id:e.id,exercise:e.exercise,kg:e.kg,date:e.date,time:e.time,at:e.at});ids.add(e.id);}});
        var changed=Object.keys(names).filter(function(key){var last=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];return last&&last.id!==before[key];});
        write(historyKey,JSON.stringify(entries));refreshWeights(changed);render();
      }
    };
  }

    function initCloudSync(history,read,write){
    var status=document.getElementById('syncStatus'),form=document.getElementById('syncLogin');
    var email=document.getElementById('syncEmail'),code=document.getElementById('syncCode');
    var send=document.getElementById('syncSend'),verify=document.getElementById('syncVerify');
    var manual=document.getElementById('syncNow'),logout=document.getElementById('syncLogout');
    var account=document.getElementById('syncAccount'),client=null,user=null,busy=false,rerun=false,timer=null,epoch=0;
    var ownerKey='gym-compatible.sync-owner.v1';
    function say(text){status.textContent=text;}
    if(!window.supabase || !window.GYM_CLOUD || !window.GYM_CLOUD.url || !window.GYM_CLOUD.key){say('同步服务暂未连接；当前仍自动保存到本机，可导出备份。');return;}
    try{client=window.supabase.createClient(window.GYM_CLOUD.url,window.GYM_CLOUD.key);}catch(error){say('同步服务加载失败；本机记录仍可使用。');return;}
    send.disabled=false;email.disabled=false;
    function connected(session){
      var next=session&&session.user;
      if((user&&user.id)!==(next&&next.id))epoch++;
      user=next||null;form.hidden=!!user;logout.hidden=!user;manual.disabled=!user;
      account.textContent=user?'已登录：'+user.email:'';
      if(user){say('已登录，正在连接你的记录…');window.setTimeout(sync,0);}
      else say('尚未登录：重量保存在本机。手机和电脑登录同一个邮箱后自动同步。');
    }
    async function sync(){
      if(!user)return;
      if(busy){rerun=true;return;}
      if(!navigator.onLine){say('当前离线：记录已保存在本机，联网后自动补传。');return;}
      var owner=read(ownerKey);
      if(owner&&owner!==user.id){say('此浏览器已有另一个账号的记录。为避免混合，请退出并登录原账号，或在另一个浏览器使用新账号。');return;}
      write(ownerKey,user.id);
      busy=true;var generation=epoch,currentUser=user.id;
      function current(){return generation===epoch&&user&&user.id===currentUser;}
      say('正在同步日期和重量…');
      try{
        history.flush();var cloud=[],offset=0;
        while(true){
          var result=await client.from('weight_entries').select('id,exercise,kg,date,time,at').eq('user_id',currentUser).order('at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+999);
          if(!current())return;
          if(result.error)throw result.error;
          cloud=cloud.concat(result.data);if(result.data.length<1000)break;offset+=1000;
        }
        var ids=new Set(cloud.map(function(e){return e.id;}));
        var missing=history.getEntries().filter(function(e){return !ids.has(e.id);});
        for(var start=0;start<missing.length;start+=100){
          if(!current())return;
          var batch=missing.slice(start,start+100).map(function(e){return {user_id:currentUser,id:e.id,exercise:e.exercise,kg:e.kg,date:e.date,time:e.time,at:e.at};});
          var uploaded=await client.from('weight_entries').upsert(batch,{onConflict:'user_id,id',ignoreDuplicates:true});
          if(!current())return;if(uploaded.error)throw uploaded.error;
        }
        history.flush();history.merge(cloud);
        say('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+history.getEntries().length+' 条重量记录，仅此账号可见。');
      }catch(error){if(current())say('同步暂未成功，本机记录已保留。请检查网络后点“立即同步”。'+(error&&error.message?' '+error.message:''));}
      finally{busy=false;if(rerun){rerun=false;window.clearTimeout(timer);timer=window.setTimeout(sync,1500);}}
    }
    history.subscribe(function(){if(user&&!busy){window.clearTimeout(timer);timer=window.setTimeout(sync,1500);}else if(user)rerun=true;});
    form.addEventListener('submit',function(event){event.preventDefault();});
    send.addEventListener('click',async function(){
      if(!email.reportValidity()||!email.value.trim())return;
      send.disabled=true;say('正在发送登录验证码…');
      try{
        var result=await client.auth.signInWithOtp({email:email.value.trim(),options:{shouldCreateUser:true}});
        if(result.error)throw result.error;
        code.disabled=false;verify.disabled=false;say('验证码已发送。请在邮箱查收，并在本页输入验证码；手机和电脑使用同一个邮箱。');code.focus();
        window.setTimeout(function(){send.disabled=false;},60000);
      }catch(error){send.disabled=false;say('验证码发送失败：'+error.message);}
    });
    verify.addEventListener('click',async function(){
      if(!email.reportValidity()||!code.reportValidity()||!code.value.trim())return;
      verify.disabled=true;
      try{var result=await client.auth.verifyOtp({email:email.value.trim(),token:code.value.trim(),type:'email'});if(result.error)throw result.error;code.value='';connected(result.data.session);}
      catch(error){say('登录未成功：'+error.message);verify.disabled=false;}
    });
    logout.addEventListener('click',async function(){
      epoch++;user=null;window.clearTimeout(timer);
      try{await client.auth.signOut({scope:'local'});}catch(error){/* Local logout must remain available offline. */}
      connected(null);say('已退出同步账号。本机仍保留已有记录；请勿在共用设备上保存私人记录。');
    });
    manual.addEventListener('click',sync);
    client.auth.onAuthStateChange(function(event,session){window.setTimeout(function(){connected(session);},0);});
    client.auth.getSession().then(function(result){if(result.error)throw result.error;connected(result.data.session);}).catch(function(){say('登录状态读取失败，请刷新页面；本机记录仍可使用。');});
    window.addEventListener('online',sync);window.addEventListener('focus',sync);
    document.addEventListener('visibilitychange',function(){if(!document.hidden)sync();});
    window.setInterval(function(){if(!document.hidden)sync();},30000);
  }

  // Keep native <details> working independently of script and storage.
  var status = document.getElementById('storageStatus');
  var memory = Object.create(null);
  var volatile = false;
  function storageMessage() {
    status.textContent = volatile
      ? '当前无法保存到浏览器；本页可继续打卡和填写重量，关闭或刷新后临时记录会丢失。'
      : '记录自动保存在当前浏览器。更换浏览器、网页地址或清理网站数据后，记录不会同步。';
  }
  function read(key) {
    if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
    try { var value = window.localStorage.getItem(key); memory[key] = value; return value; }
    catch (error) { volatile = true; storageMessage(); return null; }
  }
  function write(key, value) {
    memory[key] = value;
    try { window.localStorage.setItem(key, value); }
    catch (error) { volatile = true; storageMessage(); }
  }
  function localDay() {
    var now = new Date();
    return now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  }
  var done = document.querySelectorAll('input.done');
  var loads = document.querySelectorAll('input.load');
  var day = localDay();
  function doneKey(el) { return 'gym-compatible.done.' + day + '.' + el.getAttribute('data-key'); }
  function updateDay() {
    day = localDay();
    for (var i = 0; i < done.length; i++) done[i].checked = read(doneKey(done[i])) === 'yes';
    document.getElementById('recordDate').textContent = day + ' 的训练打卡';
  }
  function ensureDay() { if (day !== localDay()) updateDay(); }
  updateDay();
  for (var i = 0; i < done.length; i++) {
    done[i].disabled = false;
    done[i].addEventListener('change', function () {
      var checked = this.checked;
      ensureDay();
      this.checked = checked;
      write(doneKey(this), checked ? 'yes' : 'no');
    });
  }
  for (var j = 0; j < loads.length; j++) {
    loads[j].disabled = false;
    var storedWeight = read('gym-compatible.load.' + loads[j].getAttribute('data-key'));
    loads[j].value = storedWeight === null ? (loads[j].getAttribute('data-default-weight') || '') : storedWeight;
    loads[j].addEventListener('input', function () {
      var value = this.value;
      if (!this.validity.valid) {
        this.setAttribute('aria-invalid', 'true');
        document.getElementById('weightStatus').textContent = '重量请输入不小于 0、以 0.5 kg 为步进的数字；无效数值不会保存。';
        return;
      }
      this.removeAttribute('aria-invalid');
      document.getElementById('weightStatus').textContent = '';
      var key = this.getAttribute('data-key');
      write('gym-compatible.load.' + key, value);
      for (var n = 0; n < loads.length; n++) {
        if (loads[n].getAttribute('data-key') === key && loads[n] !== this) {
          loads[n].value = value;
          loads[n].removeAttribute('aria-invalid');
        }
      }
    });
  }
  var historyApi=initWeightHistory(read, write, loads, localDay);
  if(document.getElementById('syncStatus'))initCloudSync(historyApi,read,write);
  // Probe write access separately. Read failures must never prevent timer setup.
  try { window.localStorage.setItem('__gym_test', '1'); window.localStorage.removeItem('__gym_test'); }
  catch (error) { volatile = true; }
  storageMessage();

  var segments = [
    { name: '热身', grade: 3, speed: 4, seconds: 360 },
    { name: '上坡①', grade: 7, speed: 5, seconds: 360 },
    { name: '上坡②', grade: 5, speed: 6, seconds: 600 },
    { name: '上坡③', grade: 10, speed: 4.5, seconds: 240 },
    { name: '放松', grade: 0, speed: 3.5, seconds: 240 }
  ];
  var total = 1800000;
  var elapsed = 0;
  var running = false;
  var deadline = 0;
  var interval = null;
  var play = document.getElementById('play');
  var next = document.getElementById('next');
  var reset = document.getElementById('reset');
  var timerLabel = document.getElementById('timerLabel');
  function format(seconds) { return ('0' + Math.floor(seconds / 60)).slice(-2) + ':' + ('0' + (seconds % 60)).slice(-2); }
  function sample() { if (running) elapsed = Math.min(total, Math.max(0, total - (deadline - Date.now()))); }
  function stage() {
    var end = 0;
    for (var index = 0; index < segments.length; index++) {
      end += segments[index].seconds * 1000;
      if (elapsed < end) return { index: index, end: end };
    }
    return { index: 4, end: total };
  }
  function clearTicker() { if (interval !== null) window.clearInterval(interval); interval = null; }
  function render() {
    var complete = elapsed >= total;
    if (complete) { running = false; clearTicker(); }
    var current = stage();
    var item = segments[current.index];
    var label = complete ? '30分钟爬坡已完成' : '第' + (current.index + 1) + '/5段 · ' + item.name + ' · 坡度' + item.grade + ' / 速度' + item.speed + ' km/h';
    if (timerLabel.textContent !== label) timerLabel.textContent = label;
    document.getElementById('clock').textContent = format(complete ? 0 : Math.ceil((current.end - elapsed) / 1000));
    document.getElementById('totalClock').textContent = '总剩余 ' + format(Math.ceil((total - elapsed) / 1000)) + ' / 30:00';
    play.textContent = complete ? '已完成' : running ? '❚❚ 暂停' : elapsed > 0 ? '▶ 继续' : '▶ 开始';
    play.disabled = complete;
    next.disabled = complete;
    reset.disabled = false;
  }
  function tick() { sample(); render(); }
  play.addEventListener('click', function () {
    sample();
    if (running) { running = false; clearTicker(); }
    else if (elapsed < total) { running = true; deadline = Date.now() + total - elapsed; interval = window.setInterval(tick, 250); }
    render();
  });
  next.addEventListener('click', function () {
    sample();
    if (elapsed < total) elapsed = stage().end;
    if (running) deadline = Date.now() + total - elapsed;
    render();
  });
  reset.addEventListener('click', function () { clearTicker(); running = false; elapsed = 0; render(); });
  document.addEventListener('visibilitychange', function () { ensureDay(); tick(); });
  window.addEventListener('pageshow', function () { ensureDay(); tick(); });
  window.addEventListener('focus', ensureDay);
  window.setInterval(ensureDay, 30000);
  render();
  document.getElementById('runtimeStatus').textContent = '交互已启用：点器械图片或名称可展开／收起；打卡、重量与爬坡计时可用。';
  document.getElementById('runtimeStatus').className = 'runtime-ready';
})();


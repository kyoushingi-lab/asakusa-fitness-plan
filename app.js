
(async function () {
  'use strict';
  var fields={pulldown:['position'],row:['fore_aft','height'],chest:['seat'],triceps:['seat','adjustment'],abs:['height'],glute:['position'],legpress:['position'],legcurl:['roller','start'],abductor:['position']};
  var seedSettings={},settingInputs=[];
  document.querySelectorAll('[data-machine-profile]').forEach(function(profile,index){
    var machine=profile.dataset.machineProfile,box=profile.querySelector('.fixed-settings');
    var editor=document.createElement('details');editor.className='setting-editor';
    var summary=document.createElement('summary');summary.textContent='修改我的设置';editor.appendChild(summary);
    box.querySelectorAll('dl>div').forEach(function(row,position){
      var key=machine+'.'+fields[machine][position],dd=row.querySelector('dd'),value=dd.textContent.trim();
      if(value!=='待记录')seedSettings['gym-compatible.setting.'+key]=value;
      dd.dataset.settingValue=key;
      var label=document.createElement('label'),input=document.createElement('input');
      label.textContent=row.querySelector('dt').textContent;input.type='text';input.maxLength=80;input.placeholder='待记录';input.autocomplete='off';input.dataset.setting=key;
      input.id='setting-'+index+'-'+position;label.htmlFor=input.id;label.appendChild(input);editor.appendChild(label);settingInputs.push(input);
    });box.appendChild(editor);
  });
  var account=await window.GymAccounts.open({seedSettings:seedSettings}),accountStore=account.store;
  if(!account.isCurrent())return;

    function initWeightHistory(read, write, loads, localDay) {
    var names = {pulldown:'高位下拉',row:'坐姿划船',chest:'坐姿胸推',triceps:'三头肌训练机',abs:'腹肌训练机',legpress:'腿举机',glute:'臀部训练机',legcurl:'卧姿腿弯举',abductor:'髋外展机'};
    var historyKey = 'gym-compatible.history.v1';
    var pendingKey = 'gym-compatible.pending.v1';
    var raw = read(historyKey), entries = [], locked = false, timers = {}, pending = {};
    var message = document.getElementById('historyStatus');
    var filter = document.getElementById('historyFilter');
    var rows = document.getElementById('historyRows');
    function valid(entry) {
      if (!entry || !Object.prototype.hasOwnProperty.call(names,entry.exercise) || typeof entry.id !== 'string' || entry.id.length>120) return false;
      if (typeof entry.kg !== 'number' || !Number.isFinite(entry.kg) || entry.kg<0 || entry.kg>9999) return false;
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
        [entry.date+' '+(entry.id.indexOf('date-only:')===0?'时间未记录':entry.time),names[entry.exercise],entry.kg+' kg'].forEach(function(value){var cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);});
        rows.appendChild(row);
      });
      document.getElementById('historyEmpty').hidden=shown.length>0;
      message.textContent=locked ? '历史数据暂时无法读取，已保留原数据。请先导出备份；导入有效备份可恢复记录功能。' : '共 '+entries.length+' 条记录'+(shown.length>100?'；当前显示最近 100 条，完整历史可导出。':'。');
      for(var i=0;i<loads.length;i++) {
        var field=loads[i], key=field.getAttribute('data-key');
        var latest=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];
        var hint=field.closest('.finish-row').querySelector('.weight-saved');
        document.querySelectorAll('[data-last-weight="'+key+'"]').forEach(function(el){el.textContent=latest?latest.kg+' kg':'待记录';});
        document.querySelectorAll('[data-last-date="'+key+'"]').forEach(function(el){el.textContent=latest?latest.date:'待记录';});
        hint.textContent=latest ? '最近记录：'+latest.date+' '+(latest.id.indexOf('date-only:')===0?'时间未记录':latest.time)+' · '+latest.kg+' kg' : '填写后自动保存日期和重量';
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
    csvButton.addEventListener('click',function(){flush();var lines=['日期,时间,器械,重量(kg)'];entries.slice().sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);}).forEach(function(e){lines.push([e.date,e.id.indexOf('date-only:')===0?'':e.time,names[e.exercise],e.kg].join(','));});download('\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8','.csv');});
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
          Object.keys(latest).forEach(function(key){var value=latest[key];if(!Object.prototype.hasOwnProperty.call(names,key)||typeof value!=='string'||(value!==''&&(!/^\d+(\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)>9999)))throw new Error('Invalid weight');});
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
      refreshFromStore:function(){
        try{var saved=JSON.parse(read(historyKey)||'[]');if(!Array.isArray(saved)||!saved.every(valid))throw Error('Invalid history');entries=saved;locked=false;}catch(error){locked=true;}
        render();
      },
      getEntries:function(){return entries.map(function(e){return Object.assign({},e);});},
      subscribe:function(fn){listeners.push(fn);return function(){listeners=listeners.filter(function(old){return old!==fn;});};},
      merge:function(incoming,imported){
        if(locked)throw new Error('本机历史无法读取，请先导出备份并恢复。');
        if(!Array.isArray(incoming)||!incoming.every(valid))throw new Error('云端记录格式无效。');
        var before={};Object.keys(names).forEach(function(key){var last=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];before[key]=last&&last.id;});
        var ids=new Set(entries.map(function(e){return e.id;}));
        incoming.forEach(function(e){if(!ids.has(e.id)){entries.push({id:e.id,exercise:e.exercise,kg:e.kg,date:e.date,time:e.time,at:e.at});ids.add(e.id);}});
        var changed=Object.keys(names).filter(function(key){var last=entries.filter(function(e){return e.exercise===key;}).sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);})[0];return last&&last.id!==before[key];});
        write(historyKey,JSON.stringify(entries));refreshWeights(changed);render();if(imported)notify();
      }
    };
  }

  function initPersonalImport(history,schedule,read,write,localDay){
    var input=document.getElementById('importWorkout'),apply=document.getElementById('applyWorkoutImport'),preview=document.getElementById('workoutImportPreview'),status=document.getElementById('workoutImportStatus'),bundle=null;
    if(!input||!schedule)return;
    var names={pulldown:'高位下拉',row:'坐姿划船',chest:'胸推',triceps:'三头肌',abs:'腹肌机',glute:'臀部训练机',legpress:'腿举',legcurl:'卧姿腿弯举',abductor:'髋外展'};
    function dateOK(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;var d=new Date(s+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s&&s<=localDay();}
    function known(s){return Object.prototype.hasOwnProperty.call(names,s);}
    input.disabled=false;
    input.addEventListener('change',function(){
      bundle=null;apply.hidden=true;preview.textContent='';var file=input.files[0];if(!file)return;
      if(file.size>5000000){status.textContent='文件过大，请选择5 MB以内的档案。';return;}
      var reader=new FileReader();reader.onload=function(){try{
        var data=JSON.parse(reader.result);
        if(data.app!=='asakusa-personal-profile'||data.version!==1||!Array.isArray(data.entries)||data.entries.length>10000||!Array.isArray(data.sessions)||data.sessions.length>10000)throw Error('Invalid file');
        if(!data.entries.every(function(e){return e&&known(e.exercise)&&typeof e.id==='string'&&e.id.length>0&&e.id.length<=120&&typeof e.kg==='number'&&Number.isFinite(e.kg)&&e.kg>=0&&e.kg<=9999&&dateOK(e.date)&&typeof e.at==='string'&&!isNaN(Date.parse(e.at))&&typeof e.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time);}))throw Error('Invalid weights');
        if(!data.sessions.every(function(s){return s&&dateOK(s.date)&&/^[abc]$/.test(s.plan)&&Array.isArray(s.completed)&&s.completed.every(known)&&s.skipped&&typeof s.skipped==='object'&&!Array.isArray(s.skipped)&&Object.keys(s.skipped).every(function(k){return known(k)&&typeof s.skipped[k]==='string'&&s.skipped[k].length<=200&&s.completed.indexOf(k)===-1;});})||new Set(data.sessions.map(function(s){return s.date;})).size!==data.sessions.length)throw Error('Invalid sessions');
        if(!schedule.canImport())throw Error('Schedule unreadable');
        bundle=data;preview.textContent=data.sessions.map(function(s){return s.date+' · '+s.plan.toUpperCase()+' · 完成'+s.completed.length+'项'+(Object.keys(s.skipped).length?'（含跳过动作说明）':'');}).join('；')+'。重量记录 '+data.entries.length+' 条。同日期训练将以档案为准，其余记录保留。';apply.hidden=false;apply.disabled=false;status.textContent='档案已读取，确认后导入。';
      }catch(e){status.textContent='无法导入：档案无效或本机日历不可读；原有记录未改变。';}};
      reader.onerror=function(){status.textContent='文件无法读取，请重试。';};reader.readAsText(file);
    });
    apply.addEventListener('click',function(){if(!bundle)return;try{
      // Validate everything before the first mutation. History remains append-only.
      if(!schedule.canImport())throw Error('Schedule unreadable');
      history.merge(bundle.entries,true);schedule.importSessions(bundle.sessions);
      bundle.sessions.forEach(function(s){var prefix={a:'mon',b:'wed',c:'fri'}[s.plan];s.completed.forEach(function(k){write('gym-compatible.done.'+s.date+'.'+prefix+'-'+k,'yes');});Object.keys(s.skipped).forEach(function(k){write('gym-compatible.done.'+s.date+'.'+prefix+'-'+k,'no');});});
      window.dispatchEvent(new Event('gym-checkins-imported'));status.textContent=document.getElementById('syncStatus')?'已导入训练日期与重量。重量沿用账号同步；训练完成情况保存在本机。':'已导入训练日期与重量，保存在当前浏览器。';apply.hidden=true;bundle=null;input.value='';
    }catch(e){status.textContent='导入未完成：请先导出本机备份，检查历史数据后重试。';}});
  }

    function initFlexibleSchedule(read, write, localDay) {
    var select=document.getElementById('cycleNext');if(!select)return;
    var key='gym-compatible.rotation.v1',state={version:1,next:'a',sessions:[],busy:[]},locked=false;
    var plans={a:{name:'背＋手臂＋腹',anchor:'mon'},b:{name:'臀腿＋腹',anchor:'wed'},c:{name:'背＋臀综合',anchor:'fri'}};
    var dateInput=document.getElementById('cycleDate'),complete=document.getElementById('cycleComplete');
    var edit=document.getElementById('cycleEdit'),remove=document.getElementById('cycleUndo'),cancel=document.getElementById('cycleCancel');
    var busy=document.getElementById('busyToggle'),restore=document.getElementById('cycleRestore'),status=document.getElementById('cycleStatus');
    var selectedDay=localDay(),selectedPlan='a',editing=false,shownDay=localDay(),lastState=null;
    function validDate(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;var p=new Date(d+'T00:00:00Z');return !isNaN(p)&&p.toISOString().slice(0,10)===d;}
    function dayString(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
    function monday(d){var p=new Date(d+'T12:00:00');p.setDate(p.getDate()-(p.getDay()+6)%7);return dayString(p);}
    function offset(d,n){var p=new Date(d+'T12:00:00');p.setDate(p.getDate()+n);return dayString(p);}
    function next(plan){return{a:'b',b:'c',c:'a'}[plan];}
    function session(d){return state.sessions.find(function(s){return s.date===d;});}
    function ordered(){return state.sessions.slice().sort(function(a,b){return a.date.localeCompare(b.date);});}
    try{
      var raw=read(key);
      if(raw){var saved=JSON.parse(raw);
        if(!saved||saved.version!==1||!Object.prototype.hasOwnProperty.call(plans,saved.next)||!Array.isArray(saved.sessions)||!Array.isArray(saved.busy)||saved.sessions.length>10000||saved.busy.length>10000)throw new Error('Invalid schedule');
        if(!saved.sessions.every(function(s){return s&&validDate(s.date)&&Object.prototype.hasOwnProperty.call(plans,s.plan)&&typeof s.at==='string'&&!isNaN(Date.parse(s.at));})||!saved.busy.every(validDate))throw new Error('Invalid entries');
        if(new Set(saved.sessions.map(function(s){return s.date;})).size!==saved.sessions.length)throw new Error('Repeated day');
        state={version:1,next:saved.next,sessions:saved.sessions.map(function(s){return{date:s.date,plan:s.plan,at:s.at,completed:Array.isArray(s.completed)?s.completed:[],skipped:s.skipped&&typeof s.skipped==='object'?s.skipped:{}};}),busy:Array.from(new Set(saved.busy))};
      }
    }catch(error){locked=true;}
    selectedPlan=state.next;var week=monday(selectedDay);
    function text(el,value){if(el.textContent!==value)el.textContent=value;}
    function remember(){lastState=JSON.stringify(state);}
    function save(){if(!locked)write(key,JSON.stringify(state));}
    function recalculate(fallback){var items=ordered();state.next=items.length?next(items[items.length-1].plan):fallback;}
    function chooseDay(d){selectedDay=d;editing=false;selectedPlan=state.next;if(validDate(d))week=monday(d);render();}
    function chooseAnotherDay(){selectedDay='';selectedPlan=state.next;editing=false;render();dateInput.focus();status.textContent='请选择 '+state.next.toUpperCase()+' 实际完成的日期。还没训练时，可以先查看动作，在训练当天回来记录。';}
    function beginEdit(d){var found=session(d);if(!found||locked)return;selectedDay=d;selectedPlan=found.plan;week=monday(d);editing=true;render();dateInput.focus();}
    function calendar(){
      var grid=document.getElementById('cycleCalendar');grid.replaceChildren();
      text(document.getElementById('cycleWeekTitle'),week+' 至 '+offset(week,6)+' · 点日期查看或记录');
      for(var i=0;i<7;i++){
        var d=offset(week,i),s=session(d),isBusy=state.busy.indexOf(d)!==-1,button=document.createElement('button');
        button.type='button';button.dataset.date=d;button.disabled=locked;
        button.className=(d===selectedDay?'is-selected ':'')+(d===localDay()?'is-today ':'')+(s?'has-session ':isBusy?'is-busy ':'');
        button.setAttribute('aria-pressed',String(d===selectedDay));button.setAttribute('aria-label',d+' '+(s?s.plan.toUpperCase()+'已完成':isBusy?'忙碌':'未记录'));
        var day=document.createElement('small'),num=document.createElement('strong'),mark=document.createElement('span');
        day.textContent=['一','二','三','四','五','六','日'][i];num.textContent=String(Number(d.slice(-2)));mark.textContent=s?s.plan.toUpperCase()+'完成':isBusy?'忙碌':d===localDay()?'今天':'—';
        button.appendChild(day);button.appendChild(num);button.appendChild(mark);
        button.addEventListener('click',function(){chooseDay(this.dataset.date);});grid.appendChild(button);
      }
    }
    function render(){
      var today=localDay(),entry=session(selectedDay),isBusy=state.busy.indexOf(selectedDay)!==-1,future=validDate(selectedDay)&&selectedDay>today;
      dateInput.value=selectedDay;dateInput.disabled=locked;select.value=selectedPlan;select.disabled=locked;
      text(document.getElementById('cycleRecommendation'),'下一次：'+state.next.toUpperCase()+' · '+plans[state.next].name);
      text(document.getElementById('cycleCompactNext'),'下一次：'+state.next.toUpperCase()+' · '+plans[state.next].name);
      document.querySelectorAll('#cycleTrack button').forEach(function(button){var p=button.dataset.plan;button.disabled=locked;button.className=(p===state.next?'is-next ':'')+(p===selectedPlan?'is-selected':'');button.setAttribute('aria-pressed',String(p===selectedPlan));var last=ordered().filter(function(s){return s.plan===p;}).pop();text(button.querySelector('.cycle-plan-state'),p===state.next?'下一次':last?'最近 '+last.date.slice(5):'尚未记录');});
      var go=document.getElementById('cycleGo');go.href='#'+plans[selectedPlan].anchor;text(go,'查看 '+selectedPlan.toUpperCase()+' 的动作 ↓');
      var hint=document.getElementById('cycleSelectedStatus');
      text(hint,entry&&!editing?selectedDay+' 已完成 '+entry.plan.toUpperCase()+'。下一次练 '+state.next.toUpperCase()+'：训练当天选择当天日期，再点记录；也可补记过去的训练。':editing?'正在更正 '+selectedDay+' 的记录。保存后会更新日历；重量记录不会改变。':future?'这是未来日期，不能预记为完成。请在实际训练结束后记录；可以先标记忙碌日。':isBusy?'这天已标记忙碌。取消忙碌标记后才能记录训练。':selectedDay?'将记录 '+selectedDay+' 的 '+selectedPlan.toUpperCase()+' 训练。只记录实际完成的训练。':'请选择这次训练实际完成的日期，再记录 '+selectedPlan.toUpperCase()+'。');
      complete.disabled=locked||!validDate(selectedDay)||future||(isBusy&&!entry);
      text(complete,entry&&!editing?'为 '+state.next.toUpperCase()+' 选择训练日期':editing?'保存更正为 '+selectedPlan.toUpperCase():future?'未来日期不能记为完成':!selectedDay?'选择日期后记录 '+selectedPlan.toUpperCase():isBusy?'先取消这天的忙碌标记':'记录 '+selectedDay.slice(5)+' 的 '+selectedPlan.toUpperCase()+' 已完成');
      edit.hidden=!entry||editing;edit.disabled=locked;remove.hidden=!entry||!editing;remove.disabled=locked;cancel.hidden=!editing;cancel.disabled=locked;
      busy.disabled=locked||!validDate(selectedDay);text(busy,isBusy?'取消这天的忙碌标记':'标记这天忙碌');
      ['cyclePrevWeek','cycleNextWeek','cycleToday'].forEach(function(id){document.getElementById(id).disabled=locked;});
      restore.hidden=!lastState;restore.disabled=locked||!lastState;
      var count=state.sessions.filter(function(s){return s.date>=monday(today)&&s.date<=today;}).length;
      text(document.getElementById('cycleWeek'),'本周已完成 '+count+' 次；每周2次或3次都可以，下一周继续循环。');
      text(document.getElementById('cycleBusyList'),state.busy.length?'忙碌日：'+state.busy.slice().sort().slice(-30).join('、'):'暂无忙碌日记录。');
      var list=document.getElementById('cycleLog');list.replaceChildren();
      ordered().reverse().slice(0,12).forEach(function(s){var li=document.createElement('li'),button=document.createElement('button');li.textContent=s.date+' · '+s.plan.toUpperCase()+' · '+plans[s.plan].name;var skipped=s.skipped||{},labels={pulldown:'高位下拉',row:'划船',chest:'胸推',triceps:'三头肌',abs:'腹肌机',glute:'臀部机',legpress:'腿举',legcurl:'腿弯举',abductor:'髋外展'};if(Array.isArray(s.completed)&&s.completed.length)li.textContent+=' · '+s.completed.length+'项完成';Object.keys(skipped).forEach(function(k){li.textContent+=' · '+(labels[k]||k)+'跳过：'+String(skipped[k]).slice(0,200);});button.type='button';button.textContent='更正';button.dataset.date=s.date;button.disabled=locked;button.addEventListener('click',function(){beginEdit(this.dataset.date);});li.appendChild(button);list.appendChild(li);});
      if(!state.sessions.length){var li=document.createElement('li');li.textContent='尚未记录训练。';list.appendChild(li);}
      text(status,locked?'循环记录无法读取，已保留原数据；可继续查看A/B/C，重量与计时不受影响。':'日历和记录按实际训练日期保存；补记不会覆盖已有日期。器械打卡不自动推进循环。');calendar();
    }
    document.querySelectorAll('#cycleTrack button').forEach(function(button){button.addEventListener('click',function(){if(locked)return;selectedPlan=this.dataset.plan;render();});});
    select.addEventListener('change',function(){if(!locked){selectedPlan=select.value;render();}});
    function dateChanged(){if(dateInput.value!==selectedDay)chooseDay(dateInput.value);}
    // Input updates before a date field loses focus. The change handler is a
    // no-op for the same value, preserving the touched target in WebKit.
    dateInput.addEventListener('input',dateChanged);dateInput.addEventListener('change',dateChanged);
    complete.addEventListener('click',function(){
      if(locked)return;var entry=session(selectedDay);
      if(entry&&!editing){chooseAnotherDay();return;}
      if(!validDate(selectedDay)||selectedDay>localDay()||state.busy.indexOf(selectedDay)!==-1)return;
      remember();var recordedDate=selectedDay,recordedPlan=selectedPlan;
      if(entry){entry.plan=selectedPlan;}else state.sessions.push({date:selectedDay,plan:selectedPlan,at:new Date().toISOString()});
      recalculate(recordedPlan);save();editing=false;selectedPlan=state.next;render();text(status,'已记录 '+recordedDate+' 的 '+recordedPlan.toUpperCase()+'；下一次 '+state.next.toUpperCase()+'。');
    });
    edit.addEventListener('click',function(){beginEdit(selectedDay);});
    cancel.addEventListener('click',function(){editing=false;selectedPlan=state.next;render();});
    remove.addEventListener('click',function(){var entry=session(selectedDay);if(locked||!editing||!entry)return;remember();var previousPlan=entry.plan;state.sessions=state.sessions.filter(function(s){return s.date!==selectedDay;});recalculate(previousPlan);save();editing=false;selectedPlan=state.next;render();text(status,'已删除该日期的循环记录，可点“撤销上一步操作”恢复；重量历史未改变。');});
    restore.addEventListener('click',function(){if(locked||!lastState)return;state=JSON.parse(lastState);lastState=null;save();selectedPlan=state.next;editing=false;render();text(status,'已恢复上一步操作前的记录。');});
    busy.addEventListener('click',function(){
      if(locked||!validDate(selectedDay))return;if(session(selectedDay)){text(status,'这天已记录训练，请用“更正这天的记录”，不会被忙碌标记覆盖。');return;}
      remember();if(state.busy.indexOf(selectedDay)!==-1)state.busy=state.busy.filter(function(d){return d!==selectedDay;});else state.busy.push(selectedDay);save();render();
    });
    document.getElementById('cyclePrevWeek').addEventListener('click',function(){week=offset(week,-7);calendar();});
    document.getElementById('cycleNextWeek').addEventListener('click',function(){week=offset(week,7);calendar();});
    document.getElementById('cycleToday').addEventListener('click',function(){chooseDay(localDay());});
    function rollover(){var today=localDay();if(today!==shownDay){if(selectedDay===shownDay){selectedDay=today;week=monday(today);editing=false;selectedPlan=state.next;}shownDay=today;render();}}
    window.addEventListener('focus',rollover);document.addEventListener('visibilitychange',function(){if(!document.hidden)rollover();});window.setInterval(rollover,30000);render();
    return {refresh:function(){
      try{var saved=JSON.parse(read(key)||'{"version":1,"next":"a","sessions":[],"busy":[]}');
        if(saved.version!==1||!Object.prototype.hasOwnProperty.call(plans,saved.next)||!Array.isArray(saved.sessions)||!Array.isArray(saved.busy)||!saved.sessions.every(function(s){return s&&validDate(s.date)&&Object.prototype.hasOwnProperty.call(plans,s.plan)&&typeof s.at==='string'&&!isNaN(Date.parse(s.at));})||!saved.busy.every(validDate))throw Error('Invalid schedule');
        function comparable(value){return JSON.stringify({next:value.next,sessions:value.sessions.slice().sort(function(a,b){return a.date.localeCompare(b.date);}).map(function(s){return {date:s.date,plan:s.plan,at:s.at,completed:s.completed||[],skipped:s.skipped||{}};}),busy:value.busy.slice().sort()});}
        if(comparable(state)!==comparable(saved))lastState=null;
        state=saved;locked=false;if(!editing)selectedPlan=state.next;render();
      }catch(error){locked=true;render();}
    },canImport:function(){return !locked;},importSessions:function(incoming){if(locked)throw Error('Schedule unreadable');remember();incoming.forEach(function(s){state.sessions=state.sessions.filter(function(old){return old.date!==s.date;});state.sessions.push({date:s.date,plan:s.plan,at:s.date+'T00:00:00.000Z',completed:s.completed.slice(),skipped:Object.assign({},s.skipped)});state.busy=state.busy.filter(function(d){return d!==s.date;});});recalculate(state.next);save();selectedPlan=state.next;editing=false;render();}};
  }

  // Keep native <details> working independently of script and storage.
  var status = document.getElementById('storageStatus');
  function storageMessage() {
    status.textContent=accountStore.isVolatile()?'当前只能临时记录，刷新前请导出备份。':account.user?'本机自动保存，联网后同步到当前账号。共用设备用完请退出。':'游客记录仅保存在当前浏览器。登录后可选择导入；清理网站数据前请导出备份。';
  }
  function read(key){return accountStore.get(key);}
  function write(key,value){accountStore.set(key,value);storageMessage();}
  function refreshSettings(){settingInputs.forEach(function(input){var value=read('gym-compatible.setting.'+input.dataset.setting)||'';if(document.activeElement!==input)input.value=value;document.querySelectorAll('[data-setting-value="'+input.dataset.setting+'"]').forEach(function(dd){dd.textContent=value||'待记录';});});}
  settingInputs.forEach(function(input){input.addEventListener('input',function(){write('gym-compatible.setting.'+this.dataset.setting,this.value);refreshSettings();});});
  refreshSettings();
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
    loads[j].value = storedWeight === null ? '' : storedWeight;
    loads[j].addEventListener('input', function () {
      var value = this.value;
      if (!this.validity.valid) {
        this.setAttribute('aria-invalid', 'true');
        document.getElementById('weightStatus').textContent = '重量请输入 0～9999 kg 之间的数字，可填写 3.75、11.25 等小配重；无效数值不会保存。';
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
  storageMessage();

  var scheduleApi=initFlexibleSchedule(read, write, localDay);
  initPersonalImport(historyApi,scheduleApi,read,write,localDay);
  window.addEventListener('gym-checkins-imported',updateDay);
  function refreshAccountViews(){
    historyApi.refreshFromStore();
    updateDay();scheduleApi.refresh();refreshSettings();
    loads.forEach(function(input){if(document.activeElement!==input){var value=read('gym-compatible.load.'+input.dataset.key);input.value=value===null?'':value;}});
    storageMessage();
  }
  account.attach({history:historyApi,refresh:refreshAccountViews});
  var storageRefreshTimer=null;
  window.addEventListener('storage',function(event){
    if(event.key && event.key.indexOf('gym-account.v2|'+accountStore.scope+'|')!==0)return;
    window.clearTimeout(storageRefreshTimer);
    storageRefreshTimer=window.setTimeout(function(){if(account.isCurrent()){accountStore.refreshFromStorage();refreshAccountViews();}},80);
  });

  // TIMER_ADJUSTMENT_V2_START
  var segments = [
    { name: '热身', grade: 3, speed: 4, seconds: 360 },
    { name: '上坡①', grade: 7, speed: 5, seconds: 360 },
    { name: '上坡②', grade: 5, speed: 6, seconds: 600 },
    { name: '上坡③', grade: 10, speed: 4.5, seconds: 240 },
    { name: '放松', grade: 0, speed: 3.5, seconds: 240 }
  ];
  var phases = [], total = 0, exerciseTotal = 1800000;
  for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    if (segmentIndex > 0) {
      phases.push({ index: segmentIndex, gap: true, start: total, end: total + 10000 });
      total += 10000;
    }
    phases.push({ index: segmentIndex, gap: false, start: total, end: total + segments[segmentIndex].seconds * 1000 });
    total += segments[segmentIndex].seconds * 1000;
  }
  var elapsed = 0, running = false, deadline = 0, interval = null;
  var play = document.getElementById('play');
  var next = document.getElementById('next');
  var reset = document.getElementById('reset');
  var timerLabel = document.getElementById('timerLabel');
  var timerBox = timerLabel.closest('.timer-box');
  function format(seconds) { return ('0' + Math.floor(seconds / 60)).slice(-2) + ':' + ('0' + (seconds % 60)).slice(-2); }
  function sample() { if (running) elapsed = Math.min(total, Math.max(0, total - (deadline - Date.now()))); }
  function stage() {
    for (var index = 0; index < phases.length; index++) if (elapsed < phases[index].end) return phases[index];
    return phases[phases.length - 1];
  }
  function exerciseRemaining() {
    var done = 0;
    for (var index = 0; index < phases.length; index++) {
      var phase = phases[index];
      if (!phase.gap) done += Math.max(0, Math.min(elapsed, phase.end) - phase.start);
    }
    return Math.ceil((exerciseTotal - done) / 1000);
  }
  function clearTicker() { if (interval !== null) window.clearInterval(interval); interval = null; }
  function render() {
    var complete = elapsed >= total;
    if (complete) { running = false; clearTicker(); }
    var current = stage(), item = segments[current.index];
    var label = complete ? '30分钟爬坡已完成' : (current.gap ? '调整参数 · 即将进入第' : '第') + (current.index + 1) + '/5段 · ' + item.name;
    if (timerLabel.textContent !== label) timerLabel.textContent = label;
    timerBox.classList.toggle('is-adjusting', !complete && current.gap);
    document.getElementById('timerGrade').textContent = String(item.grade);
    document.getElementById('timerSpeed').textContent = String(item.speed);
    document.getElementById('clock').textContent = format(complete ? 0 : Math.ceil((current.end - elapsed) / 1000));
    document.getElementById('totalClock').textContent = '训练剩余 ' + format(exerciseRemaining()) + ' / 30:00 · 全程剩余 ' + format(Math.ceil((total - elapsed) / 1000)) + ' / 30:40';
    document.getElementById('timerHint').textContent = complete ? '已完成30分钟训练；4次参数调整另计40秒。' : current.gap ? '先把跑步机调到上方参数。倒计时结束后开始下一段；调好后也可直接点下方按钮。' : '本段按上方坡度与速度训练；下一段前会留10秒调整参数。';
    play.textContent = complete ? '已完成' : running ? '❚❚ 暂停' : elapsed > 0 ? '▶ 继续' : '▶ 开始';
    next.textContent = current.gap && !complete ? '参数已调好，开始本段' : current.index === segments.length - 1 ? '结束训练' : '下一段';
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
  // TIMER_ADJUSTMENT_V2_END
  document.addEventListener('visibilitychange', function () { ensureDay(); tick(); });
  window.addEventListener('pageshow', function () { ensureDay(); tick(); });
  window.addEventListener('focus', function () { ensureDay(); tick(); });
  window.setInterval(ensureDay, 30000);
  render();
  document.getElementById('runtimeStatus').textContent = '交互已启用：点器械图片或名称可展开／收起；打卡、重量与爬坡计时可用。';
  document.getElementById('runtimeStatus').className = 'runtime-ready';
})().catch(function(){var status=document.getElementById('runtimeStatus');if(status)status.textContent='记录组件暂未加载，请刷新重试；下方器械图文仍可直接展开阅读。';});

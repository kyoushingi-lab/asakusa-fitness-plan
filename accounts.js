(function (root) {
  'use strict';
  function text(id, value) { var el=document.getElementById(id); if(el)el.textContent=value; }
  async function open(options) {
    var client=null,user=null,controller=null,history=null,refresh=null,changing=false,ready=false,mergingGuest=false,initializing=true,observed=false,observedUser=null;
    var form=document.getElementById('syncLogin'),email=document.getElementById('syncEmail');
    var logout=document.getElementById('syncLogout'),manual=document.getElementById('syncNow');
    var importButton=document.getElementById('importGuest'),importPanel=document.getElementById('guestImportPanel');
    var config=root.GYM_CLOUD;
    function status(message){text('syncStatus',message);}
    if(form && root.supabase && config && config.url && config.key){
      try {
        client=root.supabase.createClient(config.url,config.key);
        client.auth.onAuthStateChange(function(event,session){
          var next=session&&session.user||null;observed=true;observedUser=next;
          if(!initializing && (next&&next.id||null)!==(user&&user.id||null))freeze();
        });
        var result=await client.auth.getSession();
        if(result.error)throw result.error;
        user=result.data.session&&result.data.session.user||null;
      } catch(error){status('暂时无法连接账号服务，可以先使用游客模式。');}
    }
    if(observed)user=observedUser;initializing=false;
    var emailPaused=!client || config.emailLoginPaused===true;
    if(!root.GymAccountStore)throw Error('Account storage unavailable');
    var store=root.GymAccountStore.create({scope:user?'user:'+user.id:'guest',seedSettings:options.seedSettings});
    function importing(){
      if(!importPanel)return;
      var summary=store.guestSummary();
      importPanel.hidden=!user||!summary.hasData;
      text('guestImportSummary','本机游客记录：'+summary.weights+' 条重量、'+summary.calendar+' 个日历日期、'+summary.checkins+' 项打卡、'+summary.settings+' 项器械设置。导入会保留账号已有的同日训练和设置。');
      importButton.disabled=!ready||changing||mergingGuest;
    }
    function freeze(){
      if(changing)return;changing=true;
      // Keep all pending edits bound to the old, immutable scope before switching.
      if(history)history.flush();if(controller)controller.stop();
      document.documentElement.classList.add('account-switching');
      document.querySelectorAll('input,button,select').forEach(function(el){el.disabled=true;});
      text('accountMode','正在切换账号…');
      root.location.reload();
    }
    text('accountMode',user?'已登录 · 独立账号':'游客模式 · 仅保存在这台设备');
    text('accountName',user?(user.email||'我的账号'):'无需注册，直接开始训练');
    text('syncAccount',user?'当前账号：'+(user.email||'已登录'):'游客记录不会自动上传；登录后可自行选择导入。');
    if(form)form.hidden=!!user||emailPaused;
    text('accountOptionsLabel',user?'查看同步状态 / 退出账号':emailPaused?'账号与同步 · 邮箱登录暂缓':'邮箱登录 / 账号同步');
    text('emailPausedNote',emailPaused?'邮箱登录暂缓配置。你可以直接训练，记录会自动保存在当前浏览器。':'登录后可在手机和电脑之间同步；游客记录需要手动选择导入。');
    if(logout)logout.hidden=!user;
    if(manual)manual.disabled=!user;
    var guest=document.getElementById('guestContinue');
    if(guest){guest.hidden=!!user;guest.disabled=false;guest.addEventListener('click',function(){text('accountMode','游客模式 · 已启用');var panel=document.getElementById('cyclePanel');if(panel)panel.open=true;document.getElementById('cycle').scrollIntoView({behavior:'smooth',block:'start'});});}
    if(client && form && !emailPaused){
      email.disabled=false;document.getElementById('syncSend').disabled=false;
      form.addEventListener('submit',async function(event){
        event.preventDefault();if(!form.reportValidity())return;
        var send=document.getElementById('syncSend');send.disabled=true;status('正在发送登录邮件…');
        try {
          var response=await client.auth.signInWithOtp({email:email.value.trim(),options:{shouldCreateUser:true,emailRedirectTo:root.location.origin+root.location.pathname}});
          if(response.error)throw response.error;
          status('登录链接已发送，请在邮箱中打开。首次登录会建立独立账号；游客记录需要手动导入。');
        } catch(error){status('登录邮件暂时无法发送。请稍后重试；若是新邮箱，需要先完成网站的发信服务配置。游客记录已保留。');}
        send.disabled=false;
      });
    }
    if(logout)logout.addEventListener('click',async function(){
      if(changing)return;if(history)history.flush();if(controller)controller.stop();logout.disabled=true;
      try {var response=await client.auth.signOut({scope:'local'});if(response.error)throw response.error;freeze();}
      catch(error){logout.disabled=false;status('退出暂未成功，请重试。当前记录仍属于原账号。');if(controller){controller=makeSync();controller.sync();}}
    });
    if(importButton)importButton.addEventListener('click',async function(){
      if(!user||!ready||changing||mergingGuest||!controller)return;
      history.flush();mergingGuest=true;importButton.disabled=true;
      var disabled=[];
      document.querySelectorAll('.load,.done,[data-setting],#cyclePanel input,#cyclePanel button,#cyclePanel select,#importHistory,#importWorkout,#applyWorkoutImport').forEach(function(el){if(!el.disabled){disabled.push(el);el.disabled=true;}});
      try{
        var imported=await controller.importGuest(store.guestSnapshot());
        // The server preserves existing keys atomically, even if another device
        // saved a date/setting between our initial pull and this import request.
        if(imported&&!changing)freeze();
      }catch(error){status('游客记录暂时无法导入，原记录已保留；请先导出备份再重试。');}
      finally{mergingGuest=false;if(!changing){disabled.forEach(function(el){el.disabled=false;});importing();}}
    });
    function makeSync(){
      if(!user||!client||!root.GymAccountSync)return null;
      return root.GymAccountSync.create({client:client,user:user,store:store,history:history,onStatus:function(message){
        status(message);if(message.indexOf('已同步')===0){ready=true;importing();}
      },onState:function(keys){if(refresh)refresh(keys);}});
    }
    importing();
    return {store:store,user:user,isCurrent:function(){return !changing;},attach:function(api){
      if(changing)return;
      history=api.history;refresh=api.refresh;controller=makeSync();
      if(manual)manual.addEventListener('click',function(){if(controller)controller.sync();});
      if(controller)controller.sync();
      else status(user?'账号同步组件暂未加载；当前账号的记录先保存在本机。':'正在使用游客模式，重量、日历、打卡和设置仅保存在当前浏览器。');
      importing();
    }};
  }
  root.GymAccounts={open:open};
})(window);

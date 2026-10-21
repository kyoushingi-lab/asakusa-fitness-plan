// Package the same page for offline use. Personal records are never embedded.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'../outputs/浅草健身计划_修复版.html'));
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace(/<link rel="stylesheet" href="styles\.css(?:\?[^"]*)?">/,'<style>'+fs.readFileSync(path.join(root,'styles.css'),'utf8')+'</style>');
html=html.replace(/(?:src|href)="(assets\/[^"]+\.jpg)"/g,(all,file)=>all.replace(file,'data:image/jpeg;base64,'+fs.readFileSync(path.join(root,file)).toString('base64')));
html=html.replace(/<section class="card" id="sync">[\s\S]*?<\/section>/,'');
html=html.replace(/<script[^>]*src="(?:vendor\/supabase\.js|cloud-config\.js)"[^>]*><\/script>/g,'');
html=html.replace(/<script[^>]*src="app\.js(?:\?[^"]*)?"[^>]*><\/script>/,'<script>'+fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace('在不同设备登录同一个邮箱，自动同步日期和重量。','离线文件记录保存在当前浏览器。');
html=html.replace('未登录时记录保存在当前浏览器；登录同步后可在手机和电脑之间查看。','本文件的记录保存在当前浏览器；手机与电脑同步请使用在线网页。');
if(/(?:src|href)="(?:assets\/|styles\.css|app\.js|vendor\/|cloud-config)/.test(html))throw Error('Unbundled dependency');
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,html);console.log('Single-file HTML created:',out,fs.statSync(out).size,'bytes');

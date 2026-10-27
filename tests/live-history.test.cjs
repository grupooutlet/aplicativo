const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let clock=Date.parse('2026-10-27T12:00:00Z');class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const local=new Map(),session=new Map(),requests=[],pending=[],messages=[];
const storage=map=>({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)});
const nodes=Object.fromEntries(['#live-history-totals','#live-history-controls','#live-history-notice','#live-history-overview','#live-history-coverage','#live-history-daily'].map(id=>[id,{innerHTML:'',textContent:''}]));
const ctx=vm.createContext({console,Date:ClockDate,URLSearchParams,Map,Set,Intl,crypto:require('node:crypto').webcrypto,
 document:{hidden:false,querySelector:s=>nodes[s]||null,addEventListener(){}},window:{addEventListener(){}},navigator:{},
 location:{protocol:'https:',hostname:'forteoutlet.com.br',search:''},isOwner:true,role:'Proprietário',currentProfile:{role:'master'},booted:true,route:'/app/live-view',routePath:()=>ctx.route,canManage:()=>['Proprietário','Gerente'].includes(ctx.role),
 localStore:storage(local),sessionStore:storage(session),db:{cart:[]},safeJson:(value,fallback)=>{try{return JSON.parse(value)||fallback}catch{return fallback}},
 esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),icon:()=>'',heading:(t,s,a)=>t+s+a,money:v=>String(v),momentLabel:v=>new ClockDate(v).toISOString(),toast:v=>messages.push(v),modal(){},closeModal(){},
 storeFooter:()=>'',navigation:[],adminPage(){},render(){},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
 FormData:class{constructor(form){this.data=form.data;}get(key){return this.data[key]}},
 backendRequest:(url,options)=>new Promise(resolve=>pending.push({url,body:JSON.parse(options.body),resolve})),fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true};}
});
const business=fs.readFileSync('business.js','utf8');vm.runInContext(business.slice(business.indexOf('function businessDay('),business.indexOf('function orderBusinessDay(')),ctx);
vm.runInContext(fs.readFileSync('live-view.js','utf8'),ctx);const run=code=>vm.runInContext(code,ctx),plain=value=>JSON.parse(JSON.stringify(value));
const result=(start,end,visits=3,visitors=2)=>({start,end,visits,visitors,daily:[{day:start,visits,visitors,available:true}],overview:[{key:'today',visits:3,visitors:2},{key:'week',visits:8,visitors:4},{key:'month',visits:20,visitors:9}],historyStartedAt:'2026-10-27T12:00:00Z'});
(async()=>{
 assert.deepEqual(plain(run("liveHistoryRange(new Date('2026-10-27T02:59:00Z'))")),{start:'2026-10-26',end:'2026-10-26',today:'2026-10-26'});
 run("liveHistoryPeriod='week'");assert.equal(run("liveHistoryRange(new Date('2026-11-01T15:00:00Z')).start"),'2026-10-26');
 run("liveHistoryPeriod='month'");assert.equal(run('liveHistoryRange().start'),'2026-10-01');
 run("liveHistoryPeriod='last90'");assert.equal(run('liveHistoryRange().start'),'2026-07-30');run("liveHistoryPeriod='today'");
 const todayLoad=run('loadLiveHistory(true)');assert.equal(pending[0].url,'/rest/v1/rpc/store_visit_statistics');
 run("setLiveHistoryPeriod('week')");assert.equal(pending.length,2);pending[1].resolve(result('2026-10-26','2026-10-27',8,4));await Promise.resolve();await Promise.resolve();
 pending[0].resolve(result('2026-10-27','2026-10-27'));await todayLoad;assert.equal(run('liveHistory.visits'),8,'Old response must not overwrite the selected period');
 assert.match(nodes['#live-history-totals'].innerHTML,/Visitantes únicos/);assert.match(nodes['#live-history-totals'].innerHTML,/>4</);assert.match(nodes['#live-history-overview'].innerHTML,/Este mês/);assert.match(nodes['#live-history-coverage'].textContent,/Horário de Brasília/);
 const count=pending.length;ctx.form={data:{start:'2026-02-31',end:'2026-10-27'}};run('applyLiveHistoryDates(form)');assert.equal(pending.length,count);assert.match(messages.at(-1),/período válido/);
 ctx.form={data:{start:'2026-10-26',end:'2026-10-27'}};run('applyLiveHistoryDates(form)');assert.equal(pending.length,count+1);pending.at(-1).resolve(result('2026-10-26','2026-10-27',7,4));await Promise.resolve();await Promise.resolve();
 ctx.currentProfile={role:'admin'};ctx.role='Vendedor';assert.equal(run('canViewLive()'),false);const denied=pending.length;await run('loadLiveHistory(true)');assert.equal(pending.length,denied);
 ctx.route='/loja/produto/1';ctx.currentProfile=null;ctx.isOwner=false;local.set('forte-audience-consent-v1','yes');await run('sendAudience()');assert.equal(requests.length,0,'Old 30-minute consent must not authorize retained browser identifiers');assert.equal(local.has('forte-audience-visitor-v1'),false);
 local.set('forte-audience-consent-v2','yes');await run('sendAudience()');const first=requests.at(-1);assert.equal(first.forget,false);assert.ok(first.visitor);assert.deepEqual(Object.keys(first).sort(),['forget','hasCart','phase','visit','visitor']);
 ctx.route='/loja/carrinho';await run('sendAudience()');assert.equal(requests.at(-1).visit,first.visit);assert.equal(requests.at(-1).visitor,first.visitor);
 session.clear();await run('sendAudience()');assert.equal(requests.at(-1).visit,first.visit,'A second tab shares the active session');
 clock+=1800001;await run('sendAudience()');assert.notEqual(requests.at(-1).visit,first.visit);assert.equal(requests.at(-1).visitor,first.visitor,'A return adds a session, not another person');
 const before=requests.length;ctx.currentProfile={role:'admin'};await run('sendAudience()');assert.equal(requests.length,before);ctx.currentProfile=null;ctx.navigator.globalPrivacyControl=true;await run('sendAudience()');assert.equal(requests.length,before);ctx.navigator.globalPrivacyControl=false;
 clock+=91*86400000;await run('sendAudience()');assert.notEqual(requests.at(-1).visitor,first.visitor);assert.notEqual(requests.at(-1).visit,first.visit);
 let release;ctx.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return await new Promise(resolve=>release=resolve)};const sending=run('sendAudience()');const current=requests.at(-1);
 run('setAudienceConsent(false)');assert.equal(local.has('forte-audience-visitor-v1'),false);assert.equal(local.has('forte-audience-session-v1'),false);
 ctx.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));throw Error('offline')};release({ok:true});await sending;await Promise.resolve();await Promise.resolve();assert.equal(requests.at(-1).forget,true);assert.equal(requests.at(-1).visitor,current.visitor);assert.equal(local.has('forte-audience-forget-v1'),true,'Failed revocation is retried');
 ctx.navigator.doNotTrack='1';ctx.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return{ok:true}};await run('sendAudience()');assert.equal(requests.at(-1).forget,true);assert.equal(local.has('forte-audience-forget-v1'),false);assert.equal(local.has('forte-audience-visitor-v1'),false);
 console.log('Visit history: Brasília periods/custom validation, unique visitor presentation, request races, managerial scope, renewed consent, shared sessions, repeat visits, ID expiry, staff/DNT exclusions and offline/in-flight revocation verified.');
})().catch(error=>{console.error(error);process.exitCode=1});

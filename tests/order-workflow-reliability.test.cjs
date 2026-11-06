const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const memory=new Map(),messages=[],routes=[];
const source=fs.readFileSync('commerce.js','utf8');
const ctx=vm.createContext({
  TextEncoder,Uint8Array,Date,JSON,Map,Error,TypeError,
  crypto:require('node:crypto').webcrypto,
  authSession:{user:{id:'qa-manager'}},
  localStore:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)},
  safeJson:(value,fallback)=>{try{return JSON.parse(value)||fallback;}catch{return fallback;}},
  settleAdminWrites:async()=>{},loadAdminState:async()=>{},
  closeModal:()=>{},go:route=>routes.push(route),toast:message=>messages.push(message),
  operationalErrorMessage:()=> 'A operação demorou para responder.',
  document:{createElement:()=>({dataset:{}})}
});
vm.runInContext(source.slice(source.indexOf('async function saveStaffOrder('),source.indexOf('\norderDetail =',source.indexOf('async function saveStaffOrder('))),ctx);
const run=code=>vm.runInContext(code,ctx);
function form(){
  const button={disabled:false},summary={querySelector:()=>null,append(){}};
  return {button,querySelector:selector=>selector==='.new-order-sidebar .primary'?button:summary};
}
const payload={id:1001,date:'2026-11-06',createdAt:'client-time',customer:'QA Cliente',items:[{id:1,qty:1,price:100}],total:100};
(async()=>{
  let calls=0,statusCalls=0,recordedId=null,failStatus=false,lastRequest;
  ctx.backendRequest=async(path,options)=>{
    if(path.endsWith('staff_order_request_status')){
      statusCalls++;
      if(failStatus)throw new TypeError('offline');
      assert.equal(JSON.parse(options.body).p_request_id,lastRequest);
      return {id:recordedId};
    }
    calls++;lastRequest=JSON.parse(options.body).p_request_id;
    throw new TypeError('Response lost');
  };
  failStatus=true;
  const first=form();await ctx.saveStaffOrder(payload,first);
  assert.equal(calls,1);assert.equal(first.button.disabled,false);
  const saved=[...memory.values()].join('');
  assert.doesNotMatch(saved,/QA Cliente|items|price/,'Only an irreversible fingerprint and retry identifiers are saved');
  const requestId=lastRequest;
  failStatus=false;recordedId=5138;
  const reopened=form();await ctx.saveStaffOrder({...payload,id:9999,date:'other day',createdAt:'new client time'},reopened);
  assert.equal(calls,1,'A reopened form checks the previous submission instead of creating a duplicate');
  assert.equal(lastRequest,requestId);
  assert.equal(reopened.orderCommittedId,5138);
  assert.equal(routes.at(-1),'/app/orders/5138');
  assert.deepEqual(JSON.parse(memory.values().next().value),[]);
  ctx.backendRequest=async(path,options)=>{calls++;return {id:5140};};
  ctx.loadAdminState=async()=>{throw new TypeError('Refresh offline');};
  const committed=form();await ctx.saveStaffOrder(payload,committed);
  assert.equal(committed.orderCommittedId,5140);assert.equal(committed.button.disabled,true);
  assert.match(messages.at(-1),/Pedido #5140 criado/);
  const before=calls;
  ctx.loadAdminState=async()=>{};await ctx.reopenConfirmedStaffOrder(committed);
  assert.equal(calls,before,'Refreshing a confirmed order cannot create it again');
  ctx.backendRequest=async()=>{throw Object.assign(new Error('Confira o pedido'),{status:400,code:'P0001'});};
  const invalid=form();await ctx.saveStaffOrder(payload,invalid);
  assert.equal(invalid.orderCommittedId,undefined);
  assert.deepEqual(JSON.parse(memory.values().next().value),[]);
  vm.runInContext(source.slice(source.indexOf('async function performOrderAction('),source.indexOf('\ndispatchOrder =',source.indexOf('async function performOrderAction('))),ctx);
  let actionCalls=0;
  ctx.workflowOrder=()=>({paid:true,status:'transit'});
  ctx.refreshOperationalState=async()=>{};
  ctx.backendRequest=async()=>{actionCalls++;throw new TypeError('Response lost after payment');};
  assert.equal((await ctx.performOrderAction(5137,'payment','photo')).duplicate,true);
  assert.equal(actionCalls,1);
  ctx.backendRequest=async()=>({id:5137});
  ctx.refreshOperationalState=async()=>{throw new TypeError('Refresh offline');};
  await assert.rejects(ctx.performOrderAction(5137,'payment','photo'),/A etapa foi confirmada/);
  console.log('Order reliability: lost replies, persisted private retry fingerprints, reopened forms, confirmed refresh failures and validation failures verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});

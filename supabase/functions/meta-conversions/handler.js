// Runs only on the server. CAPI access token is read from encrypted Supabase Vault.
export const META_PIXEL_ID='2999298787072098',GRAPH_VERSION='v26.0';
export function createMetaHandler({rpc,send=fetch,now=()=>Date.now()}){
 return async request=>{
  const respond=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='POST')return respond(405,{error:'method'});
  const key=request.headers.get('x-meta-worker-key');if(!key||key.length>150)return respond(401,{error:'unauthorized'});
  let config;try{config=await rpc('meta_worker_config',{p_key:key});}catch{return respond(401,{error:'unauthorized'});}
  if(!config?.token)return respond(503,{configured:false});
  let body;try{body=await request.json();}catch{return respond(400,{error:'body'});}
  // Integration tests are explicitly isolated in Meta Test Events; never queue fake sales.
  if(body?.testCode){
   if(!/^TEST\d{3,20}$/.test(body.testCode))return respond(400,{error:'test_code'});
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('forte-outlet-integration-test')))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const allowed=new Set(['MetaIntegrationTest','PageView','ViewContent','AddToCart','InitiateCheckout','AddPaymentInfo','Purchase','OrderPending','OrderDelivered','OrderCancelled','CompleteRegistration','Contact','Search']);
   const name=body.testName||'MetaIntegrationTest';if(!allowed.has(name))return respond(400,{error:'test_name'});
   const result=await dispatch({event_name:name,event_time:Math.floor(now()/1000),event_id:'fo:test:'+crypto.randomUUID(),action_source:'website',event_source_url:'https://forteoutlet.com.br/#/loja',user_data:{external_id:[hash],client_user_agent:'ForteOutlet-Integration-QA'},custom_data:{integration_test:true,...(name==='MetaIntegrationTest'?{}:{currency:'BRL',value:1,content_type:'product',content_ids:['integration-test-only'],contents:[{id:'integration-test-only',quantity:1,item_price:1}],num_items:1})}},config.token,body.testCode);
   return respond(result.ok?200:502,{test:true,received:result.received,errorCode:result.errorCode});
  }
  let rows;try{rows=await rpc('meta_claim_events',{p_key:key});}catch{return respond(503,{error:'queue'});}
  let sent=0,failed=0;
  for(const row of rows||[]){
   // Re-check consent/status immediately before each dispatch. A revoked/cancelled event is skipped.
   let payload;try{payload=await rpc('meta_event_payload',{p_key:key,p_id:row.id,p_lease:row.lease});}catch{failed++;continue;}
   if(!payload)continue;
   const result=await dispatch(payload,config.token);
   try{await rpc('meta_finish_event',{p_key:key,p_id:row.id,p_lease:row.lease,p_ok:result.ok,p_code:result.errorCode,p_trace:result.trace});}catch{failed++;continue;}
   result.ok?sent++:failed++;
  }
  return respond(200,{sent,failed});
 };
 async function dispatch(payload,token,testCode){
  try{
   const response=await send('https://graph.facebook.com/'+GRAPH_VERSION+'/'+META_PIXEL_ID+'/events',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({data:[payload],...(testCode?{test_event_code:testCode}:{})}),signal:AbortSignal.timeout(10000)});
   const data=await response.json();const received=Number(data.events_received)||0;
   return {ok:response.ok&&received===1,received,errorCode:data.error?.code?String(data.error.code):response.ok&&received===1?'':String(response.status),trace:String(data.fbtrace_id||data.error?.fbtrace_id||'').slice(0,120)};
  }catch{return {ok:false,received:0,errorCode:'network',trace:''};}
 }
}

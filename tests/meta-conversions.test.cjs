const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
const {createMetaHandler}=await import('data:text/javascript;base64,'+fs.readFileSync('supabase/functions/meta-conversions/handler.js').toString('base64'));
let calls=[],queued=[{id:'fo:order:Purchase',lease:'lease'}],revoked=false,metaStatus=200,received=1,configured=true;
const handler=createMetaHandler({rpc:async(name,args)=>{
 calls.push({name,args});if(args.p_key!=='secret-key')throw Error('denied');
 if(name==='meta_worker_config')return configured?{token:'server-token'}:{};
 if(name==='meta_claim_events')return queued;
 if(name==='meta_event_payload')return revoked?null:{event_name:'Purchase',event_id:'fo:order:Purchase',event_time:123,currency:'BRL'};
 if(name==='meta_finish_event')return null;throw Error('unexpected rpc');
},send:async(url,options)=>{calls.push({url,options,payload:JSON.parse(options.body)});return Response.json(metaStatus===200?{events_received:received,fbtrace_id:'trace'}:{error:{code:190,message:'never leak token'}},{status:metaStatus});}});
const request=body=>new Request('https://example/functions/v1/meta-conversions',{method:'POST',headers:{'x-meta-worker-key':'secret-key','Content-Type':'application/json'},body:JSON.stringify(body||{})});
assert.equal((await handler(new Request('https://example'))).status,405);
assert.equal((await handler(new Request('https://example',{method:'POST'}))).status,401);
assert.equal((await handler(new Request('https://example',{method:'POST',headers:{'x-meta-worker-key':'bad'}}))).status,401);
let response=await handler(request());assert.deepEqual(await response.json(),{sent:1,failed:0});
const wire=calls.find(c=>c.url);assert.equal(wire.options.headers.Authorization,'Bearer server-token');assert.ok(!wire.url.includes('server-token'));assert.equal(wire.payload.data[0].event_id,'fo:order:Purchase');assert.ok(!wire.payload.test_event_code);
assert.equal(calls.find(c=>c.name==='meta_finish_event').args.p_ok,true);
calls=[];revoked=true;await handler(request());assert.equal(calls.some(c=>c.url),false);assert.equal(calls.some(c=>c.name==='meta_finish_event'),false);
calls=[];revoked=false;metaStatus=400;await handler(request());assert.equal(calls.find(c=>c.name==='meta_finish_event').args.p_code,'190');
calls=[];metaStatus=200;response=await handler(request({testCode:'TEST88986'}));assert.equal(response.status,200);assert.equal(calls.some(c=>c.name==='meta_claim_events'),false);assert.equal(calls.find(c=>c.url).payload.test_event_code,'TEST88986');assert.equal(calls.find(c=>c.url).payload.data[0].event_name,'MetaIntegrationTest');assert.equal(calls.find(c=>c.url).payload.data[0].custom_data.value,undefined);
assert.equal((await handler(request({testCode:'invalid'}))).status,400);
configured=false;assert.equal((await handler(request())).status,503);
console.log('Meta worker: authentication, Vault token isolation, lease IDs, consent re-check, response acknowledgment, error redaction and test-event isolation verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});

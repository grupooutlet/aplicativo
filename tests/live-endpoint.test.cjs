const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {onRequest}=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../functions/api/live.js')).toString('base64'));
 const originalFetch=global.fetch;let calls=[],backendStatus=200;
 global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body),headers:options.headers});return new Response('true',{status:backendStatus});};
 const valid={visit:'12345678-1234-4234-8234-123456789012',phase:'product',hasCart:true};
 const request=(body=valid,headers={},cf={city:'Rio de Janeiro',regionCode:'RJ',country:'BR',latitude:'-22.912',longitude:'-43.231'})=>{const r=new Request('https://forteoutlet.com.br/api/live',{method:'POST',headers:{Origin:'https://forteoutlet.com.br','Content-Type':'application/json','Sec-Fetch-Site':'same-origin',...headers},body:JSON.stringify(body)});Object.defineProperty(r,'cf',{value:cf});return onRequest({request:r});};
 try{
  assert.equal((await request({...valid,city:'Injected',latitude:99})).status,204);assert.equal(calls[0].body.p_city,'Rio de Janeiro');assert.equal(calls[0].body.p_latitude,-22.9);assert.equal(calls[0].body.p_longitude,-43.2);assert.doesNotMatch(JSON.stringify(calls[0].body),/Injected|user_id|email|ip_address/);
  let count=calls.length;assert.equal((await request(valid,{Origin:'https://evil.example'})).status,403);assert.equal((await request(valid,{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal((await request({...valid,visit:'invalid'})).status,400);assert.equal((await request({...valid,phase:'customer-data'})).status,400);assert.equal((await request(valid,{'Content-Type':'text/plain'})).status,415);assert.equal((await request({...valid,padding:'x'.repeat(2100)})).status,413);assert.equal(calls.length,count);
  assert.equal((await request(valid,{DNT:'1'})).status,204);assert.equal((await request(valid,{'Sec-GPC':'1'})).status,204);assert.equal((await request(valid,{'User-Agent':'Googlebot'})).status,204);assert.equal(calls.length,count);
  assert.equal((await request({...valid,forget:true})).status,204);assert.equal(calls.at(-1).body.p_forget,true);
  backendStatus=503;assert.equal((await request()).status,502);assert.equal((await onRequest({request:new Request('https://forteoutlet.com.br/api/live')})).status,405);
  console.log('Live endpoint: same-origin gate, trusted Cloudflare geography, data minimization, UUID/input/size validation, DNT/GPC/bots, revocation and backend failures verified.');
 }finally{global.fetch=originalFetch;}
})().catch(error=>{console.error(error);process.exitCode=1;});

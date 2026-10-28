const assert=require('node:assert/strict');
const {onRequest}=require('../functions/api/catalog.js');
const originalFetch=global.fetch,originalCaches=global.caches,cache=new Map();let calls=0,status=200,stock=10,pending=[];
global.caches={default:{match:async key=>cache.get(key.url)?.clone(),put:async(key,response)=>cache.set(key.url,response.clone())}};
global.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'manual','Workers must never use unsupported redirect:error');assert.equal(url,'https://rwxqytomiorsrxpgtjin.supabase.co/rest/v1/shop_public?select=data&id=eq.1');assert.equal(options.headers.Authorization,undefined);return new Response(status===200?JSON.stringify([{data:{products:[{id:1,stock}],settings:{name:'Loja'}}}]):JSON.stringify({message:'restricted'}),{status,headers:{'Content-Type':'application/json','Set-Cookie':'must-not-leak=1'}})};
const get=(headers={},method='GET',suffix='')=>onRequest({request:new Request('https://forteoutlet.com.br/api/catalog'+suffix,{method,headers}),waitUntil:value=>pending.push(value)});
(async()=>{try{
 const pair=await Promise.all([get(),get()]);assert.equal(calls,1,'Simultaneous public misses share one backend read');for(const r of pair)assert.equal(r.status,200);await Promise.all(pending);
 let r=await get();assert.equal(calls,1);assert.equal(r.headers.get('Set-Cookie'),null);assert.match(r.headers.get('Cache-Control'),/s-maxage=15/);const etag=r.headers.get('ETag');
 r=await get({'If-None-Match':etag});assert.equal(r.status,304);assert.equal(await r.text(),'');assert.equal(calls,1);
 r=await get({},'HEAD');assert.equal(await r.text(),'');assert.equal(calls,1);
 stock=9;r=await get({'X-Catalog-Refresh':'1','If-None-Match':etag});assert.equal(r.status,200);assert.equal((await r.json())[0].data.products[0].stock,9);await Promise.all(pending);assert.equal(calls,2);
 for(const [headers,method,suffix,expected] of [[{},'POST','',405],[{'Authorization':'Bearer private'},'GET','',400],[{},'GET','?private=1',400],[{'Sec-Fetch-Site':'cross-site'},'GET','',403]])assert.equal((await get(headers,method,suffix)).status,expected);
 assert.equal(calls,2,'Invalid requests never reach Supabase');cache.clear();status=402;
 r=await get();assert.equal(r.status,503);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal((await r.json()).code,'CATALOG_QUOTA_RESTRICTED');await Promise.all(pending);assert.equal(cache.size,0,'Restricted or expired responses never become a stale catalog');
 status=200;global.caches.default.match=async()=>{throw Error('Cache unavailable')};global.caches.default.put=()=>{throw Error('Cache unavailable')};assert.equal((await get()).status,200,'Optional edge cache failures cannot prevent a healthy catalog response');
 console.log('Catalog edge cache: coalesced public reads, 15s expiry policy, ETag/304, HEAD, explicit fresh stock, no credentials/cookies/private cache and quota failure verified.');
 }finally{global.fetch=originalFetch;global.caches=originalCaches}
})().catch(error=>{console.error(error);process.exitCode=1});

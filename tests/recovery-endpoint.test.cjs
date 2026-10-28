const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const {createCheckoutRecoveryHandler}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('supabase/functions/checkout-recovery/handler.js')).toString('base64'));
 const calls=[];let accepted=true;const handler=createCheckoutRecoveryHandler({publicKey:'public-qa',clientHash:async()=> 'a'.repeat(64),rpc:async(name,args)=>{calls.push({name,args});return accepted;}});
 const body={id:crypto.randomUUID(),secret:crypto.randomUUID(),sequence:1,data:{phone:'21900000001',firstName:'Marina',email:'qa@example.invalid',consent:true,items:[{id:1,qty:1,options:{}}],cpf:'DO NOT STORE',address:'DO NOT STORE',password:'DO NOT STORE'}};
 const request=(payload=body,overrides={})=>new Request('https://example.supabase.co/functions/v1/checkout-recovery',{method:'POST',headers:{Origin:'https://forteoutlet.com.br',apikey:'public-qa','Content-Type':'application/json',...overrides},body:JSON.stringify(payload)});
 assert.equal((await handler(request())).status,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'capture_checkout_recovery');assert.ok(!JSON.stringify(calls[0]).includes('DO NOT STORE'));
 for(const origin of ['https://evil.example','https://forteoutlet.com.br.evil.example','http://forteoutlet.com.br',''])assert.equal((await handler(request(body,{Origin:origin}))).status,403);
 assert.equal((await handler(request(body,{apikey:'wrong'}))).status,401);assert.equal((await handler(request(body,{'Content-Type':'text/plain'}))).status,415);
 assert.equal((await handler(request({...body,secret:'wrong'}))).status,400);assert.equal((await handler(request({...body,data:{...body.data,consent:'true'}}))).status,400);
 const before=calls.length;assert.equal((await handler(request({...body,website:'spam'}))).status,200);assert.equal(calls.length,before);
 assert.equal((await handler(request({...body,data:{...body.data,email:'a'.repeat(17000)}}))).status,413);
 for(const origin of ['https://forteoutlet.com.br','https://www.forteoutlet.com.br','https://forte-outlet.pages.dev']){const r=await handler(new Request('https://example.supabase.co',{method:'OPTIONS',headers:{Origin:origin}}));assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);}
 accepted=false;assert.equal((await handler(request())).status,429);assert.equal((await handler(request())).headers.get('Cache-Control'),'no-store');
 console.log('Recovery ingestion: origin/API key, size/type, honeypot, minimal data allowlist, server-only identity hash and rate-limit responses verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('production.js','utf8');
let calls=0,stock=10,revision=0;const logs=[];
const context=vm.createContext({console,Map,Set,JSON,Response,Error,location:{origin:'https://forteoutlet.com.br'},basePath:'/',backendUrl:'https://backend.invalid',refreshAuth:async()=>{},requestHeaders:()=>({apikey:'public'}),localStore:{getItem:()=>null},cartStorageKey:'cart',safeJson:(_v,f)=>f,rememberStoreSupport(){},defaults:()=>({}),db:{},storefront:{init(){}},fetch:async(url,options={})=>{calls++;logs.push({url,options});if(url.includes('/rpc/')){revision++;stock--;return new Response('{}',{headers:{'Content-Type':'application/json'}})}const tag='"'+revision+'"';if(options.headers?.['If-None-Match']===tag&&!options.headers?.['X-Catalog-Refresh'])return new Response(null,{status:304,headers:{ETag:tag}});return new Response(JSON.stringify([{data:{products:[{id:1,stock}],settings:{name:'Shop'}}}]),{headers:{ETag:tag,'Content-Type':'application/json'}})}});
vm.runInContext(source.slice(source.indexOf('const pendingPublicReads'),source.indexOf('function rememberAuth'))+source.slice(source.indexOf('function usesPagesCatalog'),source.indexOf('async function loadAdminState')),context);
const run=code=>vm.runInContext(code,context);
(async()=>{
 await run('Promise.all([loadCatalog(),loadCatalog()])');assert.equal(calls,1);assert.equal(run('db.products[0].stock'),10);
 await run('loadCatalog()');assert.equal(run('db.products[0].stock'),10);assert.equal(logs[1].options.headers['If-None-Match'],'"0"');assert.equal(logs[1].options.credentials,'omit');
 await run("backendRequest('/rpc/create_order',{method:'POST',body:'{}'},true)");await run('loadCatalog()');assert.equal(run('db.products[0].stock'),9);assert.equal(logs.at(-1).options.headers['X-Catalog-Refresh'],'1','Writes force a current catalog read');
 await run("Promise.all([backendRequest('/public'),backendRequest('/public')])");assert.equal(logs.filter(l=>l.url.endsWith('/public')).length,1);
 await run("Promise.all([backendRequest('/private',{},true),backendRequest('/private',{},true)])");assert.equal(logs.filter(l=>l.url.endsWith('/private')).length,2,'Private reads are never shared');
 context.fetch=async()=>new Response(JSON.stringify({message:'restricted',code:'QUOTA'}),{status:402});await assert.rejects(run("backendRequest('/failure')"),e=>e.status===402&&e.code==='QUOTA');
 console.log('Catalog client: anonymous in-flight deduplication, private isolation, ETag reuse, no cookie forwarding, post-write fresh stock and quota errors verified.');
})().catch(error=>{console.error(error);process.exitCode=1});

// Only coarse, optional audience measurement. No IP, identity, URLs or order IDs.
const API='https://rwxqytomiorsrxpgtjin.supabase.co';
const KEY='sb_publishable_blKM9wQxpyILSjEn1RnTmw_sLcoanYo';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phases=new Set(['store','product','cart','checkout','order']);
const reply=status=>new Response(null,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequest(context){
 const request=context.request,url=new URL(request.url);
 if(request.method!=='POST')return reply(405);
 if(request.headers.get('Origin')!==url.origin||!['same-origin',null].includes(request.headers.get('Sec-Fetch-Site')))return reply(403);
 if(request.headers.get('DNT')==='1'||request.headers.get('Sec-GPC')==='1')return reply(204);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415);
 if(Number(request.headers.get('Content-Length'))>2048)return reply(413);
 let body;try{const raw=await request.text();if(raw.length>2048)return reply(413);body=JSON.parse(raw);}catch{return reply(400);}
 if(!body||typeof body!=='object'||!uuid.test(body.visit)||!phases.has(body.phase)||typeof body.hasCart!=='boolean'||(body.forget!==undefined&&typeof body.forget!=='boolean'))return reply(400);
 if(/bot|crawl|spider|headless|preview/i.test(request.headers.get('User-Agent')||'')||(request.cf?.botManagement?.score<10))return reply(204);
 const cf=request.cf||{},clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80),coordinate=(value,max)=>value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))&&Math.abs(Number(value))<=max?Math.round(Number(value)*10)/10:null;
 const payload={p_visit:body.visit,p_city:clean(cf.city),p_region:clean(cf.regionCode||cf.region),p_country:/^[A-Z]{2}$/.test(cf.country||'')?cf.country:'XX',p_latitude:coordinate(cf.latitude,90),p_longitude:coordinate(cf.longitude,180),p_phase:body.phase,p_has_cart:body.hasCart,p_forget:body.forget===true};
 try{const result=await fetch(API+'/rest/v1/rpc/record_store_visit',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)});if(!result.ok)return reply(502);return (await result.json())===false?reply(429):reply(204);}catch{return reply(502);}
}

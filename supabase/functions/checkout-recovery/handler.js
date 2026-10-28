// Public write-only ingestion. Staff reads use authenticated, role-checked database functions.
const origins = new Set(['https://forteoutlet.com.br','https://www.forteoutlet.com.br','https://forte-outlet.pages.dev']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createCheckoutRecoveryHandler({rpc,publicKey,clientHash}) {
 return async request => {
  const origin=request.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff',
   ...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),
   'Access-Control-Allow-Headers':'apikey, authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(!origins.has(origin))return reply(403,{ok:false});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{ok:false});
  // Explicit API-key verification is intentional: guest checkouts do not have a user JWT.
  if(request.headers.get('apikey')!==publicKey)return reply(401,{ok:false});
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,{ok:false});
  if(Number(request.headers.get('Content-Length'))>16000)return reply(413,{ok:false});
  if(/bot|crawler|spider|headless/i.test(request.headers.get('User-Agent')||''))return reply(200,{ok:true});
  let body;
  try {const text=await request.text();if(new TextEncoder().encode(text).length>16000)return reply(413,{ok:false});body=JSON.parse(text);}catch{return reply(400,{ok:false});}
  if(body?.website)return reply(200,{ok:true}); // Autofill-resistant honeypot.
  if(!uuid.test(body?.id)||!uuid.test(body?.secret)||!Number.isSafeInteger(body?.sequence)||body.sequence<1||body.sequence>1000000||!body.data)return reply(400,{ok:false});
  if(body.data.cancel!==true&&(typeof body.data.phone!=='string'||typeof body.data.consent!=='boolean'||!Array.isArray(body.data.items)||body.data.items.length<1||body.data.items.length>30||body.data.items.some(item=>!Number.isSafeInteger(item?.id)||item.id<1||!Number.isInteger(item?.qty)||item.qty<1||item.qty>20||item.options!=null&&(typeof item.options!=='object'||Array.isArray(item.options)||Object.keys(item.options).length>12))))return reply(400,{ok:false});
  // The database allowlist strips everything except contact, cart and broad locality.
  const data=body.data.cancel===true?{cancel:true}:Object.fromEntries(['phone','firstName','lastName','email','items','consent','delivery','locality','phase'].filter(key=>Object.hasOwn(body.data,key)).map(key=>[key,body.data[key]]));
  try {
   const accepted=await rpc('capture_checkout_recovery',{p_id:body.id,p_secret:body.secret,p_data:data,p_sequence:body.sequence,p_client_hash:await clientHash(request)});
   return accepted?reply(200,{ok:true}):reply(429,{ok:false});
  }catch{return reply(503,{ok:false});} // No contact, request body, IP or secrets in logs.
 };
}

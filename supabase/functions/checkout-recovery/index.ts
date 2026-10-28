import {createCheckoutRecoveryHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publicKey='sb_publishable_blKM9wQxpyILSjEn1RnTmw_sLcoanYo';
const encoder=new TextEncoder();
const hashKey=await crypto.subtle.importKey('raw',encoder.encode(service),{name:'HMAC',hash:'SHA-256'},false,['sign']);
async function clientHash(request:Request){
 const ip=(request.headers.get('x-forwarded-for')||request.headers.get('x-real-ip')||'unknown').split(',')[0].trim();
 const digest=await crypto.subtle.sign('HMAC',hashKey,encoder.encode('checkout-recovery-v1:'+ip));
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function rpc(name:string,args:unknown){
 const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(7000)});
 if(!response.ok)throw Error('Recovery ingestion unavailable');return response.json();
}
Deno.serve(createCheckoutRecoveryHandler({rpc,publicKey,clientHash}));

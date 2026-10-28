// Public product imagery only. Private objects, arbitrary origins and writes are never proxied.
const source='https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/';
const maxBytes=7*1024*1024;
const failure=status=>new Response(null,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequest(context){
 const request=context.request,url=new URL(request.url);
 if(!['GET','HEAD'].includes(request.method))return failure(405);
 if(request.headers.get('Sec-Fetch-Site')==='cross-site')return failure(403);
 const path=url.searchParams.get('path')||'';
 if([...url.searchParams.keys()].length!==1||path.length>240||!/^(?:products|storefront)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(path))return failure(400);
 const key=new Request(url.origin+'/api/media?path='+encodeURIComponent(path),{method:'GET'}),cache=typeof caches!=='undefined'?caches.default:null;
 try{
  let hit=null;try{hit=cache?await cache.match(key):null}catch{}
  if(hit)return mediaReply(request,hit);
  const existing=pendingMedia.get(key.url);
  const pending=existing||fetchMedia(context,key,path,cache);if(!existing)pendingMedia.set(key.url,pending);
  try{return mediaReply(request,await pending)}finally{if(pendingMedia.get(key.url)===pending)pendingMedia.delete(key.url)}
 }catch{return failure(503);}
}

const pendingMedia=new Map();
function mediaReply(request,result){
 const response=result instanceof Response?result:new Response(result.bytes,{status:result.status,headers:result.headers});
 const etag=response.headers.get('ETag'),condition=request.headers.get('If-None-Match');
 if(response.status===200&&etag&&condition?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag.replace(/^W\//,'')))return new Response(null,{status:304,headers:response.headers});
 return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:response.headers});
}
async function fetchMedia(context,key,path,cache){
 const response=await readMedia(context,key,path,cache);
 return {status:response.status,headers:[...response.headers],bytes:new Uint8Array(await response.arrayBuffer())};
}
async function readMedia(context,key,path,cache){
 try{
  const upstream=await fetch(source+path,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!upstream.ok)return failure(upstream.status===404?404:503);
  const type=upstream.headers.get('Content-Type')?.split(';')[0]?.toLowerCase();
  if(!['image/jpeg','image/png','image/webp'].includes(type)||Number(upstream.headers.get('Content-Length'))>maxBytes)return failure(502);
  const bytes=await upstream.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>maxBytes)return failure(502);
  const headers={'Content-Type':type,'Content-Length':String(bytes.byteLength),'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'};
  const etag=upstream.headers.get('ETag');if(etag)headers.ETag=etag;
  const response=new Response(bytes,{headers});
  if(cache){try{context.waitUntil(cache.put(key,response.clone()).catch(()=>{}))}catch{}}
  return response;
 }catch{return failure(503)}
}

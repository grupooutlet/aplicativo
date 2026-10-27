// Public product imagery only. Private objects, arbitrary origins and writes are never proxied.
const source='https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/';
const maxBytes=7*1024*1024;
const failure=status=>new Response(null,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequest(context){
 const request=context.request,url=new URL(request.url);
 if(!['GET','HEAD'].includes(request.method))return failure(405);
 if(request.headers.get('Sec-Fetch-Site')==='cross-site')return failure(403);
 const path=url.searchParams.get('path')||'';
 if([...url.searchParams.keys()].length!==1||path.length>240||!/^(?:products|storefront)\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(path))return failure(400);
 const key=new Request(url.origin+'/api/media?path='+encodeURIComponent(path),{method:'GET'}),cache=typeof caches!=='undefined'?caches.default:null;
 try{
  const hit=cache?await cache.match(key):null;
  if(hit)return new Response(request.method==='HEAD'?null:hit.body,{status:200,headers:hit.headers});
  const upstream=await fetch(source+path,{redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!upstream.ok)return failure(upstream.status===404?404:503);
  const type=upstream.headers.get('Content-Type')?.split(';')[0]?.toLowerCase();
  if(!['image/jpeg','image/png','image/webp'].includes(type)||Number(upstream.headers.get('Content-Length'))>maxBytes)return failure(502);
  const bytes=await upstream.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>maxBytes)return failure(502);
  const headers={'Content-Type':type,'Content-Length':String(bytes.byteLength),'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'};
  const etag=upstream.headers.get('ETag');if(etag)headers.ETag=etag;
  const response=new Response(bytes,{headers});
  if(cache)context.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
  return request.method==='HEAD'?new Response(null,{headers}):response;
 }catch{return failure(503);}
}

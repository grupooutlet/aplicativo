// Default is a local dry run. --apply reads account credentials from stdin, never a file/argument.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const backend='https://rwxqytomiorsrxpgtjin.supabase.co',bucket='product-photos';
const prefix=backend+'/storage/v1/object/public/'+bucket+'/';
function rebaseProducts(products,mapping){
 return products.map(product=>({...product,...(mapping.has(product.image)?{image:mapping.get(product.image)}:{}),...(Array.isArray(product.images)?{images:product.images.map(image=>mapping.get(image)||image)}:{})}));
}
function rebaseThemeImages(value,mapping){
 if(Array.isArray(value))return value.map(item=>rebaseThemeImages(item,mapping));
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='image'&&typeof item==='string'?(mapping.get(item)||item):rebaseThemeImages(item,mapping)]));
}
function validatePlan(directory){
 const root=path.resolve(directory),plan=JSON.parse(fs.readFileSync(path.join(root,'upload-plan.json'),'utf8'));
 if(plan.project!=='rwxqytomiorsrxpgtjin'||plan.bucket!==bucket||!Array.isArray(plan.images))throw Error('Unexpected project or upload plan');
 const images=plan.images.filter(image=>image.recommended);
 for(const image of images){
  if(!image.originalUrl.startsWith(prefix)||!image.activationUrl.startsWith(image.originalUrl+'#media-v1=')||!image.files.length)throw Error('Invalid activation mapping');
  for(const file of image.files){
   const local=path.resolve(root,file.file);if(!local.startsWith(root+path.sep)||!/^products\/optimized-v1\/[a-f0-9]{64}-\d+x\d+-(thumb|card|detail|banner)\.webp$/.test(file.object))throw Error('Invalid image path');
   const bytes=fs.readFileSync(local);if(bytes.length!==file.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Optimized image failed checksum verification');
  }
 }
 return {root,images};
}
async function main(){
 const directory=process.argv.find(arg=>arg.startsWith('--directory='))?.slice(12)||'test-results/catalog-optimized-v1';
 const {root,images}=validatePlan(directory);
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',images:images.length,files:images.reduce((n,i)=>n+i.files.length,0),bytes:images.reduce((n,i)=>n+i.files.reduce((s,f)=>s+f.bytes,0),0),originalsDeleted:0}));
 if(!process.argv.includes('--apply'))return;
 const input=await new Promise((resolve,reject)=>{let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{body+=chunk;if(body.length>10000)reject(Error('Input too large'));if(body.includes('\n'))resolve(body.split('\n')[0])});process.stdin.on('end',()=>resolve(body))});
 const credentials=JSON.parse(input);if(credentials.email!=='grupooutlet.rj@gmail.com')throw Error('Use the authorized Grupo Outlet owner account');
 const key=fs.readFileSync(path.join(__dirname,'../production.js'),'utf8').match(/const backendKey = '([^']+)'/)[1];
 const request=async(route,options={})=>{const response=await fetch(backend+route,{...options,signal:AbortSignal.timeout(60000)});if(response.status===402)throw Error('Supabase quota restriction: stopped without bypass or catalog activation');return response};
 const login=await request('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(credentials)});credentials.password='';
 if(!login.ok)throw Error('Authentication unavailable; no images activated');let session=await login.json();
 const headers=async()=>{
  if(session.expires_at*1000<Date.now()+120000){const response=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});if(!response.ok)throw Error('Session refresh failed');session=await response.json()}
  return {apikey:key,Authorization:'Bearer '+session.access_token};
 };
 const verified=new Map();
 // Upload serially to avoid exhausting bandwidth/memory. Never overwrite existing originals.
 for(const image of images){
  for(const file of image.files){
   const h=await headers(),publicPath='/storage/v1/object/public/'+bucket+'/'+file.object;
   let response=await request(publicPath,{method:'HEAD'});
   if(response.status===404){response=await request('/storage/v1/object/'+bucket+'/'+file.object,{method:'POST',headers:{...h,'Content-Type':'image/webp','Cache-Control':'max-age=31536000, immutable','x-upsert':'false'},body:fs.readFileSync(path.join(root,file.file))});if(!response.ok)throw Error('Image upload failed: '+response.status);response=await request(publicPath,{method:'HEAD'})}
   if(!response.ok||!response.headers.get('Content-Type')?.startsWith('image/webp')||Number(response.headers.get('Content-Length'))!==file.bytes)throw Error('Uploaded image verification failed; no catalog activation');
  }
  verified.set(image.originalUrl,image.activationUrl);
 }
 // Rebase on the latest complete private state immediately before the atomic, version-checked save.
 const stateResponse=await request('/rest/v1/app_state?select=data,version&id=eq.1',{headers:await headers()});if(!stateResponse.ok)throw Error('Could not read current catalog');
 const state=(await stateResponse.json())[0];if(!state?.data?.products)throw Error('Invalid current catalog');
 const products=rebaseProducts(state.data.products,verified),changedProducts=products.filter((p,i)=>JSON.stringify(p)!==JSON.stringify(state.data.products[i])).length;
 const themes=Array.isArray(state.data.storeThemes)?state.data.storeThemes:[];
 const changes=changedProducts?{products}:{};
 const storefront=rebaseThemeImages(state.data.storefront,verified);
 if(!themes.some(t=>t.id===state.data.activeThemeId)&&JSON.stringify(storefront)!==JSON.stringify(state.data.storefront))changes.storefront=storefront;
 fs.writeFileSync(path.join(root,'activation-backup.json'),JSON.stringify({createdAt:new Date().toISOString(),expectedVersion:state.version,mappings:[...verified],productImages:state.data.products.map(p=>({id:p.id,image:p.image,images:p.images}))},null,2));
 let version=state.version,changedThemes=0;
 if(Object.keys(changes).length){
  const response=await request('/rest/v1/rpc/save_catalog',{method:'POST',headers:{...await headers(),'Content-Type':'application/json'},body:JSON.stringify({p_changes:changes,p_expected_version:state.version})});
  if(!response.ok)throw Error('Catalog changed or activation rejected; rerun safely after review. Original image references remain intact.');version=(await response.json()).version;
 }
 for(const theme of themes){
  const config=rebaseThemeImages(theme.config,verified);if(JSON.stringify(config)===JSON.stringify(theme.config))continue;
  const response=await request('/rest/v1/rpc/manage_store_theme',{method:'POST',headers:{...await headers(),'Content-Type':'application/json'},body:JSON.stringify({p_action:'save',p_id:theme.id,p_name:null,p_config:config,p_expected:theme.config,p_expected_live:null})});
  if(!response.ok)throw Error('Theme changed in another session; previously completed changes are safe. Rerun to resume.');version=(await response.json()).version;changedThemes++;
 }
 console.log(JSON.stringify({verifiedImages:verified.size,changedProducts,changedThemes,version,ordersModified:0,originalsDeleted:0}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={rebaseProducts,rebaseThemeImages,validatePlan};

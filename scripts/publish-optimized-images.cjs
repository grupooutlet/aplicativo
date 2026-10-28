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
 const input=await new Promise((resolve,reject)=>{
  let body='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
  const finish=()=>{process.stdin.removeListener('data',receive);process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.removeListener('end',finish);resolve(body.split(/[\r\n]/)[0])};
  const receive=chunk=>{body+=chunk;if(body.length>10000){process.stdin.pause();reject(Error('Input too large'));return}if(/[\r\n]/.test(body))finish()};
  process.stdin.on('data',receive);process.stdin.once('end',finish);
 });
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
 // Bounded parallelism; each acknowledged object is downloaded once and checksum verified.
 const workers=Math.max(1,Math.min(6,Number(process.argv.find(arg=>arg.startsWith('--workers='))?.slice(10))||4));
 let next=0,completed=0,uploadedFiles=0,verifiedBytes=0,failed=false;
 const started=Date.now();
 const uploadOne=async image=>{
  for(const file of image.files){
   const h=await headers(),bytes=fs.readFileSync(path.join(root,file.file));
   const response=await request('/storage/v1/object/'+bucket+'/'+file.object,{method:'POST',headers:{...h,'Content-Type':'image/webp','Cache-Control':'max-age=31536000, immutable','x-upsert':'false'},body:bytes});
   if(!response.ok){const problem=await response.json().catch(()=>({}));if(![400,409].includes(response.status)||!(['Duplicate','ResourceAlreadyExists','KeyAlreadyExists'].includes(problem.error||problem.code)||String(problem.statusCode)==='409'))throw Error('Image upload failed: '+response.status)}
   const checked=await request('/storage/v1/object/authenticated/'+bucket+'/'+file.object,{headers:h});
   if(!checked.ok||!checked.headers.get('Content-Type')?.startsWith('image/webp'))throw Error('Uploaded image unavailable; no catalog activation');
   const checkedBytes=Buffer.from(await checked.arrayBuffer());
   if(checkedBytes.length!==file.bytes||crypto.createHash('sha256').update(checkedBytes).digest('hex')!==file.sha256)throw Error('Uploaded image checksum failed; no catalog activation');
   uploadedFiles++;verifiedBytes+=file.bytes;
  }
  verified.set(image.originalUrl,image.activationUrl);completed++;
  if(completed%50===0||completed===images.length)console.log(JSON.stringify({completed,total:images.length,verifiedFiles:uploadedFiles,verifiedBytes,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
 };
 const results=await Promise.allSettled(Array.from({length:workers},async()=>{while(!failed&&next<images.length){const image=images[next++];try{await uploadOne(image)}catch(error){failed=true;throw error}}}));
 const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
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
 const publication={publishedAt:new Date().toISOString(),verifiedImages:verified.size,verifiedFiles:uploadedFiles,verifiedBytes,changedProducts,changedThemes,version,ordersModified:0,originalsDeleted:0};
 fs.writeFileSync(path.join(root,'publication.json'),JSON.stringify(publication,null,2));
 console.log(JSON.stringify(publication));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={rebaseProducts,rebaseThemeImages,validatePlan};

// Copy the public source photographs to the Grupo Outlet bucket. Credentials are accepted only on stdin.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const readline=require('node:readline');
const root=path.join(__dirname,'..'),folder=path.join(root,'imports','2026-10-15-forte');
const photos=path.join(folder,'images');fs.mkdirSync(photos,{recursive:true});
const config=fs.readFileSync(path.join(root,'production.js'),'utf8');
const backend=config.match(/const backendUrl = '([^']+)'/)[1],key=config.match(/const backendKey = '([^']+)'/)[1];
if(backend!=='https://rwxqytomiorsrxpgtjin.supabase.co')throw new Error('Wrong destination project');
function request(url,{method='GET',headers={},body,file,out}={}){
 return new Promise((resolve,reject)=>{
  const args=['-L','--silent','--show-error','--max-time','90',...(method==='HEAD'?['--head']:['--request',method]),'--write-out','\n%{http_code}'];
  for(const [name,value] of Object.entries(headers))args.push('--header',name+': '+value);
  if(out)args.push('--output',out);
  if(file)args.push('--data-binary','@'+file);else if(body!==undefined)args.push('--data-binary','@-');
  args.push(url);
  const child=execFile('curl.exe',args,{maxBuffer:4*1024*1024,windowsHide:true},(error,stdout)=>{
   const split=stdout.lastIndexOf('\n'),status=Number(stdout.slice(split+1)),text=stdout.slice(0,split);
   if(error)return reject(new Error('Network request failed for '+new URL(url).hostname));
   let data;try{data=JSON.parse(text)}catch{}
   resolve({status,data});
  });
  if(body!==undefined)child.stdin.end(typeof body==='string'?body:JSON.stringify(body));
 });
}
function imageType(file){const b=fs.readFileSync(file);if(b[0]===255&&b[1]===216)return {type:'image/jpeg',ext:'jpg',size:b.length};if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {type:'image/png',ext:'png',size:b.length};if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return {type:'image/webp',ext:'webp',size:b.length};throw new Error('The source did not return a supported image')}
async function main(){
 console.log('Waiting for authorized Grupo Outlet account credentials on stdin.');
 if(process.stdin.isTTY)process.stdin.setRawMode(true);
 const lines=readline.createInterface({input:process.stdin,terminal:false});
 const input=await new Promise(resolve=>lines.once('line',resolve));lines.close();
 if(process.stdin.isTTY)process.stdin.setRawMode(false);
 process.stdin.pause();
 const credentials=JSON.parse(input);if(credentials.email!=='grupooutlet.rj@gmail.com')throw new Error('Wrong account');
 const login=await request(backend+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:credentials});
 credentials.password='';if(login.status!==200||!login.data?.access_token)throw new Error('Could not authenticate the authorized account');
 const token=login.data.access_token;delete login.data;const headers={apikey:key,Authorization:'Bearer '+token};
 const products=JSON.parse(fs.readFileSync(path.join(folder,'source-products.json'),'utf8'));
 const urls=[...new Set(products.flatMap(p=>p.images))];
 const manifestFile=path.join(folder,'asset-manifest.json');
 const manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
 let next=0,done=0;const errors=[];
 const save=()=>{fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(folder,'asset-errors.json'),JSON.stringify(errors,null,2));};
 process.once('SIGINT',()=>{save();process.exit(130)});
 await Promise.all(Array.from({length:10},async()=>{while(next<urls.length){const url=urls[next++];
  try{
   if(manifest[url]?.verified){done++;continue}
   const source=new URL(url);if(!['spb.stoqui.com.br','bvwsyolgpsbvflhbqily.supabase.co'].includes(source.hostname)||!source.pathname.startsWith('/storage/v1/object/public/product_images/'))throw new Error('Unexpected public source URL');
   const hash=crypto.createHash('sha256').update(url).digest('hex').slice(0,32),file=path.join(photos,hash+'.image');
   let ok=false;for(let attempt=0;attempt<3;attempt++){const download=await request(url,{out:file});if(download.status===200){ok=true;break}if(attempt===2)throw new Error('Source image HTTP '+download.status)}
   if(!ok)throw new Error('Source image download failed');const image=imageType(file);if(image.size>7*1024*1024)throw new Error('Source image exceeds bucket 7 MB limit');
   const object='products/import-forte-20261015/'+hash+'.'+image.ext;
   for(let attempt=0;attempt<3;attempt++){
    const upload=await request(backend+'/storage/v1/object/product-photos/'+object,{method:'POST',headers:{...headers,'Content-Type':image.type,'x-upsert':'false'},file});
    if(upload.status===200||upload.status===201||(upload.status===400&&upload.data?.error==='Duplicate')||upload.status===409)break;
    if(attempt===2)throw new Error('Destination image HTTP '+upload.status+' '+String(upload.data?.error||''));
    await new Promise(r=>setTimeout(r,600*(attempt+1)));
   }
   const target=backend+'/storage/v1/object/public/product-photos/'+object;
   const verify=await request(target,{method:'HEAD'});if(verify.status!==200)throw new Error('Published image verification failed');
   manifest[url]={url:target,object,bytes:image.size,mime:image.type,verified:true};
  }catch(error){errors.push({url,error:error.message})}
  done++;if(done%50===0||done===urls.length){save();console.log(JSON.stringify({images:done,total:urls.length,copied:Object.keys(manifest).length,errors:errors.length}))}
 }}));save();
 fs.writeFileSync(path.join(folder,'asset-errors.json'),JSON.stringify(errors,null,2));
 console.log(JSON.stringify({completed:urls.length,copied:Object.keys(manifest).length,errors:errors.length,bytes:Object.values(manifest).reduce((n,x)=>n+x.bytes,0)}));
 if(errors.length)throw new Error('Image copy is incomplete; inspect the local asset error report.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});

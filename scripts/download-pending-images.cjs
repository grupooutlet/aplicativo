// Public product photos only. A quota error stops the operation; no alternate endpoint is used.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function main(){
 const root=path.resolve('test-results/catalog-optimized-v1'),inventory=JSON.parse(fs.readFileSync(path.join(root,'pending-originals.json'),'utf8'));
 console.log(JSON.stringify({mode:process.argv.includes('--download')?'download':'dry-run',pending:inventory.objects.length}));if(!process.argv.includes('--download'))return;
 const output=path.join(root,'remaining-originals');fs.mkdirSync(output,{recursive:true});
 const manifestFile=path.join(root,'remaining-asset-manifest.json'),manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
 for(const object of inventory.objects){
  if(!/^(products|storefront)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/i.test(object.name))throw Error('Unexpected public object path');
  const url='https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/'+object.name;
  const file=path.join(output,crypto.createHash('sha256').update(url).digest('hex').slice(0,32)+'.image');
  if(manifest[url]&&fs.existsSync(file)&&fs.statSync(file).size===object.bytes)continue;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(response.status===402)throw Error('Supabase quota restriction: stopped. Resume only after service recovery.');
  if(!response.ok||!/^image\/(jpeg|png|webp)(;|$)/.test(response.headers.get('Content-Type')||''))throw Error('Public original unavailable: '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==object.bytes)throw Error('Original size changed: refresh the inventory before proceeding');
  fs.writeFileSync(file,bytes);manifest[url]={url,object:object.name,bytes:bytes.length,verified:true};fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
 }
 console.log(JSON.stringify({downloaded:Object.keys(manifest).length,originalsModified:0}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});

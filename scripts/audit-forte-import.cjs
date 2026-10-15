const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const folder=path.join(__dirname,'..','imports','2026-10-15-forte');
const read=file=>JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));
const source=read('source-products.json'),items=read('import-items.json'),manifest=read('asset-manifest.json');
assert.equal(source.length,444);assert.equal(items.length,444);
assert.equal(new Set(items.map(p=>p.sourceId)).size,444);
for(const item of items){
 const original=source.find(p=>p.sourceId===item.sourceId),product=item.product;
 assert.ok(original);assert.equal(product.name,original.title.trim());
 assert.equal(product.promoPrice||product.price,Number(original.price));
 assert.equal(product.images.length,original.images.length);
 assert.equal(product.sourceVariants.length,original.variants.length);
 original.images.forEach((url,i)=>{assert.equal(product.images[i],manifest[url].url);assert.equal(manifest[url].verified,true);assert.ok(manifest[url].bytes>0);assert.match(product.images[i],/^https:\/\/rwxqytomiorsrxpgtjin\.supabase\.co\/storage\/v1\/object\/public\/product-photos\//)});
 assert.equal(product.importInfo.sourceUrl,original.url);
 if(!product.images.length||product.importInfo.reasons.length)assert.equal(product.active,false);
 assert.equal(product.cost,0);assert.equal(product.importInfo.costPending,true);
}
assert.equal(items.reduce((n,p)=>n+p.product.images.length,0),1719);
assert.equal(items.filter(p=>!p.product.images.length).length,83);
assert.equal(items.reduce((n,p)=>n+p.product.sourceVariants.length,0),328);
assert.equal(read('asset-errors.json').length,0);
if(process.argv.includes('--chunks')){
 const chunks=path.join(folder,'staging');fs.mkdirSync(chunks,{recursive:true});
 for(let start=0;start<items.length;start+=20)fs.writeFileSync(path.join(chunks,String(start/20).padStart(2,'0')+'.json'),JSON.stringify(items.slice(start,start+20).map((item,i)=>({source_product_id:item.sourceId,ordinal:start+i,payload:item.product}))));
}
console.log('Verified: 444 unique products, 1,719 copied photos, 328 variations, 83 photo drafts; source prices and titles preserved.');

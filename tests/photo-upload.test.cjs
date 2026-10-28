const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let width=4000,height=3000,closed=0,uploads=0,failAt=0;
const context=vm.createContext({Blob,Map,Set,console,crypto:require('node:crypto').webcrypto,esc:String,createImageBitmap:async()=>({width,height,close(){closed++}}),document:{createElement:()=>({width:0,height:0,getContext(){return {drawImage(){}}},toBlob(callback,type){callback(new Blob(['encoded-'+this.width+'x'+this.height],{type}))}})},refreshAuth:async()=>{},backendUrl:'https://backend.invalid',backendKey:'public',photoBucket:'product-photos',authSession:{access_token:'test-only'},fetch:async(_url,options)=>{uploads++;assert.equal(options.headers['x-upsert'],'false');assert.match(options.headers['Cache-Control'],/31536000/);return new Response(uploads===failAt?'{}':null,{status:uploads===failAt?402:201})}});
vm.runInContext(fs.readFileSync('media.js','utf8'),context);
const source=fs.readFileSync('enhancements.js','utf8');vm.runInContext(source.slice(source.indexOf('async function uploadProductPhoto'),source.indexOf('\n}',source.indexOf('async function uploadProductPhoto'))+2),context);
const run=code=>vm.runInContext(code,context);context.file=new Blob(['x'.repeat(1000)],{type:'image/jpeg'});
(async()=>{
 const prepared=await run('preparePhotoVariants(file)');assert.equal(prepared.variants.length,4);assert.equal(closed,1);assert.match(prepared.urlPath,/-4000x3000-banner.webp$/);assert.deepEqual(await prepared.variants[3].blob.text(),'encoded-2400x1800');
 assert.match(await run('uploadProductPhoto(file)'),/-banner.webp$/);assert.equal(uploads,4,'Reference is returned after all four uploads');
 uploads=0;failAt=2;await assert.rejects(run('uploadProductPhoto(file)'),/temporariamente indisponível/);assert.equal(uploads,2,'Quota failure stops without returning an incomplete reference');
 width=100;height=100;context.file=new Blob(['x'],{type:'image/webp'});assert.equal(await run('preparePhotoVariants(file)'),null,'Small images that become larger are preserved');
 width=10000;height=10000;await assert.rejects(run('preparePhotoVariants(file)'),/40 megapixels/);assert.equal(closed,5,'Bitmaps are closed on successful, fallback and rejected paths');
 console.log('New photo uploads: WebP variants, size limits, no enlargement, immutable paths, all-files activation, stop on quota, small-original fallback and bitmap cleanup verified.');
})().catch(error=>{console.error(error);process.exitCode=1});

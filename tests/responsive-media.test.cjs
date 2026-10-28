const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {rebaseProducts,rebaseThemeImages}=require('../scripts/publish-optimized-images.cjs');
const context=vm.createContext({console,Map,Set,esc:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),publicMediaUrl:v=>v});
vm.runInContext(fs.readFileSync('media.js','utf8'),context);const run=s=>vm.runInContext(s,context);
const base='https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/';
const original=base+'products/import-forte-20261015/photo.jpg';context.original=original;context.optimized=base+'products/optimized-v1/'+'a'.repeat(64)+'-800x1200-banner.webp';
assert.equal(run("mediaVariant(optimized,'card').width"),427);assert.equal(run("mediaVariant(optimized,'card').height"),640);assert.equal(run("mediaVariant(optimized,'banner').width"),800,'Never upscale');
context.annotated=original+'#media-v1='+'b'.repeat(64)+':800:1200:3';
assert.match(run("mediaVariant(annotated,'thumb').url"),/-thumb.webp$/);assert.equal(run("mediaVariant(annotated,'detail').url"),original,'Larger WebP files keep the existing original');
let markup=run("responsiveMediaAttributes(annotated,'detail',{defer:true})");assert.match(markup,/data-media-src=/);assert.doesNotMatch(markup,/(?:^|\s)src=/);assert.doesNotMatch(markup,/-detail.webp|-banner.webp/,'Never reference profiles that were not uploaded');
markup=run("responsiveMediaAttributes(optimized,'thumb')");assert.equal((markup.match(/\d+w/g)||[]).length,1);assert.match(markup,/loading="lazy"/);
assert.doesNotMatch(run("responsiveMediaAttributes(original,'card')"),/srcset|optimized-v1/,'Legacy images do not guess variant files');
context.small=base+'products/optimized-v1/'+'c'.repeat(64)+'-100x100-banner.webp';assert.equal((run("responsiveMediaAttributes(small,'detail')").match(/100w/g)||[]).length,1,'Duplicate native dimensions have one candidate');
const products=[{id:1,stock:99,price:150,cost:40,image:original,images:[original,'other.jpg'],variations:[{name:'Cor',values:['Azul']}]}],copy=structuredClone(products);
const updated=rebaseProducts(products,new Map([[original,context.annotated]]));assert.deepEqual(products,copy);assert.equal(updated[0].stock,99);assert.equal(updated[0].price,150);assert.equal(updated[0].cost,40);assert.deepEqual(updated[0].variations,copy[0].variations);assert.equal(updated[0].images[1],'other.jpg');
console.log('Responsive media: portrait dimensions, no upscale, deferred gallery, thumbnail candidates, smaller-only variants, legacy fallback, duplicate widths, safe image-only rebase and unchanged prices/stock verified.');

const theme={sections:[{image:original,title:'Title',textColor:'#1c2228',items:[{image:original}]}]};const mapped=rebaseThemeImages(theme,new Map([[original,context.annotated]]));assert.equal(mapped.sections[0].image,context.annotated);assert.equal(mapped.sections[0].items[0].image,context.annotated);assert.equal(mapped.sections[0].title,'Title');assert.equal(theme.sections[0].image,original);

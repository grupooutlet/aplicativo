// Read only public catalog pages; never executes scripts from the source website.
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const root=path.join(__dirname,'..');
const output=path.join(root,'imports','2026-10-15-forte');
const cache=path.join(output,'pages');
fs.mkdirSync(cache,{recursive:true});
function flight(html){
  const chunks=[...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)].map(x=>{try{const a=JSON.parse(x[1]);return a[0]===1&&typeof a[1]==='string'?a[1]:''}catch{return ''}}).join('');
  const bytes=Buffer.from(chunks),records=new Map();let pos=0;
  while(pos<bytes.length){
    if(bytes[pos]===10||bytes[pos]===13){pos++;continue}
    const colon=bytes.indexOf(58,pos);if(colon<0)break;
    if(colon===pos){const end=bytes.indexOf(10,pos);pos=end<0?bytes.length:end+1;continue}
    const id=bytes.subarray(pos,colon).toString();if(!/^[0-9a-f]+$/.test(id))throw new Error('Invalid flight record at '+pos+': '+JSON.stringify(bytes.subarray(pos,Math.min(bytes.length,pos+100)).toString()));
    if(bytes[colon+1]===84){const comma=bytes.indexOf(44,colon+2),length=parseInt(bytes.subarray(colon+2,comma).toString(),16);records.set(id,bytes.subarray(comma+1,comma+1+length).toString());pos=comma+1+length;}
    else{let end=bytes.indexOf(10,colon+1);if(end<0)end=bytes.length;const text=bytes.subarray(colon+1,end).toString();if(/^[\[{"0-9tfn]/.test(text))try{records.set(id,JSON.parse(text))}catch(error){throw new Error('Flight JSON '+id+': '+error.message)}pos=end+1;}
  }
  const resolve=(value,depth=0)=>{
    if(depth>30)return value;
    if(typeof value==='string'){
      if(value==='$undefined')return undefined;
      const m=value.match(/^\$([0-9a-f]+)((?::[^:]+)*)$/);if(m&&records.has(m[1])){let v=records.get(m[1]);for(const key of m[2].split(':').slice(1)){v=Array.isArray(v)&&key==='props'?v[3]:v?.[key]}return resolve(v,depth+1)}
    }
    return value;
  };
  const objects=[];const walk=x=>{if(!x||typeof x!=='object')return;objects.push(x);Object.values(x).forEach(walk)};for(const x of records.values())walk(x);
  return {records,resolve,objects};
}
function extract(html,url){
  const f=flight(html),objects=f.objects;
  const details=objects.find(o=>o.productId&&Object.hasOwn(o,'basePrice')&&o.productName);
  const structured=objects.filter(o=>o.type==='application/ld+json'&&o.dangerouslySetInnerHTML).map(o=>{try{return JSON.parse(f.resolve(o.dangerouslySetInnerHTML.__html))}catch{return null}}).filter(Boolean);
  const schema=structured.find(o=>o['@type']==='Product');
  if(!details||!schema)throw new Error('Missing product detail/schema: '+url);
  const gallery=objects.find(o=>Array.isArray(o.productImages)&&Array.isArray(o.variations));
  const images=f.resolve(details.productImages)||gallery?.productImages;
  const variants=f.resolve(details.variations)||gallery?.variations;
  const description=objects.flatMap(o=>[o.description,o.dangerouslySetInnerHTML&&!o.type?o.dangerouslySetInnerHTML.__html:null]).map(value=>f.resolve(value)).filter(x=>typeof x==='string'&&x.length>0);
  const categoryView=objects.find(o=>Array.isArray(o.categoryPath)&&o.productName===details.productName);
  const categories=(categoryView?.categoryPath||[]).map(f.resolve).map(o=>({id:o?.id,name:o?.nome}));
  return {sourceId:details.productId,url,title:f.resolve(details.productName),descriptionHtml:description.sort((a,b)=>b.length-a.length)[0]||'',descriptionText:schema.description||'',category:schema.category||categories.at(-1)?.name||null,categoryPath:categories,price:details.basePrice,compareAtPrice:details.fullPrice,images:images.map(value=>f.resolve(value)),variants,stockInfo:details.stockInfo,moq:details.moq,priceOnRequest:details.priceOnRequest,sourceSku:f.resolve(objects.find(o=>Object.hasOwn(o,'productSku'))?.productSku)||null,schema};
}
const name=url=>{const u=new URL(url);if(u.origin!=='https://www.forteoutlet.com.br')throw new Error('Unexpected source host');return u.pathname==='/'?'home.html':u.pathname.slice(1).replaceAll('/','_')+'.html'};
async function download(url){const file=path.join(cache,name(url));if(fs.existsSync(file))return;for(let attempt=0;attempt<3;attempt++){try{await new Promise((resolve,reject)=>execFile('curl.exe',['-L','--fail','--silent','--show-error','--max-time','60','--output',file,url],{maxBuffer:1024*1024,windowsHide:true},(err,stdout,stderr)=>err?reject(new Error(stderr||err.message)):resolve()));return}catch(error){if(fs.existsSync(file))fs.unlinkSync(file);if(attempt===2)throw error;await new Promise(r=>setTimeout(r,500*(attempt+1)))}}}
async function main(){
  const urls=[...fs.readFileSync(path.join(root,'source-sitemap.xml'),'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
  const sourceProducts=urls.filter(x=>x.includes('/produto/'));
  if(process.argv.includes('--fetch')){let next=0,done=0;const errors=[];await Promise.all(Array.from({length:6},async()=>{while(next<urls.length){const url=urls[next++];try{await download(url)}catch(error){errors.push({url,error:error.message})}done++;if(done%25===0||done===urls.length)console.log(JSON.stringify({downloaded:done,total:urls.length,errors:errors.length}));}}));fs.writeFileSync(path.join(output,'download-errors.json'),JSON.stringify(errors,null,2));if(errors.length)throw new Error('Some public pages could not be read.');}
  const items=sourceProducts.map(url=>extract(fs.readFileSync(path.join(cache,name(url)),'utf8'),url));
  if(items.length!==444||new Set(items.map(x=>x.sourceId)).size!==444)throw new Error('Catalog coverage is not 444 unique products');
  fs.writeFileSync(path.join(output,'source-products.json'),JSON.stringify(items,null,2));
  const categories={};for(const item of items)categories[item.category||'Sem categoria']=(categories[item.category||'Sem categoria']||0)+1;
  const stats={products:items.length,categories,images:items.reduce((n,p)=>n+p.images.length,0),variants:items.reduce((n,p)=>n+p.variants.length,0),withoutImages:items.filter(p=>!p.images.length).map(p=>p.sourceId),withoutDescription:items.filter(p=>!p.descriptionHtml&&!p.descriptionText).map(p=>p.sourceId),multiVariant:items.filter(p=>p.variants.length>1).map(p=>({id:p.sourceId,title:p.title,variants:p.variants.length})),maxImages:Math.max(...items.map(p=>p.images.length))};
  fs.writeFileSync(path.join(output,'source-summary.json'),JSON.stringify(stats,null,2));console.log(JSON.stringify(stats,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={flight,extract};

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..'),folder=path.join(root,'imports','2026-10-15-forte');
const batchId='forte-catalog-20261015-v1';
const canonical=title=>String(title).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/cappucc?ino|cappucino/g,'capuccino').replace(/(\d+)[.,](\d+)\s*m?/g,(_,a,b)=>String(Number(a+'.'+b))+'m')
 .replace(/\b(e|de|da|do|com)\b/g,' ').replace(/[^a-z0-9]/g,'');
function plainText(html){
 const entities={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',ndash:'–',mdash:'—',bull:'•',times:'×',deg:'°',reg:'®',copy:'©'};
 return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>/gi,'\n').replace(/<li\b[^>]*>/gi,'• ').replace(/<[^>]+>/g,'')
 .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,x)=>{if(x[0]==='#'){const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1));return n<=0x10ffff?String.fromCodePoint(n):all}return entities[x.toLowerCase()]??all})
 .replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
const categoryMap={'Sofás':'Sofás','Mesas':'Mesas e cadeiras','Roupeiros':'Guarda-roupas','Cama/Colchões':'Camas e colchões','Painel/Rack/Home':'Painéis e racks','Poltronas':'Poltronas','Sofás por menos de R$997,00':'Sofás por menos de R$ 997,00'};
function category(product){const title=product.title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(/^(?:o conjunto )?mesa\b/.test(title))return 'Mesas e cadeiras';if(/^camas?\b/.test(title))return 'Camas e colchões';if(categoryMap[product.category])return categoryMap[product.category];if(/impermeabiliza|lavagem/.test(title))return 'Serviços';if(/cozinha/.test(title))return 'Cozinhas';if(/poltrona/.test(title))return 'Poltronas';if(/guarda.?roup|roupeiro/.test(title))return 'Guarda-roupas';if(/cadeira|mesa/.test(title))return 'Mesas e cadeiras';if(!/sofa/.test(title)&&/unibox|colchao|colchoes|cama/.test(title))return 'Camas e colchões';return 'Sofás';}
const attributeName=value=>value==='Medida'?'Tamanho':value.trim().replace(/\s+/g,' ');
function attributeValue(name,value){value=value.trim();if(name==='Cor')return value.charAt(0).toLocaleUpperCase('pt-BR')+value.slice(1);if(name==='Tamanho'&&/^\d+[.,]\d+$/.test(value))return value.replace('.',',')+'m';if(name==='Tamanho'&&/^\d+[.,]\d+x\d+[.,]\d+$/.test(value))return value+'m';return value;}
function prepare(source,existing,manifest){
 const seen=new Map(),items=[];
 for(const product of source){
  if(!Number.isSafeInteger(product.sourceId)||!product.title||!(Number(product.price)>0))throw new Error('Invalid source product '+product.sourceId);
  const fingerprint=canonical(product.title);
  const duplicates=existing.products.filter(p=>{const prior=canonical(p.name);return prior===fingerprint||(Math.min(prior.length,fingerprint.length)>30&&(prior.startsWith(fingerprint)||fingerprint.startsWith(prior)))}).map(p=>p.id);
  const duplicateSource=seen.get(fingerprint);seen.set(fingerprint,product.sourceId);
  const reasons=[];if(duplicates.length||duplicateSource)reasons.push('duplicate');if(!product.images.length)reasons.push('missing_photos');if(product.title.length>200)reasons.push('source_title_review');
  const options=new Map();
  const variants=product.variants.map(v=>{
   const selected={};for(const attr of v.produto_variacao_valor){const a=attr.atributo_valor,name=attributeName(a.atributos.nome),value=attributeValue(name,a.valor);if(!options.has(name))options.set(name,[]);if(!options.get(name).includes(value))options.get(name).push(value);selected[name]=value;}
   return {sourceId:v.id,name:v.nome,options:selected,price:Number(v.preco),regularPrice:v.preco_cheio,sku:v.codigo_produto||null,stock:Number(v.stock_info?.quantidade_atual||0),trackStock:v.controlar_estoque!==false};
  });
  if(new Set(variants.map(v=>v.price)).size>1)throw new Error('Variation prices need a separate pricing implementation: '+product.sourceId);
  const images=product.images.map(url=>{if(!manifest[url]?.verified)throw new Error('Missing verified copy of '+url);return manifest[url].url;});
  const regular=Number(product.compareAtPrice)>Number(product.price)?Number(product.compareAtPrice):Number(product.price);
  const sourceStock=variants.length?variants.reduce((n,v)=>n+v.stock,0):Number(product.stockInfo?.currentStock||0);
  const item={name:product.title.trim(),description:plainText(product.descriptionHtml)||product.descriptionText.trim(),category:category(product),price:regular,promoPrice:regular>Number(product.price)?Number(product.price):null,cost:0,stock:Math.max(0,Math.trunc(sourceStock)),min:Math.max(0,Number(product.stockInfo?.minStock||0)),active:reasons.length===0,image:images[0]||'',images,variations:[...options].map(([name,values])=>({name,values})),sourceVariants:variants,
   importInfo:{batchId,sourceId:product.sourceId,sourceUrl:product.url,sourceCategory:product.category,categoryInferred:!product.category,sourceSku:product.sourceSku,sourceImageCount:product.images.length,sourceStockTracking:product.stockInfo?.enabled!==false,sourceDescriptionHtml:product.descriptionHtml,reasons,duplicateOf:duplicates,duplicateSourceId:duplicateSource||null,costPending:true}};
  if(item.variations.length>5||item.variations.some(a=>a.values.length>30))throw new Error('Attribute limit exceeded');
  items.push({sourceId:product.sourceId,product:item});
 }
 return items;
}
function main(){
 const source=JSON.parse(fs.readFileSync(path.join(folder,'source-products.json'),'utf8'));
 const snapshotArgument=process.argv.find(value=>value.startsWith('--snapshot='));
 const existing=JSON.parse(fs.readFileSync(snapshotArgument?snapshotArgument.slice('--snapshot='.length):path.join(folder,'existing-products-backup.local'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'asset-manifest.json'),'utf8'));
 const items=prepare(source,existing,manifest);if(items.length!==444)throw new Error('Expected all 444 source products');
 const json=JSON.stringify(items);fs.writeFileSync(path.join(folder,'import-items.json'),json);
 const report={batchId,source:'https://www.forteoutlet.com.br/',products:items.length,active:items.filter(x=>x.product.active).length,drafts:items.filter(x=>!x.product.active).length,duplicateDrafts:items.filter(x=>x.product.importInfo.reasons.includes('duplicate')).length,missingPhotoDrafts:items.filter(x=>x.product.importInfo.reasons.includes('missing_photos')).length,titleReviewDrafts:items.filter(x=>x.product.importInfo.reasons.includes('source_title_review')).length,images:items.reduce((n,x)=>n+x.product.images.length,0),copiedImages:Object.keys(manifest).length,variants:items.reduce((n,x)=>n+x.product.sourceVariants.length,0),categories:items.reduce((counts,x)=>(counts[x.product.category]=(counts[x.product.category]||0)+1,counts),{}),sha256:crypto.createHash('sha256').update(json).digest('hex'),duplicates:items.filter(x=>x.product.importInfo.reasons.includes('duplicate')).map(x=>({sourceId:x.sourceId,name:x.product.name,existingIds:x.product.importInfo.duplicateOf,sourceDuplicate:x.product.importInfo.duplicateSourceId})),reviews:items.filter(x=>!x.product.active).map(x=>({sourceId:x.sourceId,name:x.product.name,reasons:x.product.importInfo.reasons}))};
 fs.writeFileSync(path.join(folder,'import-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,duplicates:report.duplicates.length,reviews:report.reviews.length},null,2));
}
if(require.main===module)main();module.exports={prepare,plainText,canonical,category};

// Activate immutable variants only after every declared file has been uploaded.
const mediaProfiles = {thumb:160,card:640,detail:1280,banner:2400};
function mediaVariant(value, profile='detail') {
  const raw=String(value||'')||'assets/product-placeholder.svg';
  const stored=raw.match(/^(https:\/\/rwxqytomiorsrxpgtjin\.supabase\.co\/storage\/v1\/object\/public\/product-photos\/(?:products|storefront)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpe?g|png|webp))#media-v1=([a-f0-9]{64}):(\d+):(\d+):(\d+)$/i);
  if(stored&&mediaProfiles[profile]){
    const width=Number(stored[3]),height=Number(stored[4]),mask=Number(stored[5]),bit=Object.keys(mediaProfiles).indexOf(profile);
    if(width&&height&&width*height<=40000000&&mask>0&&mask<16){
      const optimized=!!(mask&(1<<bit)),scale=optimized?Math.min(1,mediaProfiles[profile]/Math.max(width,height)):1;
      const url=optimized?'https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/products/optimized-v1/'+stored[2]+'-'+width+'x'+height+'-'+profile+'.webp':stored[1];
      return {url:typeof publicMediaUrl==='function'?publicMediaUrl(url):url,width:Math.max(1,Math.floor(width*scale+.5)),height:Math.max(1,Math.floor(height*scale+.5))};
    }
  }
  const match=raw.match(/^(https:\/\/rwxqytomiorsrxpgtjin\.supabase\.co\/storage\/v1\/object\/public\/product-photos\/(?:products|storefront)\/optimized-v1\/[a-f0-9]{64})-(\d+)x(\d+)-(?:thumb|card|detail|banner)\.webp$/);
  if(!match||!mediaProfiles[profile])return {url:typeof publicMediaUrl==='function'?publicMediaUrl(raw):raw};
  const width=Number(match[2]),height=Number(match[3]);
  if(!width||!height||width*height>40000000)return {url:raw};
  const scale=Math.min(1,mediaProfiles[profile]/Math.max(width,height));
  const url=match[1]+'-'+width+'x'+height+'-'+profile+'.webp';
  return {url:typeof publicMediaUrl==='function'?publicMediaUrl(url):url,width:Math.max(1,Math.floor(width*scale+.5)),height:Math.max(1,Math.floor(height*scale+.5))};
}
function responsiveMediaAttributes(value, role='card', options={}) {
  const selected=mediaVariant(value,role),prefix=options.defer?'data-media-':'';
  let attrs='';
  if(selected.width){
    const profiles=role==='thumb'?['thumb']:role==='card'?['thumb','card','detail']:['card','detail','banner'];
    const candidates=new Map();for(const profile of profiles){const item=mediaVariant(value,profile);if(!candidates.has(item.width))candidates.set(item.width,item.url)}
    const sizes=role==='thumb'?'80px':role==='card'?'(max-width: 600px) 46vw, (max-width: 1000px) 30vw, 320px':role==='banner'?'100vw':'(max-width: 700px) 100vw, (max-width: 1100px) 55vw, 680px';
    attrs+=`${prefix}sizes="${esc(sizes)}" ${prefix}srcset="${esc([...candidates].map(([w,url])=>url+' '+w+'w').join(', '))}" `;
    if(options.dimensions!==false)attrs+=`width="${selected.width}" height="${selected.height}" `;
  }
  return attrs+`${prefix}src="${esc(selected.url)}" loading="${options.eager?'eager':'lazy'}" decoding="async"${options.eager?' fetchpriority="high"':''}`;
}
async function preparePhotoVariants(file, folder='products') {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>7*1024*1024)throw Error('Envie uma foto JPG, PNG ou WebP de até 7 MB.');
  if(typeof createImageBitmap!=='function'||typeof crypto?.subtle?.digest!=='function')return null;
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  try {
    const {width,height}=bitmap;if(!width||!height||width*height>40000000)throw Error('A imagem tem dimensões muito grandes. Use uma foto com até 40 megapixels.');
    const variants=[],sameSize=new Map();
    for(const [profile,maximum] of Object.entries(mediaProfiles)){
      const scale=Math.min(1,maximum/Math.max(width,height)),w=Math.max(1,Math.floor(width*scale+.5)),h=Math.max(1,Math.floor(height*scale+.5)),key=w+'x'+h;
      let blob=sameSize.get(key);
      if(!blob){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const context=canvas.getContext('2d');if(!context)return null;context.drawImage(bitmap,0,0,w,h);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.92));if(!blob||blob.type!=='image/webp')return null;sameSize.set(key,blob)}
      variants.push({profile,blob});
    }
    // Avoid making tiny, already compressed images larger.
    if(variants.find(v=>v.profile==='banner').blob.size>=file.size&&Math.max(width,height)<=1280)return null;
    const master=variants.find(v=>v.profile==='banner').blob;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await master.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
    const base=(folder==='storefront'?'storefront':'products')+'/optimized-v1/'+digest+'-'+width+'x'+height;
    for(const variant of variants)variant.path=base+'-'+variant.profile+'.webp';
    return {variants,urlPath:base+'-banner.webp'};
  } finally {bitmap.close()}
}

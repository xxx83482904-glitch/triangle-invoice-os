self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('akira-cooking-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
async function cached(url,request){
 const cache=await caches.open(CACHE),hit=await cache.match(url);
 if(hit)return hit;
 const response=await fetch(request||url);
 if(response.ok&&!response.redirected)await cache.put(url,response.clone());
 return response;
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'&&url.pathname.startsWith('/akira-kitchen/')){
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match('/akira-kitchen/index.html'))||fetch(event.request)));return;
 }
 if(!ASSETS.includes(url.pathname))return;
 event.respondWith(cached(url.pathname,event.request));
});
let warming;
self.addEventListener('message',event=>{
 if(event.data?.type!=='WARM_KITCHEN')return;
 warming??=(async()=>{
  const remaining=ASSETS.filter(url=>!PRECACHE.includes(url));let index=0;
  const lane=async()=>{while(index<remaining.length){const url=remaining[index++];try{const response=await cached(url);if(!response.ok)return false;}catch{return false;}}return true;};
  const results=await Promise.all([lane(),lane()]);
  if(results.every(Boolean))for(const client of await self.clients.matchAll())client.postMessage({type:'KITCHEN_OFFLINE_READY'});
  return results.every(Boolean);
 })().then(ok=>{if(!ok)warming=null;return ok;});
 event.waitUntil(warming);
});

// Network-first, so deploys show up without bumping this. Bump it only to drop old cached files.
const CACHE='gangarapu-garden-v2.0.0';
const SHELL=['./','./index.html','./app.css','./app.js','./logic.js','./store.js','./data/plants.json','./data/guides.json','./manifest.webmanifest','./icons/icon.svg','./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(SHELL.map(async path=>{
    const request=new Request(new URL(path,self.registration.scope),{credentials:'same-origin',redirect:'manual'});
    const response=await fetch(request);
    if(response.ok&&response.type==='basic')await cache.put(request,response);
  }));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gangarapu-garden-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/cdn-cgi/'))return;
  url.search='';url.hash='';
  if(!SHELL.some(path=>new URL(path,self.registration.scope).href===url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);let timer;
    const network=fetch(event.request).then(async response=>{
      if(response.ok&&response.type==='basic')try{await cache.put(url.href,response.clone());}catch{}
      return response;
    });
    // A late successful response can still refresh the cache after the timeout.
    event.waitUntil(network.catch(()=>{}));
    try{return await Promise.race([network,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Network timeout')),4000);})]);}
    catch(error){const cached=await cache.match(url.href);if(cached)return cached;throw error;}
    finally{clearTimeout(timer);}
  })());
});

/* Service Worker: nur statische Skripte/Styles zwischenspeichern (Netz zuerst). HTML und API gehen nie über den Cache,
   damit Login-Umleitungen und Daten immer frisch sind. */
const C="aio-v8";
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin||e.request.mode==="navigate"||u.pathname.includes("/api/"))return;
  if(!/\.(js|css|svg|webmanifest)$/.test(u.pathname))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok&&!r.redirected){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request)))});

"use strict";
/* ---------- Großansicht (Bilder, Diagramme, Charts, Studio-Vorschau) ---------- */
const VW={items:[],i:0,z:1,x:0,y:0,fit:1,nw:0,nh:0,ptr:new Map(),pinch:0};
function vwRoot(){
  let e=document.getElementById("vw");if(e)return e;
  e=document.createElement("div");e.id="vw";e.setAttribute("role","dialog");e.setAttribute("aria-label","Großansicht");
  e.innerHTML='<div class="bar"><span class="ttl"></span><button data-a="out" title="Verkleinern (−)">−</button><button data-a="fit" title="Einpassen (0)">⤢</button><button data-a="one" title="Originalgröße (1)">1:1</button><button data-a="in" title="Vergrößern (+)">+</button><button data-a="dl" title="Herunterladen">⬇</button><button data-a="tab" title="In neuem Tab öffnen">↗</button><button data-a="x" title="Schließen (Esc)">✕</button></div><div class="stage"></div><button class="nv l" data-a="prev" title="Zurück (←)">‹</button><button class="nv r" data-a="next" title="Weiter (→)">›</button><span class="cnt"></span>';
  document.body.appendChild(e);
  const st=e.querySelector(".stage");
  e.addEventListener("click",ev=>{const a=ev.target.closest("[data-a]")?.dataset.a;if(a)vwAct(a);else if(ev.target===st&&VW.items[VW.i]?.kind!=="html"&&!VW.moved)vwClose()});
  st.addEventListener("wheel",ev=>{if(VW.items[VW.i]?.kind!=="img")return;ev.preventDefault();vwZoomAt(Math.exp(-ev.deltaY*.0016),ev.clientX,ev.clientY)},{passive:false});
  st.addEventListener("dblclick",()=>vwAct(Math.abs(VW.z-VW.fit)<.01?"one":"fit"));
  st.addEventListener("pointerdown",ev=>{if(VW.items[VW.i]?.kind!=="img")return;st.setPointerCapture(ev.pointerId);VW.ptr.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});VW.moved=false;st.classList.add("drag");
    if(VW.ptr.size===2)VW.pinch=vwDist()});
  st.addEventListener("pointermove",ev=>{const p=VW.ptr.get(ev.pointerId);if(!p)return;
    if(VW.ptr.size===2){VW.ptr.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});const d=vwDist();if(VW.pinch){const [a,b]=[...VW.ptr.values()];vwZoomAt(d/VW.pinch,(a.x+b.x)/2,(a.y+b.y)/2)}VW.pinch=d;return}
    const dx=ev.clientX-p.x,dy=ev.clientY-p.y;if(Math.abs(dx)+Math.abs(dy)>2)VW.moved=true;VW.x+=dx;VW.y+=dy;VW.ptr.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});vwApply()});
  const up=ev=>{VW.ptr.delete(ev.pointerId);VW.pinch=0;if(!VW.ptr.size){st.classList.remove("drag");setTimeout(()=>VW.moved=false,0)}};
  st.addEventListener("pointerup",up);st.addEventListener("pointercancel",up);
  addEventListener("resize",()=>{if(e.classList.contains("on"))vwFit()});
  return e}
const vwDist=()=>{const [a,b]=[...VW.ptr.values()];return Math.hypot(a.x-b.x,a.y-b.y)};
function vwApply(){const im=document.querySelector("#vw .stage img");if(im)im.style.transform=`translate(${VW.x}px,${VW.y}px) scale(${VW.z})`}
function vwFit(){const st=document.querySelector("#vw .stage"),im=st.querySelector("img");if(!im||!VW.nw)return;
  VW.fit=Math.min(st.clientWidth/VW.nw,st.clientHeight/VW.nh)*.94;VW.z=VW.fit;VW.x=VW.y=0;vwApply()}
function vwZoomAt(f,cx,cy){const st=document.querySelector("#vw .stage"),r=st.getBoundingClientRect(),px=cx-(r.left+r.width/2),py=cy-(r.top+r.height/2);
  const nz=Math.min(Math.max(VW.z*f,VW.fit*.2),Math.max(VW.fit*12,8)),k=nz/VW.z;VW.x=px-(px-VW.x)*k;VW.y=py-(py-VW.y)*k;VW.z=nz;vwApply()}
function vwShow(){
  const e=vwRoot(),st=e.querySelector(".stage"),it=VW.items[VW.i],html=it.kind==="html";
  e.querySelector(".ttl").textContent=it.title||"";
  e.querySelectorAll('[data-a="out"],[data-a="in"],[data-a="fit"],[data-a="one"]').forEach(b=>b.style.display=html?"none":"");
  e.querySelectorAll(".nv").forEach(b=>b.style.display=VW.items.length>1?"":"none");
  e.querySelector(".cnt").style.display=VW.items.length>1?"":"none";e.querySelector(".cnt").textContent=`${VW.i+1} / ${VW.items.length}`;
  st.innerHTML="";VW.nw=VW.nh=0;
  if(html){const f=document.createElement("iframe");f.setAttribute("sandbox","allow-scripts allow-forms allow-modals allow-popups");f.srcdoc=it.html;st.appendChild(f)}
  else{const im=new Image();im.draggable=false;im.alt=it.title||"";im.onload=()=>{VW.nw=im.naturalWidth||300;VW.nh=im.naturalHeight||150;vwFit()};im.src=it.src;st.appendChild(im)}}
function openViewer(items,i=0){VW.items=items;VW.i=Math.max(0,i);const e=vwRoot();e.classList.add("on");document.body.style.overflow="hidden";vwShow()}
function vwClose(){const e=document.getElementById("vw");if(e)e.classList.remove("on");document.body.style.overflow="";const st=e&&e.querySelector(".stage");if(st)st.innerHTML=""}
async function downloadUrl(src,name){
  try{const a=document.createElement("a");let href=src;
    if(!/^(data|blob):/.test(src)){const r=await fetch(src);if(!r.ok)throw 0;href=URL.createObjectURL(await r.blob())}
    a.href=href;a.download=name||"download";document.body.appendChild(a);a.click();a.remove()}
  catch{window.open(src,"_blank","noopener");toast("Download nicht direkt möglich – Bild in neuem Tab geöffnet (Rechtsklick → Speichern)")}}
function vwAct(a){
  const it=VW.items[VW.i],st=document.querySelector("#vw .stage"),r=st.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  if(a==="x")vwClose();
  else if(a==="in")vwZoomAt(1.3,cx,cy);else if(a==="out")vwZoomAt(1/1.3,cx,cy);
  else if(a==="fit")vwFit();
  else if(a==="one"){VW.z=1;VW.x=VW.y=0;vwApply()}
  else if(a==="prev"||a==="next"){VW.i=(VW.i+(a==="next"?1:-1)+VW.items.length)%VW.items.length;vwShow()}
  else if(a==="dl"){if(it.kind==="html")dl(new Blob([it.html],{type:"text/html"}),"app.html");else downloadUrl(it.src,it.name)}
  else if(a==="tab"){if(it.kind==="html")window.open(URL.createObjectURL(new Blob([it.html],{type:"text/html"})),"_blank");else window.open(it.src,"_blank","noopener")}}
document.addEventListener("keydown",e=>{const o=document.getElementById("vw");if(!o||!o.classList.contains("on"))return;
  const k=e.key;if(k==="Escape")vwClose();else if(k==="ArrowRight")vwAct("next");else if(k==="ArrowLeft")vwAct("prev");
  else if(k==="+"||k==="=")vwAct("in");else if(k==="-")vwAct("out");else if(k==="0")vwAct("fit");else if(k==="1")vwAct("one");else return;e.preventDefault()});
/* Inhalte in Viewer-Einträge umwandeln */
const svgItem=(svg,title)=>{const c=svg.cloneNode(true),r=svg.getBoundingClientRect();c.setAttribute("xmlns","http://www.w3.org/2000/svg");
  c.setAttribute("width",Math.round(r.width*2));c.setAttribute("height",Math.round(r.height*2));c.style.maxWidth="none";c.style.background="#fff";
  return{kind:"img",src:"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(new XMLSerializer().serializeToString(c)),title,name:"diagramm.svg"}};
const canvasItem=(cv,title)=>{const t=document.createElement("canvas");t.width=cv.width;t.height=cv.height;const g=t.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,t.width,t.height);g.drawImage(cv,0,0);
  return{kind:"img",src:t.toDataURL("image/png"),title,name:"diagramm.png"}};
const imgItems=(imgs,prefix)=>imgs.map((m,k)=>({kind:"img",src:m.currentSrc||m.src,title:m.alt||"",name:`${prefix}-${k+1}.${/^data:image\/png/.test(m.src)?"png":"jpg"}`}));
document.addEventListener("click",e=>{
  const t=e.target;if(!(t instanceof Element)||t.closest("#vw"))return;
  let m;
  if((m=t.closest(".card img"))){const all=[...document.querySelectorAll("#igrid .card img")];openViewer(imgItems(all,"mercyverse-bild"),all.indexOf(m))}
  else if((m=t.closest(".msg .body img"))){const all=[...m.closest(".body").querySelectorAll("img")];openViewer(imgItems(all,"anhang"),all.indexOf(m))}
  else if((m=t.closest(".att img"))){const all=[...document.querySelectorAll(".att img")];openViewer(imgItems(all,"anhang"),all.indexOf(m))}
  else if((m=t.closest("#dgOut svg")))openViewer([svgItem(m,$("#dgIn").value.slice(0,60)||"Diagramm")],0);
  else if(t.id==="chCv")openViewer([canvasItem(t,"Diagramm")],0);
  else if(t.closest("#pFull"))openViewer([{kind:"html",html:bundle()||"<body style='font-family:system-ui;color:#888'>Noch keine Vorschau</body>",title:"Studio-Vorschau"}],0)});

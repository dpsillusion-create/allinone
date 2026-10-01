"use strict";
/* ---------- Bilder ---------- */
function drawImages(){$("#igrid").innerHTML=S.images.map((im,i)=>`<div class="card"><img loading="lazy" src="${im.url}" alt="${esc(im.p)}" title="Klicken zum Vergrößern"><div><span title="${esc(im.p)}">${esc(im.p.slice(0,32))}</span><button data-dl="${i}" title="Herunterladen" style="padding:0 6px">⬇</button><button data-rm="${i}" style="padding:0 6px">✕</button></div></div>`).join("")}
$("#igrid").onclick=e=>{const r=e.target.closest("[data-rm]"),d=e.target.closest("[data-dl]");
  if(r){S.images.splice(+r.dataset.rm,1);save();drawImages()}
  else if(d)downloadUrl(S.images[+d.dataset.dl].url,"mercyverse-bild.jpg")};
/** Midjourney-Parameter (--ar 16:9, --v 6 …) auswerten: Format übernehmen, Parameter aus dem Prompt entfernen */
function parseImagePrompt(p){
  let size=null;const m=p.match(/\s--(?:ar|aspect)\s+(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)/i);
  if(m){const a=+m[1],b=+m[2];if(a>0&&b>0){const r=v=>Math.max(256,Math.round(v/64)*64);size=a>=b?[1344,r(1344*b/a)]:[r(1344*a/b),1344]}p=p.replace(m[0],"")}
  p=p.replace(/\s--(?:v|q|s|stylize|style|chaos|c|niji)\s+\S+/gi,"").trim();
  return{p,size}}
$("#iGo").onclick=async()=>{let p=$("#ip").value.trim();if(!p)return;const btn=$("#iGo");btn.disabled=true;btn.textContent="Erzeuge…";
  try{if($("#iEnh").checked){try{p=(await ask1([{role:"system",content:"Schreibe aus der Idee einen detaillierten englischen Bild-Prompt (max. 60 Wörter). Antworte NUR mit dem Prompt."},{role:"user",content:p}])).trim()}catch{}}
    const pp=parseImagePrompt(p);p=pp.p;const [w,h]=pp.size||$("#iSize").value.split("x");const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=${w}&height=${h}&model=${$("#iModel").value}&seed=${Math.floor(Math.random()*1e6)}&nologo=true`;
    S.images.unshift({url,p});S.images=S.images.slice(0,40);save();drawImages()}finally{btn.disabled=false;btn.textContent="Bild erzeugen"}};

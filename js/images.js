"use strict";
/* ---------- Bilder ---------- */
function drawImages(){$("#igrid").innerHTML=S.images.map((im,i)=>`<div class="card"><img loading="lazy" src="${im.url}" alt="${esc(im.p)}"><div><span title="${esc(im.p)}">${esc(im.p.slice(0,32))}</span><a href="${im.url}" target="_blank" rel="noopener" download>⬇</a><button data-rm="${i}" style="padding:0 6px">✕</button></div></div>`).join("")}
$("#igrid").onclick=e=>{const r=e.target.closest("[data-rm]");if(r){S.images.splice(+r.dataset.rm,1);save();drawImages()}};
$("#iGo").onclick=async()=>{let p=$("#ip").value.trim();if(!p)return;const btn=$("#iGo");btn.disabled=true;btn.textContent="Erzeuge…";
  try{if($("#iEnh").checked){try{p=(await ask1([{role:"system",content:"Schreibe aus der Idee einen detaillierten englischen Bild-Prompt (max. 60 Wörter). Antworte NUR mit dem Prompt."},{role:"user",content:p}])).trim()}catch{}}
    const [w,h]=$("#iSize").value.split("x");const url=`https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=${w}&height=${h}&model=${$("#iModel").value}&seed=${Math.floor(Math.random()*1e6)}&nologo=true`;
    S.images.unshift({url,p});S.images=S.images.slice(0,40);save();drawImages()}finally{btn.disabled=false;btn.textContent="Bild erzeugen"}};

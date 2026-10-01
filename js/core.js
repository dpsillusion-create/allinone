"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const LS={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function toast(t){const e=$("#toast");e.textContent=t;e.style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display="none",1800)}
const copy=t=>{const ok=()=>toast("Kopiert ✔"),fb=()=>{try{const a=document.createElement("textarea");a.value=t;a.style.cssText="position:fixed;opacity:0";document.body.appendChild(a);a.select();const r=document.execCommand("copy");a.remove();r?ok():toast("Kopieren nicht möglich")}catch{toast("Kopieren nicht möglich")}};
  navigator.clipboard?navigator.clipboard.writeText(t).then(ok,fb):fb()};

/* ---------- Zustand ---------- */
let S=Object.assign({chats:[],cur:null,model:"openai-fast",sys:"Du bist ein hilfreicher, präziser KI-Assistent. Antworte in der Sprache des Nutzers.",speak:false,images:[]},LS.get("aio",{}));
const save=()=>LS.set("aio",{...S,chats:S.chats.map(c=>({...c,msgs:c.msgs.map(({imgs,...m})=>m)}))});
let studioMsgs=[], lastHtml="", ctrl=null;
const STUDIO_SYS="Du bist ein Webentwickler. Antworte sehr kurz (1-2 Sätze) und liefere das Projekt als Dateien. Jede Datei: eine Zeile `FILE: dateiname` und direkt darunter ein Codeblock mit dem VOLLSTÄNDIGEN Inhalt. Einstiegspunkt ist immer index.html; CSS/JS dürfen als style.css / script.js getrennt sein (in index.html per <link href=\"style.css\"> bzw. <script src=\"script.js\"> einbinden) oder inline stehen. Keine Build-Tools; externe Bibliotheken nur per CDN. Gib bei Änderungen NUR die geänderten Dateien vollständig zurück.";

/* ---------- Navigation ---------- */
const titles={chat:"Chat",studio:"Studio – Live-Vorschau",images:"Bildgenerator",write:"Schreibwerkstatt",voice:"Sprache",diagram:"Diagramme & Mindmaps",data:"Daten & Charts",compare:"Modell-Vergleich"};
function show(v){$$(".view").forEach(e=>e.classList.toggle("on",e.id==="v-"+v));$$(".nav").forEach(b=>b.classList.toggle("on",b.dataset.v===v));$("#title").textContent=titles[v];$("#side").classList.remove("open")}
$$(".nav[data-v]").forEach(b=>b.onclick=()=>show(b.dataset.v));
$("#openPA").onclick=()=>window.open("prompt.html","aioPrompt","width=480,height=760,resizable=yes");
addEventListener("message",e=>{if((location.protocol!=="file:"&&e.origin!==location.origin)||e.data?.type!=="aio-prompt")return;const t=e.data.text||"";
  if(e.data.target==="image"){show("images");$("#ip").value=t}else if(e.data.target==="code"){show("studio");$("#sinp").value=t;$("#sinp").focus()}else{show("chat");$("#inp").value=t;$("#inp").focus()}toast("Prompt übernommen ✔")});
$("#burger").onclick=()=>$("#side").classList.toggle("open");

/* ---------- Markdown ---------- */
function md(src){
  const blocks=[];
  src=src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g,(_,l,c)=>{blocks.push({l,c:c.replace(/\n$/,"")});return `\u0000${blocks.length-1}\u0000`});
  let h=esc(src).replace(/^### (.*)$/gm,"<h4>$1</h4>").replace(/^## (.*)$/gm,"<h3>$1</h3>").replace(/^# (.*)$/gm,"<h2>$1</h2>")
    .replace(/\*\*([^*\n]+)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<i>$2</i>").replace(/`([^`\n]+)`/g,"<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^(?:[-*] .*(?:\n|$))+/gm,m=>"<ul>"+m.trim().split("\n").map(x=>"<li>"+x.slice(2)+"</li>").join("")+"</ul>")
    .replace(/^(?:\d+\. .*(?:\n|$))+/gm,m=>"<ol>"+m.trim().split("\n").map(x=>"<li>"+x.replace(/^\d+\. /,"")+"</li>").join("")+"</ol>");
  h=h.split(/\n{2,}/).map(p=>/^<(h\d|ul|ol)/.test(p.trim())?p:"<p>"+p.replace(/\n/g,"<br>")+"</p>").join("");
  return h.replace(/\u0000(\d+)\u0000/g,(_,i)=>{const b=blocks[+i],prev=/^(html|svg)$/i.test(b.l);
    return `<pre><code>${esc(b.c)}</code></pre><div class="codebar"><span>${esc(b.l||"code")}</span><span><button data-act="copy" data-i="${i}">Kopieren</button>${prev?` <button data-act="studio" data-i="${i}">👁 Vorschau</button>`:""}</span></div>`}).replace(/<p><pre>/g,"<pre>").replace(/<\/div><\/p>/g,"</div>");
}
function render(el,text){
  const blocks=[];const src=text; // Blöcke für Buttons zwischenspeichern
  src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g,(_,l,c)=>{blocks.push(c.replace(/\n$/,""))});
  el.innerHTML=md(text);el._blocks=blocks;
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const code=b.closest(".body")._blocks[+b.dataset.i];
  if(b.dataset.act==="copy")copy(code);else{setPreview(code);show("studio")}});

/* ---------- KI-Aufruf (Streaming) ---------- */

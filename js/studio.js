"use strict";
/* ---------- Studio ---------- */
let files=LS.get("aioStudioFiles",{}),active="index.html",versions=LS.get("aioStudioVers",[]);
const saveStudio=()=>{LS.set("aioStudioFiles",files);LS.set("aioStudioVers",versions.slice(0,30))};
function bundle(){ // Dateien zu einer HTML-Seite zusammenfügen (für Vorschau/Export)
  let h=files["index.html"];if(h==null)return"";
  h=h.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi,(m,f)=>files[f]!=null&&/stylesheet/i.test(m)?`<style>\n${files[f]}\n</style>`:m);
  h=h.replace(/<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi,(m,a1,f,a2)=>files[f]!=null?`<script${a1}${a2}>\n${files[f].replace(/<\/script/gi,"<\\/script")}\n<\/script>`:m);
  return h}
function snapshot(label){const cur=JSON.stringify(files);if(versions[0]&&JSON.stringify(versions[0].files)===cur)return;
  versions.unshift({t:Date.now(),label,files:JSON.parse(cur)});versions=versions.slice(0,30);saveStudio();drawVers()}
function drawVers(){$("#verSel").innerHTML=versions.length?versions.map((v,i)=>`<option value="${i}">${i===0?"● ":""}${new Date(v.t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · ${esc(v.label)}</option>`).join(""):"<option>Keine Version</option>"}
function drawFiles(){const names=Object.keys(files);
  $("#ftabs").innerHTML=names.map(n=>`<button class="${n===active?"on":""}" data-f="${esc(n)}">${esc(n)}</button>`).join("")+'<button id="fAdd" title="Datei hinzufügen">＋</button><button id="fDel" title="Aktive Datei löschen">🗑</button>';
  $("#code").value=files[active]??""}
function refresh(){if(!(active in files))active=Object.keys(files)[0]||"index.html";const b=bundle();$("#frame").srcdoc=b||"<body style='font-family:system-ui;color:#888;display:grid;place-items:center;height:100vh;margin:0'>Hier erscheint deine Vorschau</body>";drawFiles();drawVers()}
function setPreview(html){files={"index.html":html};active="index.html";snapshot("Aus Chat übernommen");refresh()} // von Chat-Codeblöcken genutzt
function parseFiles(t){const out={};t.replace(/FILE:\s*`?([^\s`]+)`?\s*\n```[\w+-]*\n([\s\S]*?)(```|$)/g,(_,n,c)=>{out[n.replace(/^\.?\//,"")]=c.replace(/\n$/,"")});
  if(!Object.keys(out).length){const m=t.match(/```html\n([\s\S]*?)(```|$)/);if(m)out["index.html"]=m[1].replace(/\n$/,"")}return out}
function drawStudio(){const box=$("#smsgs");box.innerHTML=studioMsgs.length?"":`<div class="empty"><h2>Baue Apps per Beschreibung</h2>Wie Claude Artifacts / ChatGPT Canvas: Beschreibe es – rechts siehst du sofort das Ergebnis, mit mehreren Dateien, Versionsverlauf und ZIP-Export.<div class="chips">${["Snake-Spiel","Todo-App mit Dunkelmodus","Taschenrechner","Portfolio-Landingpage"].map(s=>`<button>${s}</button>`).join("")}</div></div>`;
  box.querySelectorAll(".chips button").forEach(b=>b.onclick=()=>{$("#sinp").value=b.textContent+" bauen";sendStudio()});
  studioMsgs.forEach(m=>addMsg(box,m.role,m.content))}
async function sendStudio(){
  const inp=$("#sinp"),text=inp.value.trim();if(!text)return;inp.value="";inp.style.height="";
  studioMsgs.push({role:"user",content:text});const box=$("#smsgs");if(box.querySelector(".empty"))box.innerHTML="";addMsg(box,"user",text);
  const out=addMsg(box,"assistant","");out.classList.add("dots");$("#ssend").disabled=true;let full="";
  const proj=Object.keys(files).length?"\n\nAKTUELLES PROJEKT:\n"+Object.entries(files).map(([n,c])=>`FILE: ${n}\n\`\`\`\n${c.slice(0,15000)}\n\`\`\``).join("\n"):"";
  const ctxMsgs=studioMsgs.slice(-6).map(m=>({role:m.role,content:m.content}));
  try{full=await ask([{role:"system",content:STUDIO_SYS+proj},...ctxMsgs],t=>{full=t;const n=Object.keys(parseFiles(t));
      out.textContent=n.length?"✍️ Schreibe: "+n.join(", ")+" …":"Denke nach …";box.scrollTop=box.scrollHeight})}
  catch(e){full="⚠️ Fehler: "+e.message}
  out.classList.remove("dots");const nf=parseFiles(full);let reply=full;
  if(Object.keys(nf).length){snapshot("Vor: "+text.slice(0,24));Object.assign(files,nf);active=nf["index.html"]!=null?"index.html":Object.keys(nf)[0];snapshot(text.slice(0,30));refresh();
    reply=full.replace(/FILE:[\s\S]*$/,"").replace(/```[\s\S]*$/,"").trim()+"\n\n✅ Aktualisiert: "+Object.keys(nf).map(n=>"`"+n+"`").join(", ")}
  render(out,reply);studioMsgs.push({role:"assistant",content:reply});$("#ssend").disabled=false}
$("#ssend").onclick=sendStudio;
$("#sinp").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendStudio()}});
const tab=c=>{$("#frame").style.display=c?"none":"";$("#code").style.display=c?"block":"none";$("#ftabs").style.display=c?"flex":"none";$("#tPrev").classList.toggle("on",!c);$("#tCode").classList.toggle("on",c)};
$("#tPrev").onclick=()=>{tab(false);refresh()};$("#tCode").onclick=()=>{tab(true);drawFiles()};
$("#code").addEventListener("input",()=>{files[active]=$("#code").value;saveStudio()});
$("#ftabs").onclick=e=>{const f=e.target.closest("[data-f]");
  if(f){active=f.dataset.f;drawFiles()}
  else if(e.target.id==="fAdd"){const n=prompt("Dateiname (z. B. style.css):");if(n&&!(n in files)){files[n]="";active=n;drawFiles();saveStudio()}}
  else if(e.target.id==="fDel"&&confirm(active+" löschen?")){delete files[active];active=Object.keys(files)[0]||"index.html";saveStudio();refresh()}};
$("#pReload").onclick=()=>{snapshot("Manuelle Änderung");refresh()};
$("#verSave").onclick=()=>{versions.unshift({t:Date.now(),label:"Gespeichert",files:JSON.parse(JSON.stringify(files))});saveStudio();drawVers();toast("Version gespeichert ✔")};
$("#verRestore").onclick=()=>{const v=versions[+$("#verSel").value];if(!v)return;snapshot("Vor Wiederherstellung");files=JSON.parse(JSON.stringify(v.files));saveStudio();refresh();toast("Version wiederhergestellt ✔")};
$("#pCopy").onclick=()=>copy(files[active]??"");
const dl=(blob,name)=>{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click()};
$("#pDl").onclick=()=>dl(new Blob([bundle()],{type:"text/html"}),"app.html");
$("#pWin").onclick=()=>window.open(URL.createObjectURL(new Blob([bundle()],{type:"text/html"})),"_blank");
/* ZIP (ohne Kompression) */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return b=>{let c=~0;for(const x of b)c=t[(c^x)&255]^(c>>>8);return(~c)>>>0}})();
function makeZip(f){const enc=new TextEncoder(),parts=[],cd=[];let off=0;
  const u16=n=>[n&255,n>>8&255],u32=n=>[n&255,n>>8&255,n>>16&255,n>>>24];
  for(const[name,content]of Object.entries(f)){const nb=enc.encode(name),db=enc.encode(content),crc=CRC(db);
    const lh=new Uint8Array([0x50,0x4b,3,4,20,0,0,8,0,0,0,0,0,0,...u32(crc),...u32(db.length),...u32(db.length),...u16(nb.length),0,0,...nb]);
    parts.push(lh,db);cd.push(new Uint8Array([0x50,0x4b,1,2,20,0,20,0,0,8,0,0,0,0,0,0,...u32(crc),...u32(db.length),...u32(db.length),...u16(nb.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(off),...nb]));off+=lh.length+db.length}
  const cdSize=cd.reduce((a,b)=>a+b.length,0);
  return new Blob([...parts,...cd,new Uint8Array([0x50,0x4b,5,6,0,0,0,0,...u16(cd.length),...u16(cd.length),...u32(cdSize),...u32(off),0,0])],{type:"application/zip"})}
$("#pZip").onclick=()=>Object.keys(files).length?dl(makeZip(files),"projekt.zip"):toast("Noch kein Projekt");

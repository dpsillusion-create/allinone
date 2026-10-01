"use strict";
/* ---------- Einstellungen & Modelle ---------- */
const AS=()=>window.AIO_STORE||{};
if(AS().user){$("#profBtn").style.display="";$("#profBtn").textContent="👤 "+AS().user.name;$("#profBtn").onclick=()=>location.href="/account.html"}
$("#accBtn").onclick=()=>location.href="/account.html";
$("#adminBtn").onclick=()=>location.href="/admin.html";
$("#logoutBtn").onclick=()=>AS().logout();
function storeInfo(){$("#profRow").style.display=AS().user?"":"none";if(AS().user){$("#profName").textContent="👤 "+AS().user.name+(AS().user.role==="admin"?" (Admin)":"");$("#adminBtn").style.display=AS().user.role==="admin"?"":"none"}const st=window.AIO_STORE||{};$("#storeInfo").textContent=st.server?(st.error?"⚠️ Server nicht erreichbar – Änderungen sind vorerst nur lokal":"✅ Auf dem Server gespeichert – auf allen Geräten verfügbar"):"💾 Nur lokal in diesem Browser"}
$("#bkDl").onclick=()=>{const o={_aio:1,date:new Date().toISOString()};(window.AIO_KEYS||["aio"]).forEach(k=>{try{const v=localStorage.getItem(k);if(v!=null)o[k]=JSON.parse(v)}catch{}});dl(new Blob([JSON.stringify(o)],{type:"application/json"}),"allinone-backup.json")};
$("#bkUp").onclick=()=>$("#bkFile").click();
$("#bkFile").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;try{const o=JSON.parse(await f.text());if(!o._aio)throw 0;
  if(!confirm("Backup einspielen? Vorhandene Daten werden überschrieben."))return;(window.AIO_KEYS||["aio"]).forEach(k=>{if(k in o)localStorage.setItem(k,JSON.stringify(o[k]))});toast("Backup eingespielt ✔");setTimeout(()=>location.reload(),600)}catch{toast("Keine gültige Backup-Datei")}};
$("#cfg").onclick=()=>{storeInfo();$("#sys").value=S.sys;$("#speak").checked=S.speak;$("#dlg").showModal()};
$("#dlgOk").onclick=()=>{S.sys=$("#sys").value||S.sys;S.speak=$("#speak").checked;save();$("#dlg").close()};
$("#exp").onclick=()=>{const md=S.chats.map(c=>"# "+c.title+"\n\n"+c.msgs.map(m=>"**"+(m.role==="user"?"Du":"KI")+":** "+(m.display??m.content)).join("\n\n")).join("\n\n---\n\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"}));a.download="chats.md";a.click()};
$("#wipe").onclick=()=>{if(confirm("Alle Chats, Bilder, Projekte und Prompts dieses Kontos löschen (auch auf dem Server)?")){(window.AIO_KEYS||["aio"]).forEach(k=>{try{localStorage.removeItem(k)}catch{}});location.reload()}};
/** Modellauswahl: Pollinations (gratis, ohne Schlüssel) + Modelle der vom Admin eingerichteten Anbieter, gruppiert */
function fillModels(list){
  window.AIO_MODELS=list;if(typeof fillCompare==="function")fillCompare(list);
  const groups=[];list.forEach(m=>{const g=(modelInfo(m)||{}).group||"Pollinations (gratis)";let x=groups.find(y=>y.g===g);if(!x)groups.push(x={g,items:[]});x.items.push(m)});
  $("#model").innerHTML=groups.map(x=>`<optgroup label="${esc(x.g)}">${x.items.map(m=>`<option value="${esc(m)}" ${m===S.model?"selected":""}>${esc(modelLabel(m))}</option>`).join("")}</optgroup>`).join("")}
fillModels(["openai-fast"]);
$("#model").onchange=e=>{S.model=e.target.value;save()};
let pollModels=[],proxModels=[];
function rebuildModels(){
  const info={};
  pollModels.forEach(x=>{[x.name,...(x.aliases||[])].forEach(n=>info[n]={...x,group:"Pollinations (gratis, ohne Schlüssel)",label:x.name})});
  proxModels.forEach(x=>{info[x.id]={...x,group:x.provider+(x.free?" – gratis":""),label:x.name+(x.free?" 🆓":" 💳")}});
  window.AIO_MODEL_INFO=info;
  const ids=[...pollModels.map(x=>x.name),...proxModels.map(x=>x.id)];
  if(ids.length){if(!ids.includes(S.model)&&!info[S.model])S.model=ids[0];fillModels(ids)}}
fetch("https://text.pollinations.ai/models").then(r=>r.json()).then(l=>{pollModels=l;rebuildModels()}).catch(()=>{});
if(AS().server)fetch("/api/ai/models").then(r=>r.ok?r.json():null).then(d=>{if(d){proxModels=d.models||[];rebuildModels();(d.errors||[]).forEach(e=>toast("⚠️ "+e.provider+": "+e.error))}}).catch(()=>{});

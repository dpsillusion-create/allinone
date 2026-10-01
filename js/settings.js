"use strict";
/* ---------- Einstellungen & Modelle ---------- */
const AS=()=>window.AIO_STORE||{};
if(AS().profile){$("#profBtn").style.display="";$("#profBtn").textContent="👤 "+AS().profile.name+"  ⇄";$("#profBtn").onclick=()=>AS().switchProfile()}
$("#profSwitch").onclick=()=>AS().switchProfile();
$("#profDel").onclick=()=>{if(confirm("Profil „"+AS().profile.name+"“ mit ALLEN Chats, Projekten und Prompts endgültig löschen?")&&!AS().deleteProfile())toast("Löschen nicht möglich")};
function storeInfo(){$("#profRow").style.display=AS().profile?"":"none";if(AS().profile)$("#profName").textContent="👤 "+AS().profile.name;const st=window.AIO_STORE||{};$("#storeInfo").textContent=st.server?(st.error?"⚠️ Server nicht erreichbar – Änderungen sind vorerst nur lokal":"✅ Auf dem Server gespeichert – auf allen Geräten verfügbar"):"💾 Nur lokal in diesem Browser"}
$("#bkDl").onclick=()=>{const o={_aio:1,date:new Date().toISOString()};(window.AIO_KEYS||["aio"]).forEach(k=>{try{const v=localStorage.getItem(k);if(v!=null)o[k]=JSON.parse(v)}catch{}});dl(new Blob([JSON.stringify(o)],{type:"application/json"}),"allinone-backup.json")};
$("#bkUp").onclick=()=>$("#bkFile").click();
$("#bkFile").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;try{const o=JSON.parse(await f.text());if(!o._aio)throw 0;
  if(!confirm("Backup einspielen? Vorhandene Daten werden überschrieben."))return;(window.AIO_KEYS||["aio"]).forEach(k=>{if(k in o)localStorage.setItem(k,JSON.stringify(o[k]))});toast("Backup eingespielt ✔");setTimeout(()=>location.reload(),600)}catch{toast("Keine gültige Backup-Datei")}};
$("#cfg").onclick=()=>{storeInfo();$("#sys").value=S.sys;$("#speak").checked=S.speak;$("#dlg").showModal()};
$("#dlgOk").onclick=()=>{S.sys=$("#sys").value||S.sys;S.speak=$("#speak").checked;save();$("#dlg").close()};
$("#exp").onclick=()=>{const md=S.chats.map(c=>"# "+c.title+"\n\n"+c.msgs.map(m=>"**"+(m.role==="user"?"Du":"KI")+":** "+(m.display??m.content)).join("\n\n")).join("\n\n---\n\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"}));a.download="chats.md";a.click()};
$("#wipe").onclick=()=>{if(confirm("Alle Chats, Bilder, Projekte und Prompts dieses Profils löschen (auch auf dem Server)?")){(window.AIO_KEYS||["aio"]).forEach(k=>{try{localStorage.removeItem(k)}catch{}});location.reload()}};
function fillModels(list){window.AIO_MODELS=list;if(typeof fillCompare==="function")fillCompare(list);$("#model").innerHTML=list.map(m=>`<option ${m===S.model?"selected":""}>${esc(m)}</option>`).join("")}
fillModels(["openai","openai-fast","mistral","llama","deepseek"]);
$("#model").onchange=e=>{S.model=e.target.value;save()};
fetch("https://text.pollinations.ai/models").then(r=>r.json()).then(l=>{const n=l.map(x=>x.name||x).filter(Boolean);if(n.length){if(!n.includes(S.model))S.model=n[0];fillModels(n)}}).catch(()=>{});

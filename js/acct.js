"use strict";
/* Gemeinsame Helfer für Konto- und Admin-Seite */
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function api(method,url,body){
  let r;try{r=await fetch(url,{method,headers:{"Content-Type":"application/json","X-AIO":"1"},body:body?JSON.stringify(body):undefined})}
  catch{return{status:0,data:{error:"Server nicht erreichbar."}}}
  let d={};try{d=await r.json()}catch{}
  if(r.status===401&&d.code==="login_required")location.replace("/login.html?next="+encodeURIComponent(location.pathname));
  if(r.status===403&&d.code==="password_change_required")location.replace("/login.html?change=1");
  return{status:r.status,data:d}}
function say(el,text,ok){el.className="msg2 "+(ok?"ok":"err");el.textContent=text}
async function logout(){
  await api("POST","/api/logout");
  ["aio","aioStudioFiles","aioStudioVers","aioPrompts","aioUid"].forEach(k=>{try{localStorage.removeItem(k)}catch{}}); // lokale Kopie auf geteilten Geräten entfernen
  location.replace("/login.html")}
function genPw(n=14){const a="abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789",r=crypto.getRandomValues(new Uint32Array(n));return[...r].map(x=>a[x%a.length]).join("")}
/** Kleiner Dialog: fields=[{id,label,type?,value?,hint?}] -> Promise<{id:wert}|null> */
function modal(title,fields,okText="Speichern"){
  return new Promise(res=>{
    const d=document.createElement("dialog");
    d.style.cssText="background:#0b1626;color:#e5f3f6;border:1px solid rgba(52,226,214,.25);border-radius:18px;padding:20px;max-width:420px;width:92%";
    d.innerHTML=`<form method="dialog"><h3 style="margin:0 0 6px">${esc(title)}</h3>${fields.map(f=>`<label for="m_${f.id}">${esc(f.label)}</label><input id="m_${f.id}" type="${f.type||"text"}" value="${esc(f.value||"")}" autocomplete="off">${f.hint?`<div style="font-size:12px;color:#7e98a7;margin-top:3px">${f.hint}</div>`:""}`).join("")}
      <div class="row2" style="justify-content:flex-end"><button type="button" data-c>Abbrechen</button><button class="primary" data-ok>${esc(okText)}</button></div></form>`;
    document.body.appendChild(d);const done=v=>{d.close();d.remove();res(v)};
    d.querySelector("[data-c]").onclick=()=>done(null);d.addEventListener("cancel",e=>{e.preventDefault();done(null)});
    d.querySelector("form").onsubmit=e=>{e.preventDefault();done(Object.fromEntries(fields.map(f=>[f.id,d.querySelector("#m_"+f.id).value])))};
    d.showModal();d.querySelector("input")?.focus()})}

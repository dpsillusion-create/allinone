"use strict";
/* ---------- Chat ---------- */
function curChat(){let c=S.chats.find(x=>x.id===S.cur);if(!c){c={id:Date.now(),title:"Neuer Chat",msgs:[]};S.chats.unshift(c);S.cur=c.id}return c}
function drawHist(){$("#hist").innerHTML=S.chats.map(c=>`<div class="hi ${c.id===S.cur?"on":""}" data-id="${c.id}"><span>${esc(c.title)}</span><b data-del="${c.id}">✕</b></div>`).join("")}
$("#hist").onclick=e=>{const d=e.target.closest("[data-del]"),i=e.target.closest(".hi");
  if(d){S.chats=S.chats.filter(c=>c.id!=d.dataset.del);if(S.cur==d.dataset.del)S.cur=null}else if(i){S.cur=+i.dataset.id;show("chat")}else return;save();drawChat()};
$("#newChat").onclick=()=>{S.cur=null;save();show("chat");drawChat();$("#inp").focus()};
const SUGG=["Erkläre mir Quantenphysik einfach","Schreibe eine Python-Funktion für Primzahlen","Plane 3 Tage in Rom","Fasse mir ein Thema in 5 Punkten zusammen"];
function addMsg(box,role,text,imgs){const d=document.createElement("div");d.className="msg "+role;d.innerHTML=`<div class="av">${role==="user"?"🧑":"✨"}</div><div class="body"></div>`;box.appendChild(d);
  const b=d.querySelector(".body");if(role==="user"){b.textContent=text;(imgs||[]).forEach(u=>{const i=new Image();i.src=u;b.prepend(i)})}else render(b,text);box.scrollTop=box.scrollHeight;return b}
function drawChat(){drawHist();const box=$("#msgs"),c=S.chats.find(x=>x.id===S.cur);box.innerHTML="";
  if(!c||!c.msgs.length){box.innerHTML=`<div class="empty"><h2>Wie kann ich helfen?</h2>Chat, Code, Bilder, Texte & Sprache – alles kostenlos an einem Ort.<div class="chips">${SUGG.map(s=>`<button>${s}</button>`).join("")}</div></div>`;
    box.querySelectorAll(".chips button").forEach(b=>b.onclick=()=>{$("#inp").value=b.textContent;sendChat()});return}
  c.msgs.forEach(m=>addMsg(box,m.role,m.display??m.content,m.imgs))}
function busy(on){$("#send").style.display=on?"none":"";$("#stop").style.display=on?"":"none"}
let atts=[],webOn=false;
const drawAtts=()=>{$("#atts").innerHTML=atts.map((a,i)=>`<span class="att">${a.img?`<img src="${a.img}">`:"📄"} ${esc(a.name)}<b data-rm="${i}">✕</b></span>`).join("")};
$("#atts").onclick=e=>{const r=e.target.closest("[data-rm]");if(r){atts.splice(+r.dataset.rm,1);drawAtts()}};
$("#attach").onclick=()=>$("#file").click();
$("#file").onchange=e=>{addFiles([...e.target.files]);e.target.value=""};
$("#web").onclick=()=>{webOn=!webOn;$("#web").classList.toggle("on",webOn);toast(webOn?"Websuche an":"Websuche aus")};
async function addFiles(list){
  for(const f of list){try{
    if(/\.pdf$/i.test(f.name)||f.type==="application/pdf")toast("PDF wird gelesen …");
    atts.push(await readAttachment(f));
  }catch{toast("Konnte "+f.name+" nicht lesen")}}
  drawAtts()}
document.addEventListener("paste",e=>{const f=[...(e.clipboardData?.files||[])];if(f.length&&$("#v-chat").classList.contains("on")){e.preventDefault();addFiles(f)}});
$("#v-chat").addEventListener("dragover",e=>e.preventDefault());
$("#v-chat").addEventListener("drop",e=>{e.preventDefault();addFiles([...e.dataTransfer.files])});
async function wikiSearch(q){
  q=q.replace(/\s+/g," ").slice(0,200);const res=[];
  await Promise.all(["de","en"].map(async l=>{try{
    const r=await fetch(`https://${l}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=extracts|info&exintro=1&explaintext=1&exchars=900&inprop=url&format=json&origin=*`);
    const p=Object.values((await r.json()).query?.pages||{}).sort((a,b)=>a.index-b.index);p.forEach(x=>res.push({title:x.title+" ("+l+".wikipedia)",url:x.fullurl,text:x.extract||""}))}catch{}}));
  return res.slice(0,5)}
const toApi=(m,keepImg)=>m.imgs&&keepImg?{role:m.role,content:[{type:"text",text:m.content},...m.imgs.map(u=>({type:"image_url",image_url:{url:u}}))]}:{role:m.role,content:m.content};
async function sendChat(text){
  const inp=$("#inp");text=(text??inp.value).trim();if(!text&&!atts.length)return;inp.value="";inp.style.height="";
  const files=atts;atts=[];drawAtts();text=text||(files.some(f=>f.img)?"Beschreibe dieses Bild.":"Fasse den Inhalt zusammen.");
  const imgs=files.filter(f=>f.img).map(f=>f.img),docs=files.filter(f=>f.text!=null);
  let content=text+docs.map(d=>`\n\n[Datei: ${d.name}]\n${d.text.slice(0,30000)}${d.text.length>30000?"\n…(gekürzt)":""}`).join("");
  const display=text+files.map(f=>"\n📎 "+f.name).join("");
  const c=curChat();if(!c.msgs.length)c.title=text.slice(0,40);const um={role:"user",content,display,imgs:imgs.length?imgs:undefined};c.msgs.push(um);
  const box=$("#msgs");if(box.querySelector(".empty"))box.innerHTML="";addMsg(box,"user",display,imgs);
  const out=addMsg(box,"assistant","");out.classList.add("dots");busy(true);ctrl=new AbortController();let full="",srcs=[];
  try{
    const hist=c.msgs.slice(-20).map((m,i,a)=>toApi(m,i>=a.length-3));
    if(webOn){out.textContent="🔎 Suche …";srcs=await wikiSearch(text);
      if(srcs.length){const q="Nutze diese Web-Quellen und zitiere sie als [1], [2] …, wenn sie relevant sind:\n"+srcs.map((x,i)=>`[${i+1}] ${x.title}: ${x.text}`).join("\n\n")+"\n\nFrage: "+content;
        hist[hist.length-1]=toApi({...um,content:q},true)}
      out.textContent=""}
    full=await ask([{role:"system",content:S.sys},...hist],t=>{full=t;render(out,t);box.scrollTop=box.scrollHeight},ctrl.signal)}
  catch(e){if(e.name!=="AbortError"){full=full||"⚠️ Fehler: "+e.message+" – bitte nochmal versuchen."}}
  if(full&&srcs.length)full+="\n\n**Quellen:**\n"+srcs.map((x,i)=>`${i+1}. [${x.title}](${x.url})`).join("\n");
  out.classList.remove("dots");if(full){render(out,full);c.msgs.push({role:"assistant",content:full});if(S.speak)speak(full)}
  busy(false);save();drawHist()}
$("#send").onclick=()=>sendChat();$("#stop").onclick=()=>ctrl&&ctrl.abort();
function autosize(t){t.addEventListener("input",()=>{t.style.height="auto";t.style.height=Math.min(t.scrollHeight,180)+"px"})}
$$("textarea.auto,#inp,#sinp").forEach(autosize);
$("#inp").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat()}});

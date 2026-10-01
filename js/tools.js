"use strict";
/* ---------- Diagramme & Mindmaps ---------- */
let mmN=0;
async function mermaidReady(){if(!window.mermaid){await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js");mermaid.initialize({startOnLoad:false,theme:"default",securityLevel:"strict"})}}
const stripFence=t=>t.replace(/^\s*```(?:mermaid)?\s*\n?/i,"").replace(/```\s*$/,"").trim();
async function drawMermaid(code){await mermaidReady();const {svg}=await mermaid.render("mm"+(++mmN),code);$("#dgOut").innerHTML=svg;$("#dgRes").style.display=""}
$("#dgGo").onclick=async()=>{const t=$("#dgIn").value.trim();if(!t)return;const type=$("#dgType").value,st=$("#dgSt"),btn=$("#dgGo");btn.disabled=true;
  try{
    st.textContent="Die KI entwirft das Diagramm …";let code=stripFence(await ask1([{role:"system",content:`Du erzeugst Mermaid-Diagramme. Diagrammtyp: ${type}. Gib AUSSCHLIESSLICH gültigen Mermaid-Code aus (kein Markdown, keine Erklärung). Beschriftungen in der Sprache des Nutzers, ohne Sonderzeichen wie Klammern oder Anführungszeichen in Knotentexten, wenn möglich.`},{role:"user",content:t}]));
    for(let i=0;i<2;i++){try{$("#dgCode").value=code;await drawMermaid(code);st.textContent="Fertig ✔";return}catch(e){
      if(i)throw e;st.textContent="Korrigiere Syntaxfehler …";code=stripFence(await ask1([{role:"system",content:"Repariere den Mermaid-Code. Gib NUR den korrigierten Code aus."},{role:"user",content:"Code:\n"+code+"\n\nFehler: "+String(e.message||e).slice(0,300)}]))}}
  }catch(e){st.textContent="⚠️ Konnte nicht gezeichnet werden: "+(e.message||e).toString().slice(0,120)}finally{btn.disabled=false}};
$("#dgRe").onclick=async()=>{try{await drawMermaid($("#dgCode").value);$("#dgSt").textContent="Fertig ✔"}catch(e){$("#dgSt").textContent="⚠️ Syntaxfehler im Code"}};
$("#dgCopy").onclick=()=>copy($("#dgCode").value);
$("#dgSvg").onclick=()=>{const v=$("#dgOut svg");if(v)dl(new Blob([new XMLSerializer().serializeToString(v)],{type:"image/svg+xml"}),"diagramm.svg")};
$("#dgPng").onclick=()=>{const v=$("#dgOut svg");if(!v)return;const r=v.getBoundingClientRect(),x=new XMLSerializer().serializeToString(v),i=new Image();
  i.onload=()=>{const c=document.createElement("canvas");c.width=r.width*2;c.height=r.height*2;const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.drawImage(i,0,0,c.width,c.height);c.toBlob(b=>dl(b,"diagramm.png"))};
  i.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(x)};

/* ---------- Daten & Charts ---------- */
let table={head:[],rows:[]},chart=null;
function parseCSV(t){t=t.replace(/^﻿/,"").trim();const first=t.split("\n")[0],d=[";","\t",","].map(c=>[c,first.split(c).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],f="",q=false;for(let i=0;i<t.length;i++){const c=t[i];
    if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;else if(c===d){row.push(f);f=""}else if(c==="\n"){row.push(f.replace(/\r$/,""));rows.push(row);row=[];f=""}else f+=c}
  row.push(f);rows.push(row);return{head:rows[0].map(x=>x.trim()),rows:rows.slice(1).filter(r=>r.some(x=>x.trim()))}}
const num=v=>{const n=parseFloat(String(v).replace(/\s/g,"").replace(",","."));return isNaN(n)||!/^-?[\d.,\s]+%?$/.test(String(v).trim())?null:n};
function loadTable(txt){try{table=parseCSV(txt)}catch{return toast("Daten nicht lesbar")}
  if(!table.head.length||!table.rows.length)return toast("Keine Daten gefunden");
  $("#dtRes").style.display="";$("#dtInfo").textContent=`${table.rows.length} Zeilen · ${table.head.length} Spalten`;
  $("#dtTab").innerHTML="<tr>"+table.head.map(h=>`<th style="text-align:left;border-bottom:1px solid var(--line);padding:3px 8px">${esc(h)}</th>`).join("")+"</tr>"+table.rows.slice(0,50).map(r=>"<tr>"+table.head.map((_,i)=>`<td style="padding:3px 8px;border-bottom:1px solid var(--line)">${esc(r[i]??"")}</td>`).join("")+"</tr>").join("");
  $("#dtStats").textContent=statsText()}
function statsText(){return table.head.map((h,i)=>{const col=table.rows.map(r=>r[i]??"").filter(x=>x!==""),ns=col.map(num).filter(x=>x!==null);
  if(ns.length>col.length*.8&&ns.length){const sum=ns.reduce((a,b)=>a+b,0);return`${h}: Zahl, min ${Math.min(...ns)}, max ${Math.max(...ns)}, Ø ${(sum/ns.length).toFixed(2)}, Summe ${+sum.toFixed(2)}`}
  return`${h}: Text, ${new Set(col).size} verschiedene Werte`}).join(" | ")}
const tableCtx=()=>`Spalten & Statistik: ${statsText()}\nAnzahl Zeilen: ${table.rows.length}\nErste Zeilen (CSV):\n${[table.head,...table.rows.slice(0,80)].map(r=>r.join(";")).join("\n")}`;
$("#csvFile").onchange=async e=>{const f=e.target.files[0];if(f)loadTable(await f.text())};
$("#csvLoad").onclick=()=>$("#csvIn").value.trim()&&loadTable($("#csvIn").value);
$("#dtAsk").onclick=async()=>{const q=$("#dtQ").value.trim()||"Gib mir einen Überblick über die Daten und auffällige Erkenntnisse.",o=$("#dtOut");o.classList.add("dots");
  let t="";try{t=await ask([{role:"system",content:"Du bist Datenanalyst. Antworte präzise anhand der Daten, in der Sprache des Nutzers. Rechne nur mit den gegebenen Werten und weise darauf hin, wenn du nur eine Stichprobe siehst."},{role:"user",content:tableCtx()+"\n\nFrage: "+q}],x=>{t=x;render(o,x)})}catch(e){t="⚠️ "+e.message}o.classList.remove("dots");render(o,t)};
$("#dtChart").onclick=async()=>{const q=$("#dtQ").value.trim()||"Das aussagekräftigste Diagramm",btn=$("#dtChart");btn.disabled=true;
  try{const raw=await ask1([{role:"system",content:'Du erzeugst Chart.js-Konfigurationen. Antworte NUR mit JSON: {"type":"bar|line|pie|doughnut|scatter","title":"…","labels":[…],"datasets":[{"label":"…","data":[…]}]}. Verwende ausschließlich Zahlen aus den Daten (aggregiere selbst, z. B. Summen pro Kategorie, max. 30 Punkte).'},{role:"user",content:tableCtx()+"\n\nWunsch: "+q}]);
    const c=JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);if(!window.Chart)await loadScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js");
    chart&&chart.destroy();$("#chWrap").style.display="";chart=new Chart($("#chCv"),{type:c.type||"bar",data:{labels:c.labels,datasets:c.datasets},options:{plugins:{title:{display:!!c.title,text:c.title}}}})}
  catch(e){toast("Diagramm fehlgeschlagen – anders formulieren?")}finally{btn.disabled=false}};

/* ---------- Modell-Vergleich ---------- */
function fillCompare(list){const nt=$("#cpNote");if(nt)nt.style.display=list.length<2?"":"none";const used=new Set();document.querySelectorAll(".cpM").forEach((sel,i)=>{const pick=list.includes(sel.value)&&!used.has(sel.value)?sel.value:(list.find(m=>!used.has(m))||list[i%list.length]);used.add(pick);sel.innerHTML=list.map(m=>`<option value="${esc(m)}" ${m===pick?"selected":""}>${esc(modelLabel(m))}</option>`).join("")})}
$("#cpGo").onclick=()=>{const q=$("#cpIn").value.trim();if(!q)return;const g=$("#cpGrid");g.innerHTML="";
  document.querySelectorAll(".cpM").forEach(sel=>{const m=sel.value,card=document.createElement("div");card.className="panel";card.innerHTML=`<b>${esc(m)}</b><div class="body"></div>`;g.appendChild(card);
    const o=card.querySelector(".body");o.classList.add("dots");let t="";
    ask([{role:"system",content:S.sys},{role:"user",content:q}],x=>{t=x;render(o,x)},undefined,m).catch(e=>{t=t||"⚠️ "+e.message}).then(()=>{o.classList.remove("dots");render(o,t)})})};

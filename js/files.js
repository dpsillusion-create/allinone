"use strict";
/* Gemeinsame Datei-Helfer (Hauptapp + Prompt-Agent): PDF-Text, Bild verkleinern, Anhang lesen */
const loadScript=u=>new Promise((ok,no)=>{const s=document.createElement("script");s.src=u;s.onload=ok;s.onerror=no;document.head.appendChild(s)});
async function pdfText(file){
  if(!window.pdfjsLib){await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"}
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let out="";
  for(let i=1;i<=Math.min(pdf.numPages,60);i++){const pg=await pdf.getPage(i);out+=(await pg.getTextContent()).items.map(x=>x.str).join(" ")+"\n\n"}
  return out}
function shrinkImage(file){return new Promise((ok,no)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{const k=Math.min(1,1280/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=i.width*k;c.height=i.height*k;c.getContext("2d").drawImage(i,0,0,c.width,c.height);URL.revokeObjectURL(u);ok(c.toDataURL("image/jpeg",.85))};i.onerror=no;i.src=u})}
/** Datei -> {name,img} (Bild, verkleinert als JPEG-Data-URL) oder {name,text}. Wirft bei Lesefehlern. */
async function readAttachment(f){
  if(f.type.startsWith("image/"))return{name:f.name||"Bild",img:await shrinkImage(f)};
  if(/\.pdf$/i.test(f.name)||f.type==="application/pdf")return{name:f.name,text:await pdfText(f)};
  return{name:f.name,text:await f.text()}}

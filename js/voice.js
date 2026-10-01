"use strict";
/* ---------- Sprache ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,recTarget=null;
function dictate(target,lang,btn){
  if(!SR)return toast("Spracherkennung wird von diesem Browser nicht unterstützt");
  if(rec){rec.stop();return}
  rec=new SR();rec.lang=lang;rec.interimResults=true;rec.continuous=true;const base=target.value?target.value+" ":"";
  rec.onresult=e=>{target.value=base+[...e.results].map(r=>r[0].transcript).join("")};
  rec.onend=()=>{rec=null;btn.textContent=btn.dataset.idle};rec.onerror=()=>{rec=null;btn.textContent=btn.dataset.idle};
  btn.dataset.idle=btn.textContent;btn.textContent="■ Stopp";rec.start()}
$("#mic").onclick=()=>dictate($("#inp"),"de-DE",$("#mic"));
$("#vRec").onclick=()=>dictate($("#vTxt"),$("#vLang").value,$("#vRec"));
$("#vCopy").onclick=()=>copy($("#vTxt").value);
$("#vChat").onclick=()=>{const t=$("#vTxt").value;if(t){show("chat");sendChat(t)}};
function loadVoices(){const v=speechSynthesis.getVoices();$("#tVoice").innerHTML=v.map((x,i)=>`<option value="${i}">${esc(x.name)} (${x.lang})</option>`).join("")}
if("speechSynthesis"in window){loadVoices();speechSynthesis.onvoiceschanged=loadVoices}
function speak(t,i){if(!("speechSynthesis"in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t.replace(/```[\s\S]*?```/g," Codeblock. ").replace(/[*#`_]/g,""));const v=speechSynthesis.getVoices()[i??$("#tVoice").value];if(v){u.voice=v;u.lang=v.lang}speechSynthesis.speak(u)}
$("#tPlay").onclick=()=>speak($("#tTxt").value||"Bitte gib einen Text ein.");$("#tStop").onclick=()=>speechSynthesis.cancel();

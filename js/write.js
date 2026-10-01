"use strict";
/* ---------- Schreibwerkstatt ---------- */
const TOOLS=[["✉️","E-Mail schreiben","Formulierte E-Mail aus Stichpunkten","Schreibe aus den Stichpunkten eine höfliche, klare E-Mail inkl. Betreff."],
["📝","Zusammenfassen","Langen Text kurz & klar","Fasse den Text in maximal 5 prägnanten Stichpunkten zusammen und füge ein 1-Satz-Fazit an."],
["🌍","Übersetzen","Deutsch ⇄ Englisch u. a.","Übersetze den Text. Ist er Deutsch, übersetze ins Englische, sonst ins Deutsche. Nur die Übersetzung ausgeben."],
["🪄","Umschreiben","Besser, kürzer, professioneller","Schreibe den Text stilistisch besser, klar und professionell um, behalte die Bedeutung."],
["✅","Korrigieren","Rechtschreibung & Grammatik","Korrigiere Rechtschreibung, Grammatik und Zeichensetzung. Gib den korrigierten Text und darunter eine kurze Liste der Änderungen aus."],
["💡","Ideen sammeln","Brainstorming zu jedem Thema","Liefere 10 kreative, konkrete Ideen zum Thema, jeweils mit einem Satz Erklärung."],
["📣","Social-Media-Post","Posts für Instagram, LinkedIn…","Schreibe 3 unterschiedliche Social-Media-Posts mit passenden Hashtags zum Thema."],
["🧠","Erkläre es einfach","ELI5 für komplexe Themen","Erkläre das Thema so einfach, dass es ein Zehnjähriger versteht, mit einem Alltagsbeispiel."]];
let tool=null;
$("#toolgrid").innerHTML=TOOLS.map((t,i)=>`<div class="tool" data-t="${i}"><h3>${t[0]} ${t[1]}</h3><p>${t[2]}</p></div>`).join("");
$("#toolgrid").onclick=e=>{const t=e.target.closest(".tool");if(!t)return;tool=TOOLS[+t.dataset.t];$("#toolpanel").style.display="";$("#tpTitle").textContent=tool[0]+" "+tool[1];$("#tpIn").focus();$("#tpIn").placeholder=tool[2]};
let tpText="";
$("#tpGo").onclick=async()=>{const t=$("#tpIn").value.trim();if(!t||!tool)return;const o=$("#tpOut");o.classList.add("dots");$("#tpGo").disabled=true;
  try{tpText=await ask([{role:"system",content:tool[3]+" Antworte in der Sprache des Nutzers, sofern nicht anders verlangt."},{role:"user",content:t}],x=>{tpText=x;render(o,x)})}catch(e){tpText="⚠️ "+e.message}
  o.classList.remove("dots");render(o,tpText);$("#tpGo").disabled=false};
$("#tpCopy").onclick=()=>copy(tpText);

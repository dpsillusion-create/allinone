"use strict";
/* KI-Aufrufe (gemeinsam für Hauptapp und Prompt-Agent): Streaming, Timeout, Wiederholung, Fehlertexte.
   Erwartet bei Bedarf die Globals S (S.model) und toast(), nutzt window.AIO_MODELS / AIO_MODEL_INFO. */
const API="https://text.pollinations.ai/openai";
class AiError extends Error{constructor(kind,status,msg){super(msg||AiError.text(kind,status));this.kind=kind;this.status=status}
  static text(kind,st){return kind==="rate"?"Das Gratis-Kontingent ist gerade ausgelastet. Bitte kurz warten und erneut versuchen."
    :kind==="server"?"Der KI-Dienst ist gerade nicht erreichbar (Status "+st+"). Bitte später erneut versuchen."
    :kind==="timeout"?"Keine Antwort erhalten (Zeitüberschreitung). Bitte erneut versuchen."
    :kind==="network"?"Keine Verbindung zum KI-Dienst. Prüfe deine Internetverbindung."
    :"Anfrage abgelehnt (Status "+st+"). Versuche ein anderes Modell."}}
const aiKind=st=>st===429?"rate":st>=500?"server":"client";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const modelInfo=m=>(window.AIO_MODEL_INFO||{})[m];
const isProxied=m=>String(m).startsWith("p:");                          // Modelle über Server-Anbieter (z. B. OpenRouter)
const isFreeModel=m=>{const i=modelInfo(m);return !isProxied(m)||!!(i&&i.free)}; // nur Gratis-Modelle dienen als automatischer Ersatz
const modelLabel=m=>{const i=modelInfo(m);return(i&&i.label)||m};
/** Ein Versuch mit genau einem Modell. Timeout = 45 s ohne irgendein Datenpaket (auch „Denken“ zählt als Aktivität). */
async function askOnce(messages,onToken,signal,model,onThink){
  const ctl=new AbortController();let timedOut=false,timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;ctl.abort()},45000)};
  const onAbort=()=>ctl.abort();signal&&(signal.aborted?ctl.abort():signal.addEventListener("abort",onAbort));
  let full="";arm();
  try{
    const px=isProxied(model);
    let r;try{r=await fetch(px?"/api/ai/chat":API,{method:"POST",headers:px?{"Content-Type":"application/json","X-AIO":"1"}:{"Content-Type":"application/json"},signal:ctl.signal,
        body:JSON.stringify(px?{model,messages,stream:true}:{model,messages,stream:true,reasoning_effort:"low"})})}
    catch(e){if(timedOut)throw new AiError("timeout");if(e.name==="AbortError")throw e;throw new AiError("network")}
    if(!r.ok){let msg;if(px){let d={};try{d=await r.json()}catch{}if(r.status===401&&d.code==="login_required"){location.href="/login.html";}msg=d.error}
      throw new AiError(aiKind(r.status),r.status,msg)}
    const rd=r.body.getReader(),dec=new TextDecoder();let buf="";
    for(;;){let c;try{c=await rd.read()}catch(e){if(timedOut)throw new AiError("timeout");if(e.name==="AbortError")throw e;throw new AiError("network")}
      if(c.done)break;arm();buf+=dec.decode(c.value,{stream:true});
      const lines=buf.split("\n");buf=lines.pop();
      for(const l of lines){if(!l.startsWith("data:"))continue;const d=l.slice(5).trim();if(d==="[DONE]")continue;
        try{const dl=JSON.parse(d).choices?.[0]?.delta||{};
          if(dl.reasoning&&!full&&onThink)onThink();
          if(dl.content){full+=dl.content;onToken(full)}}catch{}}}
    return full;
  }catch(e){e.partial=full;throw e}
  finally{clearTimeout(timer);signal&&signal.removeEventListener("abort",onAbort)}}
/** Normalfall: gewähltes Modell; bei Limit/Ausfall bis zu 2 weitere Versuche (anderes Modell, sonst dasselbe nach kurzer Pause).
    Ein explizit angegebenes Modell wird nie ersetzt. */
async function ask(messages,onToken,signal,model,onThink){
  const fixed=!!model,tried=[model||S.model];let lastErr;
  for(let i=0;i<3;i++){
    const m=tried[tried.length-1];
    try{return await askOnce(messages,onToken,signal,m,onThink)}
    catch(e){
      lastErr=e;if(e.name==="AbortError"||fixed||e.partial||!(e instanceof AiError)||e.kind==="client"||i===2)break;
      await sleep(e.kind==="rate"?2500:1500);
      const next=(window.AIO_MODELS||[]).find(x=>!tried.includes(x)&&isFreeModel(x));
      if(next){tried.push(next);toast(`Modell „${modelLabel(m)}“ nicht verfügbar – versuche „${modelLabel(next)}“ …`)}
      else{tried.push(m);toast("Neuer Versuch …")}}}
  throw lastErr}
const ask1=(messages,model)=>ask(messages,()=>{},undefined,model);

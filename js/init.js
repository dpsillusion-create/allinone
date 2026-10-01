"use strict";
if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
drawChat();drawImages();drawStudio();refresh();
fillCompare(window.AIO_MODELS); // Modell-Vergleich erst nach dem Laden aller Skripte befüllen

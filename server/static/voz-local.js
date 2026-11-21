/* Voz do Jarvis dentro do app proprio (Jarvis.exe) — 16/11/2026.

   O app e um Electron. Ele nao tem o reconhecimento de fala do Chrome (que
   mandava o audio para o Google) nem as vozes online do Edge. Em vez de
   reescrever as tres partes do HUD que falam e ouvem, este arquivo coloca
   no lugar das pecas do navegador duas pecas com a MESMA cara, que usam o
   proprio servidor do Jarvis:

   - ouvir:  window.SpeechRecognition  -> grava a frase, manda para o
             /v1/speech/transcribe (faster-whisper, roda NESTE PC);
   - falar:  window.speechSynthesis    -> pede o audio ao /v1/speech/synthesize
             (Kokoro, tambem local), com as vozes nativas do Windows como
             reserva se o servidor de voz falhar.

   Vale SO dentro do app. No Edge (OpenJarvis.bat) nada muda.
   Nada sai do computador: o audio vai do microfone para 127.0.0.1. */
(function(){
  "use strict";
  if(!/Electron\//.test(navigator.userAgent)) return;

  /* ===================== FALAR (Kokoro) ===================== */
  var nativo = window.speechSynthesis || null;
  /* Vozes locais (Kokoro) em portugues. */
  var KOKORO = [
    {name:"Jarvis - Alex (local)", voiceURI:"kokoro:pm_alex", id:"pm_alex"},
    {name:"Jarvis - Dora (local)", voiceURI:"kokoro:pf_dora", id:"pf_dora"},
    {name:"Jarvis - Santa (local)", voiceURI:"kokoro:pm_santa", id:"pm_santa"}
  ].map(function(v){
    return {name:v.name, voiceURI:v.voiceURI, lang:"pt-BR", localService:true,
            "default":false, _kokoro:v.id};
  });
  /* 16/11: as vozes online da Microsoft que ele usava no Edge. O app nao
     tem essas vozes; o servidor busca o audio no mesmo servico do Edge
     (/api/voz-edge, pacote edge-tts). Precisa de internet, e o texto falado
     vai para a Microsoft — igual era no Edge. */
  var EDGE = [
    {name:"Francisca (online)", id:"pt-BR-FranciscaNeural"},
    {name:"Antonio (online)",   id:"pt-BR-AntonioNeural"},
    {name:"Thalita (online, multilingue)", id:"pt-BR-ThalitaMultilingualNeural"},
    {name:"Raquel (online)", id:"pt-PT-RaquelNeural", lang:"pt-PT"},
    {name:"Duarte (online)", id:"pt-PT-DuarteNeural", lang:"pt-PT"},
    /* multilingues: falam portugues sem sotaque, com a voz de outro pais */
    {name:"Andrew (online, multilingue)", id:"en-US-AndrewMultilingualNeural"},
    {name:"Ava (online, multilingue)", id:"en-US-AvaMultilingualNeural"},
    {name:"Brian (online, multilingue)", id:"en-US-BrianMultilingualNeural"},
    {name:"Emma (online, multilingue)", id:"en-US-EmmaMultilingualNeural"},
    {name:"William (online, multilingue)", id:"en-AU-WilliamMultilingualNeural"},
    {name:"Remy (online, multilingue)", id:"fr-FR-RemyMultilingualNeural"},
    {name:"Vivienne (online, multilingue)", id:"fr-FR-VivienneMultilingualNeural"},
    {name:"Florian (online, multilingue)", id:"de-DE-FlorianMultilingualNeural"},
    {name:"Seraphina (online, multilingue)", id:"de-DE-SeraphinaMultilingualNeural"},
    {name:"Giuseppe (online, multilingue)", id:"it-IT-GiuseppeMultilingualNeural"},
    {name:"Hyunsu (online, multilingue)", id:"ko-KR-HyunsuMultilingualNeural"}
  ].map(vozEdge);
  function vozEdge(v){
    return {name:v.name, voiceURI:"edge:"+v.id, lang:v.lang||"pt-BR", localService:false,
            "default":false, _edge:v.id};
  }
  /* A lista de verdade vem da Microsoft (todas as de portugues e todas as
     multilingues). A de cima e so o comeco, ate essa chegar. */
  function carregarListaEdge(){
    fetch("/api/voz-edge/lista").then(function(r){ return r.ok ? r.json() : null; })
      .then(function(l){
        if(!l || !l.length) return;
        var novas = l.map(function(v){
          var rot = v.nome + (v.multilingue ? " (online, multilingue)" : " (online)");
          return vozEdge({name:rot, id:v.id, lang: v.multilingue ? "pt-BR" : v.lang});
        });
        EDGE.length = 0; Array.prototype.push.apply(EDGE, novas);
        avisarVozes();
      }).catch(function(){});
  }

  function vozesNativas(){
    try{ return nativo ? (nativo.getVoices()||[]) : []; }catch(e){ return []; }
  }
  function evento(u, tipo, extra){
    var ev;
    try{
      ev = tipo==="error"
        ? new SpeechSynthesisErrorEvent("error",{utterance:u, error:(extra||"interrupted")})
        : new SpeechSynthesisEvent(tipo,{utterance:u});
    }catch(e){ ev = new Event(tipo); }
    try{ u.dispatchEvent(ev); }catch(e){}
  }
  /* frases curtas: o primeiro pedaco chega rapido e o resto vem enquanto
     o primeiro toca */
  function pedacos(t){
    t = String(t||"").replace(/\s+/g," ").trim();
    if(!t) return [];
    var partes = t.match(/[^.!?;:]+[.!?;:]*\s*/g) || [t], saida=[], cur="";
    partes.forEach(function(p){
      if((cur+p).length > 260 && cur){ saida.push(cur.trim()); cur=""; }
      cur += p;
      while(cur.length > 400){ saida.push(cur.slice(0,400)); cur=cur.slice(400); }
    });
    if(cur.trim()) saida.push(cur.trim());
    return saida;
  }
  function pedirAudio(texto, vozId, ger){
    var corpo = {text:texto};
    if(vozId) corpo.voice_id = vozId;
    return fetch("/v1/speech/synthesize",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(corpo)
    }).then(function(r){
      if(!r.ok) throw new Error("tts "+r.status);
      return r.blob();
    });
  }
  function pedirEdge(texto, vozId, rate){
    return fetch("/api/voz-edge",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({texto:texto, voz:vozId, velocidade:rate||1})
    }).then(function(r){
      if(!r.ok) throw new Error("edge "+r.status);
      return r.blob();
    });
  }

  var fila=[], atual=null, tocando=null, geracao=0, onvc=null;
  function pararAudio(){
    if(tocando){
      try{ tocando.pause(); }catch(e){}
      try{ URL.revokeObjectURL(tocando.src); }catch(e){}
      tocando=null;
    }
  }
  function terminou(u, g, erro){
    if(g!==geracao) return;
    atual=null; pararAudio();
    if(erro) evento(u,"error",erro); else evento(u,"end");
    setTimeout(proxima,0);
  }
  /* reserva: a voz do Windows, se o Kokoro nao responder */
  function falarNativo(u, g, comecou){
    var vs = vozesNativas().filter(function(v){ return /^pt/i.test(v.lang); });
    if(!nativo || !vs.length){ terminou(u,g,"synthesis-failed"); return; }
    var n = new SpeechSynthesisUtterance(u.text);
    n.voice = vs.filter(function(v){ return /BR/i.test(v.lang); })[0] || vs[0];
    n.lang = n.voice.lang; n.rate = u.rate||1;
    n.onstart = function(){ if(!comecou) evento(u,"start"); };
    n.onboundary = function(){ evento(u,"boundary"); };
    n.onend = function(){ terminou(u,g); };
    n.onerror = function(){ terminou(u,g,"synthesis-failed"); };
    try{ nativo.speak(n); }catch(e){ terminou(u,g,"synthesis-failed"); }
  }
  function proxima(){
    if(atual || !fila.length) return;
    var u = fila.shift(), g = geracao;
    atual = u;
    var v = u.voice;
    if(v && !v._kokoro && !v._edge){     /* escolheu uma voz do Windows */
      falarNativo(u,g,false); return;
    }
    if(v && v._edge){ falarEdge(u,g,v); return; }
    var vozId = v && v._kokoro || "";
    var pedir = v && v._edge
      ? function(t){ return pedirEdge(t, v._edge, u.rate); }
      : function(t){ return pedirAudio(t, vozId); };
    var lista = pedacos(u.text), i=0, comecou=false;
    if(!lista.length){ evento(u,"start"); terminou(u,g); return; }
    var proximo = pedir(lista[0]);
    /* 16/11: logo depois de ligar o PC o Kokoro ainda esta carregando e a
       primeira frase (o "Aguardando confirmacao de identidade") nao saia.
       Se o primeiro pedaco nao chegar em 2,5 s, essa frase vai pela voz do
       Windows; as seguintes ja pegam o Kokoro pronto. */
    var desistiu = false;
    setTimeout(function(){
      if(!comecou && g===geracao && atual===u){ desistiu = true; falarNativo(u,g,false); }
    }, v && v._edge ? 12000 : 2500);
    /* 16/11 12h50: a voz online leva 3,5 a 5 s para responder (medido).
       Com 3 s de paciencia ela sempre perdia para a voz do Windows, e a
       Thalita nunca falava. Agora so cai na reserva se ela falhar ou
       passar de 12 s. */
    function tocarPedaco(){
      if(g!==geracao || desistiu) return;
      var este = proximo;
      i++;
      proximo = i<lista.length ? pedir(lista[i]) : null;
      if(proximo) proximo.catch(function(){});
      este.then(function(blob){
        if(g!==geracao || desistiu) return;
        var a = new Audio(URL.createObjectURL(blob));
        amplificar(a);   /* 17/11: a local tambem estava baixa */
        tocando = a;
        a.onended = function(){
          try{ URL.revokeObjectURL(a.src); }catch(e){}
          if(g!==geracao) return;
          tocando=null;
          if(proximo) tocarPedaco(); else terminou(u,g);
        };
        a.onerror = function(){ if(g===geracao) terminou(u,g,"audio-busy"); };
        return a.play().then(function(){
          if(!comecou){ comecou=true; evento(u,"start"); }
        });
      }).catch(function(){
        if(g!==geracao || desistiu) return;
        /* servidor de voz fora: o resto da frase vai pela voz do Windows */
        if(!comecou){ falarNativo(u,g,false); }
        else terminou(u,g,"synthesis-failed");
      });
    }
    tocarPedaco();
  }

  /* Voz online: o audio TOCA ENQUANTO CHEGA (o servidor manda aos pedacos),
     como era no Edge. O proximo trecho ja comeca a baixar enquanto o atual
     toca. Se der erro antes de comecar, vai pela voz do Windows. */
  /* 17/11: as vozes saiam baixas ("quase cochichando"), a da Microsoft e
     tambem a local. O som delas passa por um amplificador (ganho 2,2x) e um
     compressor que segura os picos, para nao estourar. */
  var ctxVoz = null, entradaVoz = null;
  function amplificar(a){
    try{
      if(!ctxVoz){
        ctxVoz = new (window.AudioContext||window.webkitAudioContext)();
        var comp = ctxVoz.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.2;
        entradaVoz = ctxVoz.createGain(); entradaVoz.gain.value = 2.2;
        entradaVoz.connect(comp); comp.connect(ctxVoz.destination);
      }
      /* contexto parado: toca sem o amplificador, mas nunca mudo */
      if(ctxVoz.state !== "running"){ ctxVoz.resume(); return; }
      ctxVoz.createMediaElementSource(a).connect(entradaVoz);
    }catch(e){}
  }
  function falarEdge(u, g, v){
    var lista = pedacos(u.text), i = 0, comecou = false;
    if(!lista.length){ evento(u,"start"); terminou(u,g); return; }
    function criar(t){
      var a = new Audio();
      a.preload = "auto";
      amplificar(a);
      a.src = "/api/voz-edge/fala?voz=" + encodeURIComponent(v._edge) +
              "&vel=" + encodeURIComponent(u.rate || 1) + "&texto=" + encodeURIComponent(t);
      return a;
    }
    var prox = criar(lista[0]);
    function falhou(){
      if(g!==geracao) return;
      if(!comecou) falarNativo(u,g,false); else terminou(u,g,"synthesis-failed");
    }
    function tocar(){
      if(g!==geracao) return;
      var a = prox; i++;
      prox = i < lista.length ? criar(lista[i]) : null;
      tocando = a;
      a.onended = function(){
        if(g!==geracao) return;
        tocando = null;
        if(prox) tocar(); else terminou(u,g);
      };
      a.onerror = falhou;
      a.play().then(function(){
        if(g===geracao && !comecou){ comecou = true; evento(u,"start"); }
      }).catch(falhou);
    }
    tocar();
  }

  var ouvintes = [];
  function avisarVozes(){
    if(typeof onvc==="function") try{ onvc(); }catch(e){}
    ouvintes.forEach(function(f){ try{ f(); }catch(e){} });
  }
  var sintese = {
    get speaking(){ return !!atual; },
    get pending(){ return fila.length>0; },
    get paused(){ return false; },
    get onvoiceschanged(){ return onvc; },
    set onvoiceschanged(f){ onvc=f; },
    getVoices: function(){ return KOKORO.concat(EDGE, vozesNativas()); },
    speak: function(u){ fila.push(u); proxima(); },
    cancel: function(){
      geracao++;
      var u=atual, resto=fila; atual=null; fila=[];
      pararAudio();
      try{ if(nativo) nativo.cancel(); }catch(e){}
      if(u) evento(u,"error","interrupted");
      resto.forEach(function(x){ evento(x,"error","canceled"); });
    },
    pause: function(){ if(tocando) try{ tocando.pause(); }catch(e){} },
    resume: function(){ if(tocando) try{ tocando.play(); }catch(e){} },
    addEventListener: function(t,f){ if(t==="voiceschanged" && ouvintes.indexOf(f)<0) ouvintes.push(f); },
    removeEventListener: function(t,f){ var k=ouvintes.indexOf(f); if(k>=0) ouvintes.splice(k,1); }
  };
  if(nativo) nativo.addEventListener("voiceschanged", avisarVozes);
  carregarListaEdge();
  /* Voz escolhida: se nada foi escolhido ainda no app, comeca pela do
     servidor (Kokoro), nao pela do Windows. */
  try{
    var esc = localStorage.getItem("jarvis.voz")||"";
    /* vazio, ou uma voz online do Edge, que nao existe aqui */
    var nomes = KOKORO.concat(EDGE).map(function(v){ return v.name; });
    if(!esc || (/Online|Natural/.test(esc) && nomes.indexOf(esc) < 0)){
      /* nome do Edge ("Microsoft Francisca Online...") vira a voz online igual */
      var igual = EDGE.filter(function(v){ return esc.indexOf(v.name.split(" ")[0]) >= 0; })[0];
      localStorage.setItem("jarvis.voz", (igual || KOKORO[0]).name);
    }
  }catch(e){}
  /* A tela faz u.voice = voz. O navegador so aceita ali voz DELE, e as do
     Kokoro nao sao; a frase passa a guardar qualquer voz. */
  var Original = window.SpeechSynthesisUtterance;
  if(Original){
    var Fala = class extends Original {
      get voice(){ return this._voz || null; }
      set voice(v){ this._voz = v || null; if(v && !v._kokoro && !v._edge){ try{ super.voice = v; }catch(e){} } }
    };
    try{ Object.defineProperty(window,"SpeechSynthesisUtterance",{value:Fala, configurable:true, writable:true}); }catch(e){}
  }
  try{
    Object.defineProperty(window,"speechSynthesis",{value:sintese, configurable:true, writable:true});
  }catch(e){ try{ window.speechSynthesis = sintese; }catch(x){} }

  /* ===================== OUVIR (Whisper) ===================== */
  /* Frases que o Whisper inventa no silencio (vem das legendas com que
     ele foi treinado). Se a "fala" for so isso, nao houve fala. */
  var FANTASMAS = /^(legendas? (pela|por)|amara\.org|inscreva-se|obrigad[oa] por assistir|tchau[.!]?$|\.+$)/i;

  function wav(blocos, taxa){
    var alvo = 16000, total = 0;
    blocos.forEach(function(b){ total += b.length; });
    var junto = new Float32Array(total), p = 0;
    blocos.forEach(function(b){ junto.set(b,p); p += b.length; });
    var fator = taxa/alvo, n = Math.floor(total/fator);
    var buf = new ArrayBuffer(44 + n*2), d = new DataView(buf);
    function txt(o,s){ for(var i=0;i<s.length;i++) d.setUint8(o+i,s.charCodeAt(i)); }
    txt(0,"RIFF"); d.setUint32(4,36+n*2,true); txt(8,"WAVE"); txt(12,"fmt ");
    d.setUint32(16,16,true); d.setUint16(20,1,true); d.setUint16(22,1,true);
    d.setUint32(24,alvo,true); d.setUint32(28,alvo*2,true); d.setUint16(32,2,true);
    d.setUint16(34,16,true); txt(36,"data"); d.setUint32(40,n*2,true);
    for(var i=0;i<n;i++){
      /* media do trecho: reamostra sem serrilhar */
      var a = Math.floor(i*fator), b = Math.min(total, Math.floor((i+1)*fator)), s = 0;
      for(var k=a;k<b;k++) s += junto[k];
      var v = Math.max(-1, Math.min(1, s/Math.max(1,b-a)));
      d.setInt16(44+i*2, v<0 ? v*0x8000 : v*0x7fff, true);
    }
    return new Blob([buf],{type:"audio/wav"});
  }

  function Reconhecedor(){
    this.lang="pt-BR"; this.interimResults=false; this.continuous=false;
    this.maxAlternatives=1;
    this.onresult=this.onerror=this.onend=this.onstart=null;
    this.onspeechstart=this.onspeechend=this.onaudiostart=this.onaudioend=null;
    this._s=null;
  }
  function chamar(rec, nome, ev){
    var f = rec["on"+nome];
    if(typeof f==="function"){ try{ f.call(rec, ev||{type:nome}); }catch(e){ setTimeout(function(){ throw e; }); } }
  }
  Reconhecedor.prototype.start = function(){
    if(this._s) throw new DOMException("O reconhecimento ja esta ouvindo.","InvalidStateError");
    var s = {vivo:true, parar:""};
    this._s = s;
    ouvir(this, s);
  };
  Reconhecedor.prototype.stop  = function(){ if(this._s) this._s.parar = this._s.parar || "final"; };
  Reconhecedor.prototype.abort = function(){ if(this._s) this._s.parar = "abortar"; };

  function encerrar(rec, s, erro, resultado){
    if(rec._s !== s) return;
    rec._s = null;
    if(resultado){
      var alt = {transcript:resultado, confidence:0.9};
      var linha = [alt]; linha.isFinal = true; linha.item = function(i){ return linha[i]; };
      var lista = [linha]; lista.item = function(i){ return lista[i]; };
      chamar(rec,"result",{type:"result", resultIndex:0, results:lista});
    }else if(erro){
      chamar(rec,"error",{type:"error", error:erro, message:erro});
    }
    chamar(rec,"end");
  }

  async function ouvir(rec, s){
    var fluxo, ctx, src, proc;
    try{
      fluxo = await navigator.mediaDevices.getUserMedia({audio:{
        echoCancellation:true, noiseSuppression:true, autoGainControl:true}});
    }catch(e){ encerrar(rec, s, "not-allowed"); return; }
    if(s.parar==="abortar"){ fluxo.getTracks().forEach(function(t){t.stop();}); encerrar(rec,s,null); return; }
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    try{ await ctx.resume(); }catch(e){}
    src = ctx.createMediaStreamSource(fluxo);
    proc = ctx.createScriptProcessor(4096,1,1);
    src.connect(proc); proc.connect(ctx.destination);
    var taxa = ctx.sampleRate;
    chamar(rec,"start"); chamar(rec,"audiostart");

    var antes=[], gravado=[], falou=false, t=0, vozMs=0, silMs=0, falaMs=0;
    var fundo=0, amostras=0;

    function fechar(){
      s.vivo=false;
      try{ proc.onaudioprocess=null; src.disconnect(); proc.disconnect(); }catch(e){}
      fluxo.getTracks().forEach(function(tr){ tr.stop(); });
      try{ ctx.close(); }catch(e){}
      chamar(rec,"audioend");
    }
    function transcrever(){
      fechar(); chamar(rec,"speechend");
      if(falaMs < 250){ encerrar(rec,s,"no-speech"); return; }
      var form = new FormData();
      form.append("file", wav(gravado, taxa), "fala.wav");
      form.append("language", (rec.lang||"pt").slice(0,2));
      fetch("/v1/speech/transcribe",{method:"POST", body:form})
        .then(function(r){ if(!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function(d){
          if(s.parar==="abortar"){ encerrar(rec,s,null); return; }
          var txt = String(d && d.text || "").trim();
          if(!txt || FANTASMAS.test(txt)) encerrar(rec,s,"no-speech");
          else encerrar(rec,s,null,txt);
        })
        .catch(function(){ encerrar(rec,s,"servidor de voz fora do ar"); });
    }

    proc.onaudioprocess = function(e){
      if(!s.vivo) return;
      var x = new Float32Array(e.inputBuffer.getChannelData(0));
      var soma=0; for(var i=0;i<x.length;i++) soma += x[i]*x[i];
      var rms = Math.sqrt(soma/x.length), dt = x.length/taxa*1000;
      t += dt;

      if(s.parar==="abortar"){ fechar(); encerrar(rec,s,null); return; }
      if(s.parar==="final"){
        if(falou){ transcrever(); } else { fechar(); encerrar(rec,s,null); }
        return;
      }
      if(!falou){
        antes.push(x);
        while(antes.length*x.length/taxa > 0.5) antes.shift();   /* meio segundo antes */
        if(t < 350){ fundo = (fundo*amostras + rms)/(++amostras); return; }  /* mede o ambiente */
        var limiar = Math.max(0.012, fundo*3);
        if(rms > limiar){
          vozMs += dt;
          if(vozMs >= 120){ falou=true; gravado=antes.slice(); antes=[]; falaMs=vozMs; chamar(rec,"speechstart"); }
        }else{
          vozMs = 0; fundo = fundo*0.95 + rms*0.05;
        }
        if(t > 8000){ fechar(); encerrar(rec,s,"no-speech"); }
        return;
      }
      gravado.push(x);
      if(rms < Math.max(0.008, fundo*2)) silMs += dt; else { silMs = 0; falaMs += dt; }
      var dur = gravado.length*x.length/taxa*1000;
      if(silMs >= 900 || dur > 15000) transcrever();
    };
  }

  try{
    Object.defineProperty(window,"SpeechRecognition",{value:Reconhecedor, configurable:true, writable:true});
    Object.defineProperty(window,"webkitSpeechRecognition",{value:Reconhecedor, configurable:true, writable:true});
  }catch(e){ window.SpeechRecognition = Reconhecedor; }
  window.jarvisVozLocal = true;
})();

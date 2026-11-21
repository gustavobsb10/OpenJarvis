/* Navegador DENTRO da tela do Jarvis — 16/11/2026.

   So existe no app proprio (Jarvis.exe): e la que o preload cria a ponte
   window.jarvisNavegador. No Edge este arquivo nao faz nada, e os sites
   continuam abrindo em aba nova, como antes.

   A pagina desenha a moldura (barra de endereco, voltar, fechar) e marca o
   retangulo onde o site deve aparecer; quem desenha o site e o app, por
   cima desse retangulo, num perfil separado que nao enxerga nada do
   Jarvis. */
(function(){
  "use strict";
  var ponte = window.jarvisNavegador;
  if(!ponte) return;

  var css = document.createElement("style");
  css.textContent =
    "#navPainel{position:fixed;inset:58px 34px 30px 34px;z-index:150;display:none;flex-direction:column;" +
      "border:1px solid rgba(111,227,242,.55);background:rgba(2,6,14,.94);" +
      "box-shadow:0 0 0 1px rgba(111,227,242,.08),0 30px 90px -30px rgba(47,182,230,.7)}" +
    "#navPainel.aberto{display:flex}" +
    "#navBarra{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid rgba(111,227,242,.25)}" +
    "#navBarra button{flex:none;min-width:34px;height:30px;padding:0 10px;border:1px solid rgba(111,227,242,.35);" +
      "background:#06101c;color:#8fe6ff;font:600 13px/1 ui-monospace,Consolas,monospace;cursor:pointer}" +
    "#navBarra button:hover:not(:disabled){border-color:#8fe6ff;background:#0b1a2a}" +
    "#navBarra button:disabled{opacity:.35;cursor:default}" +
    "#navEnd{flex:1;min-width:0;height:30px;padding:0 10px;border:1px solid rgba(111,227,242,.35);" +
      "background:#030a14;color:#dff8ff;font:13px/1 ui-monospace,Consolas,monospace;outline:none}" +
    "#navEnd:focus{border-color:#8fe6ff;box-shadow:0 0 0 2px rgba(111,227,242,.18)}" +
    "#navTitulo{flex:none;max-width:22%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" +
      "color:rgba(143,230,255,.7);font:11px/1 ui-monospace,Consolas,monospace;letter-spacing:.08em}" +
    "#navArea{flex:1;position:relative;background:#fff}" +
    "#navCarregando{position:absolute;left:0;top:0;height:2px;width:0;background:#6fe3f2;" +
      "box-shadow:0 0 12px #6fe3f2;transition:width .4s}" +
    "#navPainel.carregando #navCarregando{width:70%}" +
    "#navChip{position:fixed;right:18px;bottom:18px;z-index:150;display:none;align-items:center;gap:8px;" +
      "max-width:min(340px,70vw);padding:9px 14px;border:1px solid rgba(111,227,242,.55);background:rgba(2,6,14,.94);" +
      "color:#8fe6ff;font:600 12px/1 ui-monospace,Consolas,monospace;letter-spacing:.06em;cursor:pointer;" +
      "box-shadow:0 12px 40px -14px rgba(47,182,230,.8)}" +
    "#navChip.mostra{display:flex}" +
    "#navChip:hover{border-color:#8fe6ff;background:#0b1a2a}" +
    "#navChip span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}" +
    "@media (max-width:700px){#navPainel{inset:46px 6px 6px 6px}#navTitulo{display:none}}";
  document.head.appendChild(css);

  var p = document.createElement("section");
  p.id = "navPainel";
  p.setAttribute("aria-label","Navegador");
  p.innerHTML =
    '<div id="navBarra">' +
      '<button id="navVoltar" title="Voltar" aria-label="Voltar">&#8592;</button>' +
      '<button id="navAvancar" title="Avançar" aria-label="Avançar">&#8594;</button>' +
      '<button id="navRecarregar" title="Recarregar" aria-label="Recarregar">&#8635;</button>' +
      '<input id="navEnd" type="text" spellcheck="false" autocomplete="off" placeholder="Endereço ou pesquisa" aria-label="Endereço">' +
      '<span id="navTitulo"></span>' +
      '<button id="navFora" title="Abrir no navegador do Windows" aria-label="Abrir fora">&#8599;</button>' +
      '<button id="navMin" title="Minimizar (a pagina continua aberta)" aria-label="Minimizar">&#9601;</button>' +
      '<button id="navFechar" title="Fechar (Esc)" aria-label="Fechar">&#10005;</button>' +
    '</div>' +
    '<div id="navArea"><div id="navCarregando"></div></div>';
  /* minimizado: o site sai da frente mas continua carregado; este botao
     no canto traz de volta do jeito que estava */
  var chip = document.createElement("button");
  chip.id = "navChip"; chip.type = "button";
  chip.title = "Voltar ao navegador";
  chip.innerHTML = '&#9635; <span id="navChipTitulo">Navegador</span>';
  function montar(){ document.body.appendChild(p); document.body.appendChild(chip); }
  if(document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);

  function $(id){ return document.getElementById(id); }
  var aberto = false, minimizado = false, ultimaUrl = "";

  function retangulo(){
    var r = $("navArea").getBoundingClientRect();
    return {x:r.left, y:r.top, w:r.width, h:r.height};
  }
  /* "youtube.com", "g1", "previsao do tempo" -> endereco de verdade */
  function endereco(t){
    t = String(t||"").trim();
    if(!t) return "";
    if(/^https?:\/\//i.test(t)) return t;
    if(/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return "https://" + t;
    return "https://www.google.com/search?q=" + encodeURIComponent(t);
  }

  function abrir(url){
    url = endereco(url);
    if(!/^https?:\/\//i.test(url)) return false;
    if(document.documentElement.classList.contains("travado")) return false;  /* nunca por cima da fechadura */
    p.classList.add("aberto"); aberto = true;
    minimizado = false; chip.classList.remove("mostra");
    $("navEnd").value = url;
    /* espera a moldura existir na tela para medir o retangulo */
    requestAnimationFrame(function(){ ponte.abrir(url, retangulo()); });
    return true;
  }
  function fechar(){
    if(!aberto && !minimizado) return;
    ponte.fechar();
    p.classList.remove("aberto"); aberto = false;
    minimizado = false; chip.classList.remove("mostra");
  }
  function minimizar(){
    if(!aberto) return;
    if(ponte.esconder) ponte.esconder(); else ponte.fechar();
    p.classList.remove("aberto"); aberto = false;
    minimizado = true;
    $("navChipTitulo").textContent = $("navTitulo").textContent || "Navegador";
    chip.classList.add("mostra");
  }
  function restaurar(){
    if(!minimizado) return false;
    p.classList.add("aberto"); aberto = true;
    minimizado = false; chip.classList.remove("mostra");
    requestAnimationFrame(function(){
      /* app antigo, sem "mostrar": reabre o mesmo endereco */
      if(ponte.mostrar) ponte.mostrar(retangulo());
      else ponte.abrir(ultimaUrl || "https://www.google.com", retangulo());
    });
    return true;
  }

  ponte.aoMudar(function(e){
    if(!e) return;
    if(e.url && /^https?:/i.test(e.url)) ultimaUrl = e.url;
    if(document.activeElement !== $("navEnd") && e.url) $("navEnd").value = e.url;
    $("navTitulo").textContent = e.titulo || "";
    $("navVoltar").disabled = !e.voltar;
    $("navAvancar").disabled = !e.avancar;
    p.classList.toggle("carregando", !!e.carregando);
  });
  /* link que a tela abriria em janela nova vem para ca */
  ponte.aoPedir(function(url){ abrir(url); });

  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest("#navBarra button");
    if(!b) return;
    if(b.id === "navFechar") fechar();
    else if(b.id === "navMin") minimizar();
    else if(b.id === "navVoltar") ponte.comando("voltar");
    else if(b.id === "navAvancar") ponte.comando("avancar");
    else if(b.id === "navRecarregar") ponte.comando("recarregar");
    else if(b.id === "navFora") ponte.comando("fora");
  });
  chip.addEventListener("click", restaurar);
  document.addEventListener("keydown", function(e){
    if(e.target && e.target.id === "navEnd"){
      e.stopPropagation();
      if(e.key === "Enter"){ e.preventDefault(); abrir(e.target.value); e.target.blur(); }
      if(e.key === "Escape") e.target.blur();
      return;
    }
    if(e.key === "Escape" && aberto){ e.stopPropagation(); fechar(); }
  }, true);

  var mover = function(){ if(aberto) ponte.mover(retangulo()); };
  window.addEventListener("resize", mover);
  if(window.ResizeObserver){
    var ro = new ResizeObserver(mover);
    (function observar(){ var a = $("navArea"); if(a) ro.observe(a); else setTimeout(observar, 200); })();
  }
  /* saiu da tela (foi para o holograma, por exemplo): o site some junto */
  window.addEventListener("pagehide", function(){ try{ ponte.fechar(); }catch(e){} });

  window.jarvisPainel = { abrir:abrir, fechar:fechar, minimizar:minimizar, restaurar:restaurar,
    get aberto(){ return aberto; }, get minimizado(){ return minimizado; } };
})();

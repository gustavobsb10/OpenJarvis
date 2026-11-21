/* Janela propria do Jarvis (16/11/2026).
   Ate aqui a tela do Jarvis era o Edge em modo aplicativo. Para ter um
   NAVEGADOR DE VERDADE DENTRO DA TELA, o Jarvis precisa de uma janela que
   seja dele: este programa (Electron) abre o Jarvis e, quando a tela pede,
   encaixa um navegador num retangulo que ela indica.

   Separacao que importa: o navegador embutido roda num perfil SEPARADO
   (cookies e logins so dele), sem acesso a nada do Jarvis — ele nao enxerga
   a ponte de comandos, nao le os arquivos, nao fala com o servidor do Jarvis
   por conta propria. So a tela do Jarvis (127.0.0.1:8000) recebe a ponte. */
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, net } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");

const JARVIS = "http://127.0.0.1:8000";
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let janela = null, nav = null, visivel = false;

function ehJarvis(url) {
  try { const u = new URL(url); return u.origin === JARVIS; } catch (e) { return false; }
}
function siteValido(url) {
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:"; }
  catch (e) { return false; }
}

function avisarTela() {
  if (!janela || !nav) return;
  const w = nav.webContents;
  janela.webContents.send("nav:estado", {
    url: w.getURL(), titulo: w.getTitle(), carregando: w.isLoading(),
    voltar: w.navigationHistory.canGoBack(), avancar: w.navigationHistory.canGoForward(),
    visivel
  });
}

function criarNavegador() {
  if (nav) return nav;
  const perfil = session.fromPartition("persist:navegador");
  /* o navegador embutido nao ganha camera, microfone nem notificacoes */
  perfil.setPermissionRequestHandler((wc, perm, ok) => ok(perm === "fullscreen"));
  nav = new WebContentsView({
    webPreferences: { session: perfil, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  nav.setBackgroundColor("#ffffff");
  const w = nav.webContents;
  /* janela nova (target=_blank) abre no proprio navegador embutido */
  w.setWindowOpenHandler(({ url }) => { if (siteValido(url)) w.loadURL(url); return { action: "deny" }; });
  w.on("will-navigate", (e, url) => { if (!siteValido(url)) e.preventDefault(); });
  ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]
    .forEach(ev => w.on(ev, avisarTela));
  return nav;
}

function encaixar(r) {
  if (!nav || !r) return;
  const b = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(50, Math.round(r.w)), height: Math.max(50, Math.round(r.h)) };
  nav.setBounds(b);
}

/* ---- ponte: so a tela do Jarvis pode usar ---- */
function daTela(e) { return janela && e.sender === janela.webContents && ehJarvis(e.sender.getURL()); }
ipcMain.on("nav:abrir", (e, { url, ret }) => {
  if (!daTela(e) || !siteValido(url)) return;
  criarNavegador();
  if (!visivel) { janela.contentView.addChildView(nav); visivel = true; }
  encaixar(ret);
  nav.webContents.loadURL(url);
  avisarTela();
});
ipcMain.on("nav:mover", (e, ret) => { if (daTela(e)) encaixar(ret); });
/* fechar = acabou: a pagina e descarregada (video e som param junto) */
ipcMain.on("nav:fechar", (e) => {
  if (!daTela(e) || !nav) return;
  if (visivel) { janela.contentView.removeChildView(nav); visivel = false; }
  try { nav.webContents.loadURL("about:blank"); } catch (_) {}
  avisarTela();
});
/* minimizar = so sai da frente: a pagina continua carregada como estava */
ipcMain.on("nav:esconder", (e) => {
  if (!daTela(e) || !nav || !visivel) return;
  janela.contentView.removeChildView(nav); visivel = false; avisarTela();
});
ipcMain.on("nav:mostrar", (e, ret) => {
  if (!daTela(e) || !nav || visivel) return;
  janela.contentView.addChildView(nav); visivel = true;
  encaixar(ret); avisarTela();
});
ipcMain.on("nav:comando", (e, cmd) => {
  if (!daTela(e) || !nav) return;
  const w = nav.webContents, h = w.navigationHistory;
  if (cmd === "voltar" && h.canGoBack()) h.goBack();
  else if (cmd === "avancar" && h.canGoForward()) h.goForward();
  else if (cmd === "recarregar") w.reload();
  else if (cmd === "fora" && siteValido(w.getURL())) shell.openExternal(w.getURL());
});

/* Jarvis.exe abre sozinho: se o servidor nao esta no ar, sobe ele
   escondido (subir-servidor.bat, a mesma logica do OpenJarvis.bat) e mostra
   uma tela de espera ate ele responder. */
const ESPERA = "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#02050c;color:#8fe6ff;font:500 13px ui-monospace,Consolas,monospace;letter-spacing:.3em;text-transform:uppercase"><div style="text-align:center"><div style="width:90px;height:90px;margin:0 auto 26px;border-radius:50%;background:radial-gradient(circle,#fff 0,#6fe3f2 18%,#1b6f9a 45%,transparent 70%);box-shadow:0 0 60px #2fb6e6;animation:p 1.6s ease-in-out infinite"></div>Iniciando o Jarvis<style>@keyframes p{50%{transform:scale(.86);opacity:.7}}</style></div></body></html>`);
function servidorNoAr() {
  return new Promise(ok => {
    const r = net.request(JARVIS + "/health");
    r.on("response", res => ok(res.statusCode < 500)); r.on("error", () => ok(false)); r.end();
  });
}
function subirServidor() {
  const candidatos = [path.join(os.homedir(), "Documents", "OpenJarvis", "jarvis-app", "subir-servidor.bat"),
                      path.join(__dirname, "subir-servidor.bat")];
  const bat = candidatos.find(p => fs.existsSync(p));
  if (!bat) return;
  spawn("cmd.exe", ["/c", bat], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
}
async function abrirJarvis() {
  if (!(await servidorNoAr())) {
    janela.loadURL(ESPERA);
    subirServidor();
    for (let i = 0; i < 90 && !(await servidorNoAr()); i++) await new Promise(r => setTimeout(r, 2000));
  }
  janela.loadURL(JARVIS + "/");
}

/* uma janela so: abrir de novo traz a que ja existe para a frente */
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on("second-instance", () => { if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); } });

app.whenReady().then(() => {
  /* a tela do Jarvis pode usar camera e microfone (rosto, gestos, voz) */
  session.defaultSession.setPermissionRequestHandler((wc, perm, ok) => {
    ok(ehJarvis(wc.getURL()) && ["media", "fullscreen", "clipboard-sanitized-write"].includes(perm));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origem) => ehJarvis(origem || "") && perm === "media");
  janela = new BrowserWindow({
    width: 1280, height: 860, backgroundColor: "#02050c", title: "Jarvis", autoHideMenuBar: true,
    icon: path.join(__dirname, "jarvis.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true }
  });
  /* links que a tela do Jarvis abriria em janela nova vao para o navegador embutido */
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (siteValido(url) && !ehJarvis(url)) { janela.webContents.send("nav:pedido", url); }
    return { action: ehJarvis(url) ? "allow" : "deny" };
  });
  /* A tela do Jarvis nunca sai do Jarvis: se algo tentar levar a janela
     para um site (um link comum, um location.href), o site abre no
     navegador de dentro e a tela fica onde esta. */
  janela.webContents.on("will-navigate", (e, url) => {
    if (ehJarvis(url) || url.startsWith("data:")) return;
    e.preventDefault();
    if (siteValido(url)) janela.webContents.send("nav:pedido", url);
  });
  /* trocou de tela (holograma, universo...): o site embutido some junto */
  janela.webContents.on("did-start-navigation", (ev, url, mesmaPagina, quadroPrincipal) => {
    const principal = ev && ev.isMainFrame !== undefined ? ev.isMainFrame : quadroPrincipal;
    const mesma = ev && ev.isSameDocument !== undefined ? ev.isSameDocument : mesmaPagina;
    if (principal && !mesma && nav && visivel) {
      janela.contentView.removeChildView(nav); visivel = false;
    }
  });
  abrirJarvis();
});
app.on("window-all-closed", () => app.quit());

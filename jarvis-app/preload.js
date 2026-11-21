/* Ponte entre a tela do Jarvis e o navegador embutido. So existe quando a
   pagina e a do proprio Jarvis (127.0.0.1:8000); em qualquer outro endereco
   nao expoe nada. */
const { contextBridge, ipcRenderer } = require("electron");
if (location.origin === "http://127.0.0.1:8000") {
  contextBridge.exposeInMainWorld("jarvisNavegador", {
    abrir: (url, ret) => ipcRenderer.send("nav:abrir", { url: String(url), ret }),
    mover: (ret) => ipcRenderer.send("nav:mover", ret),
    fechar: () => ipcRenderer.send("nav:fechar"),
    esconder: () => ipcRenderer.send("nav:esconder"),
    mostrar: (ret) => ipcRenderer.send("nav:mostrar", ret),
    comando: (c) => ipcRenderer.send("nav:comando", String(c)),
    aoMudar: (fn) => ipcRenderer.on("nav:estado", (_e, d) => fn(d)),
    aoPedir: (fn) => ipcRenderer.on("nav:pedido", (_e, u) => fn(u))
  });
}

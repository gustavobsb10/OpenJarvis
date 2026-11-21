"""Vozes online da Microsoft (as mesmas do Edge) para o app proprio.

Gustavo, 16/11/2026: no Edge ele usava as vozes "Online (Natural)" da
Microsoft e gostava delas — melhores que a local e sem demora. O Jarvis.exe
e um Electron e nao tem essas vozes. Estas rotas buscam o audio no mesmo
servico que o Edge usa, pelo pacote ``edge-tts``.

- ``GET /api/voz-edge/lista``: a lista REAL de vozes que a Microsoft oferece
  (todas as de portugues e todas as multilingues, que falam portugues).
- ``GET /api/voz-edge/fala``: o audio em MP3, mandado AOS PEDACOS conforme
  chega da Microsoft. A tela comeca a tocar no primeiro pedaco, sem esperar
  a frase inteira (antes levava 3,5 a 5 s; o Edge tocava na hora).
- ``POST /api/voz-edge``: a frase inteira de uma vez (mantido).

Precisa de internet; o texto falado vai para a Microsoft, como no Edge.
"""

from __future__ import annotations

import asyncio
import re
import time
import logging
import uuid
from xml.sax.saxutils import escape

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

VOZES = (
    "pt-BR-FranciscaNeural",
    "pt-BR-AntonioNeural",
    "pt-BR-ThalitaMultilingualNeural",
    "pt-PT-RaquelNeural",
    "pt-PT-DuarteNeural",
)
# Qualquer voz neural da Microsoft pelo formato do nome.
_FORMATO = re.compile(r"^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]{2,40}Neural$")
MAX_CARACTERES = 3000
TEMPO_MAXIMO = 25.0  # s para o servico responder

_lista_cache: dict = {"quando": 0.0, "vozes": None}


class PedidoVoz(BaseModel):
    texto: str
    voz: str = VOZES[0]
    velocidade: float = 1.0


def _tem_pacote() -> bool:
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        return False
    return True


def _conferir(texto: str, voz: str) -> str:
    texto = (texto or "").strip()
    if not texto:
        raise HTTPException(status_code=400, detail="Texto vazio")
    if len(texto) > MAX_CARACTERES:
        raise HTTPException(status_code=413, detail="Texto longo demais")
    if voz not in VOZES and not _FORMATO.match(voz or ""):
        raise HTTPException(status_code=400, detail="Voz invalida")
    if not _tem_pacote():
        raise HTTPException(status_code=501, detail="Pacote edge-tts nao instalado")
    return texto


def _taxa(velocidade: float) -> str:
    vel = max(0.5, min(2.0, float(velocidade or 1.0)))
    return f"{round((vel - 1.0) * 100):+d}%"


async def _proximo_audio(it) -> bytes | None:
    while True:
        try:
            pedaco = await it.__anext__()
        except StopAsyncIteration:
            return None
        if pedaco.get("type") == "audio" and pedaco.get("data"):
            return pedaco["data"]


# --------------------------------------------------------------------------
# Conexao SEMPRE ABERTA com a Microsoft (17/11).
# O edge-tts abre uma conexao nova a cada frase: ~2,5 s so de aperto de mao
# antes do primeiro som. O Edge, que falava "na hora", mantem UMA conexao
# aberta e manda as frases por ela. Aqui fazemos o mesmo: uma conexao que
# fica pronta (e e reaberta sozinha se cair), e cada frase so manda o texto.
# Se algo der errado, cai no jeito antigo (edge_tts.Communicate).
# --------------------------------------------------------------------------
_log = logging.getLogger("jarvis.voz_edge")

_CONFIG = (
    '{"context":{"synthesis":{"audio":{"metadataoptions":'
    '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}'
)


def _agora_js() -> str:
    return time.strftime("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)",
                         time.gmtime())


def _nome_completo(voz: str) -> str:
    # "pt-BR-ThalitaMultilingualNeural" -> nome que o servico espera
    partes = voz.split("-")
    if len(partes) >= 3:
        return ("Microsoft Server Speech Text to Speech Voice "
                f"({partes[0]}-{partes[1]}, {'-'.join(partes[2:])})")
    return voz


def _cabecalhos(cru: bytes) -> dict:
    saida = {}
    for linha in cru.split(b"\r\n"):
        if b":" in linha:
            k, v = linha.split(b":", 1)
            saida[k.strip().lower()] = v.strip()
    return saida


class _ConexaoEdge:
    """Conexoes com as vozes da Microsoft ABERTAS ANTES da frase chegar.

    17/11: a Microsoft so aceita uma frase por conexao, e abrir uma leva
    ~2 s. Aqui fica sempre uma conexao reserva pronta; cada frase pega a
    reserva (ou abre a sua, se nao houver) e a usa sozinha, entao duas
    frases podem tocar/baixar ao mesmo tempo sem uma esperar a outra (antes
    a segunda esperava a primeira terminar e, em noticia longa, desistia e
    a fala parava no meio). Assim que a reserva e usada, outra comeca a
    abrir.
    """

    def __init__(self) -> None:
        self._sessao = None
        self._reserva = None
        self._reserva_em = 0.0
        self._trava = asyncio.Lock()
        self._vigia = None

    def _reserva_boa(self) -> bool:
        # conexao parada ha muito tempo a Microsoft derruba; troca antes
        return (self._reserva is not None and not self._reserva.closed
                and time.time() - self._reserva_em < 50)

    async def _abrir(self):
        import ssl

        import aiohttp
        import certifi
        from edge_tts.constants import SEC_MS_GEC_VERSION, WSS_HEADERS, WSS_URL
        from edge_tts.drm import DRM

        if self._sessao is None or self._sessao.closed:
            self._sessao = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=None, connect=10, sock_read=None))
        cab = (DRM.headers_with_muid(WSS_HEADERS)
               if hasattr(DRM, "headers_with_muid") else dict(WSS_HEADERS))
        ctx = ssl.create_default_context(cafile=certifi.where())
        ws = None
        for tentativa in (1, 2):
            url = (f"{WSS_URL}&ConnectionId={uuid.uuid4().hex}"
                   f"&Sec-MS-GEC={DRM.generate_sec_ms_gec()}"
                   f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}")
            try:
                ws = await self._sessao.ws_connect(
                    url, compress=15, headers=cab, ssl=ctx, heartbeat=20)
                break
            except aiohttp.ClientResponseError as e:
                # relogio do PC fora de hora: o proprio edge-tts sabe acertar
                if e.status == 403 and tentativa == 1 and hasattr(DRM, "handle_client_response_error"):
                    DRM.handle_client_response_error(e)
                    continue
                raise
        await ws.send_str(
            f"X-Timestamp:{_agora_js()}\r\nContent-Type:application/json; charset=utf-8\r\n"
            f"Path:speech.config\r\n\r\n{_CONFIG}\r\n")
        return ws

    @staticmethod
    async def _fechar(ws) -> None:
        try:
            if ws is not None:
                await ws.close()
        except Exception:
            pass

    def manter_aberta(self) -> None:
        """Deixa sempre uma conexao reserva pronta."""
        if self._vigia is not None and not self._vigia.done():
            return

        async def vigiar() -> None:
            while True:
                try:
                    if not self._reserva_boa():
                        velha = None
                        async with self._trava:
                            if not self._reserva_boa():
                                velha, self._reserva = self._reserva, None
                        await self._fechar(velha)
                        nova = await self._abrir()
                        async with self._trava:
                            if self._reserva is None:
                                self._reserva, self._reserva_em = nova, time.time()
                                nova = None
                        await self._fechar(nova)
                except Exception as e:
                    _log.warning("voz online: nao abriu a conexao reserva: %r", e)
                # 21/11: repoe a reserva logo depois de usada (antes esperava 1 s,
                # e a frase seguinte podia abrir conexao nova e demorar)
                await asyncio.sleep(0.2)

        self._vigia = asyncio.get_running_loop().create_task(vigiar())

    async def _pegar(self):
        async with self._trava:
            ws = self._reserva if self._reserva_boa() else None
            self._reserva = None
        if ws is None:
            ws = await self._abrir()
        return ws

    async def falar(self, texto: str, voz: str, taxa: str):
        import aiohttp

        # 21/11: o idioma do texto vem da propria voz (pt-BR), nao fixo em en-US,
        # que deixava a Thalita pronunciando o portugues como ingles
        idioma = voz[:5] if len(voz) >= 5 and voz[2] == "-" else "pt-BR"
        ssml = ("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
                f"xml:lang='{idioma}'><voice name='{_nome_completo(voz)}'>"
                f"<prosody pitch='+0Hz' rate='{taxa}' volume='+0%'>"
                f"{escape(texto)}</prosody></voice></speak>")
        for tentativa in (1, 2):
            deu_som = False
            ws = None
            try:
                ws = await self._pegar()
                pedido = uuid.uuid4().hex
                await ws.send_str(
                    f"X-RequestId:{pedido}\r\nContent-Type:application/ssml+xml\r\n"
                    f"X-Timestamp:{_agora_js()}Z\r\nPath:ssml\r\n\r\n{ssml}")
                alvo = pedido.encode()
                while True:
                    msg = await asyncio.wait_for(ws.receive(), timeout=20)
                    if msg.type == aiohttp.WSMsgType.BINARY:
                        dado = msg.data
                        n = int.from_bytes(dado[:2], "big")
                        cab = _cabecalhos(dado[2:2 + n])
                        corpo = dado[2 + n:]
                        if cab.get(b"x-requestid") != alvo:
                            continue
                        if cab.get(b"path") == b"audio" and corpo:
                            deu_som = True
                            yield corpo
                    elif msg.type == aiohttp.WSMsgType.TEXT:
                        cab = _cabecalhos(msg.data.split("\r\n\r\n", 1)[0].encode())
                        if cab.get(b"x-requestid") == alvo and cab.get(b"path") == b"turn.end":
                            break
                    else:
                        raise ConnectionError("conexao com a Microsoft fechou")
                if deu_som:
                    return
                raise ConnectionError("nenhum audio")
            except GeneratorExit:
                raise
            except Exception as e:
                _log.warning("voz online: tentativa %d falhou: %r", tentativa, e)
                if deu_som or tentativa == 2:
                    raise
            finally:
                await self._fechar(ws)   # uma frase por conexao


_conexao = _ConexaoEdge()


def _nome(short: str) -> str:
    # "pt-BR-ThalitaMultilingualNeural" -> "Thalita"
    resto = short.split("-", 2)[-1]
    resto = re.sub(r"Neural$", "", resto)
    return re.sub(r"Multilingual$", "", resto) or resto


def create_voz_edge_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/voz-edge")
    async def estado() -> dict:
        return {"disponivel": _tem_pacote(), "vozes": list(VOZES)}

    @router.get("/api/voz-edge/lista")
    async def lista() -> list:
        if not _tem_pacote():
            raise HTTPException(status_code=501, detail="Pacote edge-tts nao instalado")
        try:
            _conexao.manter_aberta()
        except Exception:
            pass
        agora = time.time()
        if _lista_cache["vozes"] is not None and agora - _lista_cache["quando"] < 6 * 3600:
            return _lista_cache["vozes"]
        import edge_tts

        try:
            todas = await asyncio.wait_for(edge_tts.list_voices(), timeout=TEMPO_MAXIMO)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Lista da Microsoft indisponivel") from exc
        saida = []
        for v in todas:
            short = v.get("ShortName", "")
            local = v.get("Locale", "")
            multi = "Multilingual" in short
            if not (local.startswith("pt-") or multi):
                continue
            saida.append({
                "id": short,
                "nome": _nome(short),
                "lang": local,
                "genero": v.get("Gender", ""),
                "multilingue": multi,
            })
        # portugues do Brasil primeiro, depois Portugal, depois multilingues
        saida.sort(key=lambda x: (x["multilingue"], x["lang"] != "pt-BR", x["nome"]))
        _lista_cache.update(quando=agora, vozes=saida)
        return saida

    @router.get("/api/voz-edge/fala")
    async def fala(texto: str, voz: str = VOZES[0], vel: float = 1.0):
        texto = _conferir(texto, voz)
        taxa = _taxa(vel)
        try:
            _conexao.manter_aberta()
        except Exception:
            pass

        # 1) conexao sempre aberta (rapido)
        gen = _conexao.falar(texto, voz, taxa)
        try:
            primeiro = await asyncio.wait_for(gen.__anext__(), timeout=TEMPO_MAXIMO)
            it = None
        except Exception as e:
            _log.warning("voz online: conexao reserva falhou, usando o jeito antigo: %r", e)
            try:
                await gen.aclose()
            except Exception:
                pass
            gen = None
            # 2) reserva: o jeito antigo, uma conexao por frase
            import edge_tts

            it = edge_tts.Communicate(texto, voz, rate=taxa).stream().__aiter__()
            try:
                primeiro = await asyncio.wait_for(_proximo_audio(it), timeout=TEMPO_MAXIMO)
            except Exception as exc:
                raise HTTPException(status_code=502, detail="Servico de voz da Microsoft nao respondeu") from exc
        if not primeiro:
            raise HTTPException(status_code=502, detail="Servico de voz devolveu vazio")

        async def resto():
            yield primeiro
            try:
                if gen is not None:
                    async for pedaco in gen:
                        yield pedaco
                else:
                    while True:
                        pedaco = await asyncio.wait_for(_proximo_audio(it), timeout=TEMPO_MAXIMO)
                        if pedaco is None:
                            break
                        yield pedaco
            except Exception:
                return
            finally:
                if gen is not None:
                    try:
                        await gen.aclose()
                    except Exception:
                        pass

        return StreamingResponse(resto(), media_type="audio/mpeg",
                                 headers={"Cache-Control": "no-store"})

    @router.post("/api/voz-edge")
    async def falar(pedido: PedidoVoz) -> Response:
        texto = _conferir(pedido.texto, pedido.voz)
        it_audio = []

        async def juntar() -> bytes:
            import edge_tts

            async for pedaco in edge_tts.Communicate(
                texto, pedido.voz, rate=_taxa(pedido.velocidade)
            ).stream():
                if pedaco.get("type") == "audio":
                    it_audio.append(pedaco["data"])
            return b"".join(it_audio)

        try:
            audio = await asyncio.wait_for(juntar(), timeout=TEMPO_MAXIMO)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Servico de voz da Microsoft nao respondeu") from exc
        if not audio:
            raise HTTPException(status_code=502, detail="Servico de voz devolveu vazio")
        return Response(content=audio, media_type="audio/mpeg",
                        headers={"Cache-Control": "no-store"})

    return router

"""Duas palmas FORTES abrem o Jarvis.

Gustavo (16/11/2026). Faltava o comeco do ritual: bater palmas e o
OpenJarvis abrir sozinho. Este programa fica rodando escondido desde que o
Windows liga, ouvindo o microfone, e quando escuta DUAS PALMAS seguidas
chama o mesmo atalho da area de trabalho (OpenJarvis.bat). Dali em diante e
o caminho de sempre: tela de espera, rosto, recepcao, musica.

O que ele faz com o microfone: so mede o VOLUME de pedacinhos de 23 ms.
Nada e gravado, nada e transcrito, nada sai do computador.

Como ele separa palma de outros sons: palma e um estalo — sobe de uma vez,
bem acima do barulho do ambiente, e some em menos de um quinto de segundo.
Fala e musica tambem sobem, mas ficam. Precisa de DOIS estalos com um
intervalo de 0,2 a 0,8 s entre eles; um so (porta batendo, tecla forte) nao
dispara.

Se o Jarvis ja estiver aberto, as palmas sao ignoradas — senao a propria
musica de abertura poderia abrir uma segunda janela.

Ajustes: SENSIBILIDADE abaixo. Tudo que ele ouve de forte e anotado em
palmas.log, ao lado deste arquivo, para calibrar.
"""

from __future__ import annotations

import subprocess
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np
import sounddevice as sd

# ------------------------------------------------------------- ajustes
SENSIBILIDADE = 1.0        # >1 pega palma mais fraca; <1 exige palma mais forte
# Pedido de 16/11: so PALMAS FORTES abrem. Palma comum, conversa e barulho
# da casa ficam abaixo destes limites.
# 16/11 10h: com 0.45 e 14x NENHUMA palma chegou a ser registrada no log
# (o microfone do notebook, com reducao de ruido, achata o estalo).
# Baixado; continua exigindo DUAS palmas curtas no intervalo certo.
# 11h20: no registro, as palmas dele batem pico 0.96-1.00 e o resto da casa
# (fala, teclado) fica em 0.13-0.28 por minuto. 0.6 separa os dois com folga.
PICO_MINIMO = 0.60 / SENSIBILIDADE      # pico absoluto (0..1) de um estalo
VEZES_O_FUNDO = 7.0 / SENSIBILIDADE     # quantas vezes acima do ambiente
# 16/11 11h20: o registro mostrou a primeira palma contando e a segunda
# sumindo — o eco da sala esticava a segunda alem de 0,16 s, ou ela chegava
# grudada no eco da primeira. Agora a palma "acaba" quando cai a 30% do
# proprio pico, uma palma nova no meio do eco da anterior conta como nova,
# e o intervalo aceito ficou mais folgado.
DURACAO_MAX = 0.25         # s: palma some rapido; som que dura mais nao e palma
INTERVALO = (0.15, 1.10)   # s entre a primeira e a segunda palma
DESCANSO = 12.0            # s sem disparar de novo depois de abrir
TAXA = 44100
BLOCO = 1024               # ~23 ms

AQUI = Path(__file__).resolve().parent
LOG = AQUI / "palmas.log"
ATALHO = Path.home() / "Desktop" / "OpenJarvis.bat"
# Com o Jarvis.exe montado (janela propria), as palmas abrem ele.
# 16/11: o exe passou a sair na pasta "programa"; "dist" e a montagem antiga.
_APPS = Path.home() / "Documents" / "OpenJarvis" / "jarvis-app"
_EXES = (_APPS / "programa" / "Jarvis-win32-x64" / "Jarvis.exe",
         _APPS / "dist" / "Jarvis-win32-x64" / "Jarvis.exe")


def achar_app() -> Path | None:
    """Procura na hora de abrir: o exe pode ser refeito com as palmas ligadas."""
    return next((p for p in _EXES if p.is_file()), None)


def anotar(msg: str) -> None:
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(time.strftime("[%d/%m %H:%M:%S] ") + msg + "\n")
        if LOG.stat().st_size > 400_000:          # nao deixa crescer sem fim
            linhas = LOG.read_text(encoding="utf-8").splitlines()[-1500:]
            LOG.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    except Exception:
        pass


def jarvis_aberto() -> bool:
    """A janela do Jarvis e um Edge com perfil proprio (OpenJarvisApp)."""
    try:
        import psutil

        for p in psutil.process_iter(["name", "cmdline"]):
            nome = (p.info.get("name") or "").lower()
            if nome == "jarvis.exe":
                try:
                    caminho = (p.exe() or "").lower()
                except Exception:
                    caminho = ""
                if "jarvis-app" in caminho:   # o app, nao o servidor da .venv
                    return True
                continue
            if "msedge" in nome:
                cmd = " ".join(p.info.get("cmdline") or [])
                if "OpenJarvisApp" in cmd:
                    return True
    except Exception:
        pass
    return False


def abrir_jarvis() -> None:
    # 17/11: o SERVIDOR do Jarvis tambem roda como "jarvis.exe" (o comando
    # da .venv). Com o servidor ligado e a janela fechada, as palmas achavam
    # que o Jarvis ja estava aberto e nao faziam nada. Agora, com o app,
    # abre sempre: se a janela ja existir, o proprio app so a traz para a
    # frente (inclusive se estiver minimizada).
    app = achar_app()
    if app:
        anotar("DUAS PALMAS — abrindo (ou trazendo para a frente) o Jarvis.exe")
        subprocess.Popen([str(app)], cwd=str(app.parent))
        return
    if jarvis_aberto():
        anotar("duas palmas, mas o Jarvis ja esta aberto — ignorado")
        return
    if not ATALHO.is_file():
        anotar(f"duas palmas, mas nao achei {ATALHO}")
        return
    anotar("DUAS PALMAS — abrindo o Jarvis")
    subprocess.Popen(
        ["cmd", "/c", str(ATALHO)],
        cwd=str(ATALHO.parent),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def main() -> None:
    fundo = 0.003           # nivel do ambiente, aprendido aos poucos
    em_estalo = False
    inicio_estalo = 0.0
    pico_estalo = 0.0
    palmas: deque[float] = deque(maxlen=4)
    ultimo_disparo = -999.0
    lidas = 0              # o relogio e a propria contagem de amostras: exato
    try:
        mic = sd.query_devices(kind="input").get("name", "?")
    except Exception:
        mic = "?"
    anotar("ouvindo as palmas (sensibilidade %.2f) no microfone: %s" % (SENSIBILIDADE, mic))
    maior, desde = 0.0, 0.0   # para calibrar: o som mais forte de cada minuto
    rms_max, caiu = 0.0, False
    rms_ant = 1.0            # bloco anterior: palma SOBE DE UMA VEZ do silencio
    rms_ant2 = 1.0

    def registrar(inicio: float, pico_e: float, dur: float, fundo_agora: float) -> bool:
        """Anota uma palma; abre o Jarvis se for a segunda no intervalo certo."""
        anotar("estalo: pico %.2f, %.0f ms, fundo %.4f" % (pico_e, dur * 1000, fundo_agora))
        palmas.append(inicio)
        if len(palmas) >= 2:
            gap = palmas[-1] - palmas[-2]
            if INTERVALO[0] <= gap <= INTERVALO[1] and inicio - ultimo_disparo > DESCANSO:
                palmas.clear()
                abrir_jarvis()
                return True
        return False

    with sd.InputStream(channels=1, samplerate=TAXA, blocksize=BLOCO, dtype="float32") as fluxo:
        while True:
            dados, _ = fluxo.read(BLOCO)
            x = dados[:, 0]
            rms = float(np.sqrt(np.mean(x * x)) + 1e-9)
            pico = float(np.max(np.abs(x)))
            lidas += len(x)
            agora = lidas / TAXA
            maior = max(maior, pico)
            if agora - desde >= 60:
                if maior >= 0.08:
                    anotar("som mais forte do ultimo minuto: pico %.2f (fundo %.4f)" % (maior, fundo))
                maior, desde = 0.0, agora

            forte = pico >= PICO_MINIMO and rms >= fundo * VEZES_O_FUNDO
            # fala e musica sobem devagar; palma sobe em ate 2 blocos (~46 ms),
            # entao compara com o menor dos dois blocos anteriores
            subida = rms / max(min(rms_ant, rms_ant2), 1e-6)
            rms_ant2, rms_ant = rms_ant, rms
            if not em_estalo:
                forte = forte and subida >= 4.0
                if forte:
                    em_estalo, inicio_estalo, pico_estalo = True, agora, pico
                    rms_max, caiu = rms, False
                else:
                    # so aprende o ambiente fora dos estalos
                    fundo = fundo * 0.97 + rms * 0.03
                continue

            # palma nova chegando no meio do eco da anterior: fecha a
            # anterior aqui e comeca a nova
            if caiu and forte and subida >= 2.5 and rms >= rms_max * 0.6:
                dur = agora - inicio_estalo
                if dur <= DURACAO_MAX:
                    if registrar(inicio_estalo, pico_estalo, dur, fundo):
                        ultimo_disparo = agora
                inicio_estalo, pico_estalo, rms_max, caiu = agora, pico, rms, False
                continue

            pico_estalo = max(pico_estalo, pico)
            rms_max = max(rms_max, rms)
            if rms < rms_max * 0.45:
                caiu = True
            if rms >= max(fundo * 2.5, rms_max * 0.3):
                if agora - inicio_estalo > DURACAO_MAX + 0.4:
                    em_estalo = False           # som longo: fala/musica, nao palma
                continue

            # o som acabou: foi curto o bastante para ser palma?
            em_estalo = False
            dur = agora - inicio_estalo
            if dur > DURACAO_MAX:
                anotar("som forte mas longo demais para palma: %.0f ms" % (dur * 1000))
                continue
            if registrar(inicio_estalo, pico_estalo, dur, fundo):
                ultimo_disparo = agora


def so_um() -> object:
    """Uma copia so: se ja ha outra ouvindo, esta sai (senao duas palmas
    abririam duas janelas). A porta fica presa enquanto o programa vive."""
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 47811))
    except OSError:
        sys.exit(0)
    return s


if __name__ == "__main__":
    _trava = so_um()
    while True:                      # se o microfone sumir, tenta de novo
        try:
            main()
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as e:
            anotar(f"erro no microfone: {e!r} — tentando de novo em 10 s")
            time.sleep(10)

@echo off
REM Gustavo (16/11): chamado pelo Jarvis.exe, este arquivo roda sem console
REM proprio, e cada verificacao do PowerShell abria uma janela azul nova
REM (o "loop" da foto). Agora ele se reabre UMA vez escondido pelo
REM subir-servidor.vbs, e tudo o que roda depois herda a janela escondida.
if /i not "%~1"=="oculto" (
  wscript //nologo "%~dp0subir-servidor.vbs"
  exit /b 0
)
REM Sobe o Ollama e o servidor do Jarvis, escondidos, e sai. Usado pelo
REM Jarvis.exe (janela propria) quando ele abre e o servidor nao esta no ar.
REM E a mesma logica do OpenJarvis.bat, sem abrir janela de navegador.
set "OJ=%USERPROFILE%\Documents\OpenJarvis"
set "LOG=%OJ%\launcher.log"
echo [%date% %time%] Jarvis.exe subindo o servidor> "%LOG%"
REM --- 1) Ollama precisa estar no ar ANTES do servidor -------------
REM Se nao estiver, o Jarvis desiste dos modelos locais na
REM inicializacao e fica preso num motor errado (ocorreu em 06/11).
powershell -NoProfile -Command "try{ Invoke-WebRequest -Uri http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 goto ollama_ok

echo [%date% %time%] ollama fora do ar, subindo>> "%LOG%"
set "OLLAMA_APP=%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
if exist "%OLLAMA_APP%" (
  start "" /min "%OLLAMA_APP%"
) else (
  start "Ollama" /min cmd /c "ollama serve"
)

set /a o=0
:wait_ollama
powershell -NoProfile -Command "try{ Invoke-WebRequest -Uri http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 goto ollama_ok
set /a o+=1
if %o% geq 15 goto ollama_falhou
timeout /t 2 /nobreak >nul
goto wait_ollama

:ollama_falhou
echo  Aviso: o Ollama nao respondeu. Os modelos locais podem nao aparecer.
echo [%date% %time%] AVISO ollama nao respondeu>> "%LOG%"
goto pos_ollama

:ollama_ok
echo [%date% %time%] ollama no ar>> "%LOG%"

:pos_ollama

REM --- 1b) Pacote das vozes online (edge-tts): instala UMA vez ------
REM 16/11: sem ele as vozes Francisca/Thalita/Antonio caiam na voz do
REM Windows. Se ja estiver instalado, este passo nao faz nada.
"%OJ%\.venv\Scripts\python.exe" -c "import edge_tts" >nul 2>&1
if not errorlevel 1 goto edge_ok
echo [%date% %time%] instalando edge-tts para as vozes online>> "%LOG%"
set "UVEXE="
for %%U in (uv.exe) do if not "%%~$PATH:U"=="" set "UVEXE=%%~$PATH:U"
if not defined UVEXE if exist "%USERPROFILE%\.local\bin\uv.exe" set "UVEXE=%USERPROFILE%\.local\bin\uv.exe"
if not defined UVEXE if exist "%USERPROFILE%\.cargo\bin\uv.exe" set "UVEXE=%USERPROFILE%\.cargo\bin\uv.exe"
if defined UVEXE (
  "%UVEXE%" pip install --python "%OJ%\.venv\Scripts\python.exe" edge-tts >> "%LOG%" 2>&1
) else (
  "%OJ%\.venv\Scripts\python.exe" -m ensurepip >> "%LOG%" 2>&1
  "%OJ%\.venv\Scripts\python.exe" -m pip install edge-tts >> "%LOG%" 2>&1
)
"%OJ%\.venv\Scripts\python.exe" -c "import edge_tts" >nul 2>&1
if errorlevel 1 goto edge_falhou
echo [%date% %time%] edge-tts instalado>> "%LOG%"
goto edge_ok
:edge_falhou
echo [%date% %time%] AVISO edge-tts nao instalou>> "%LOG%"
:edge_ok

REM --- 2) Servidor do OpenJarvis -----------------------------------
powershell -NoProfile -Command "try{ Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 goto pronto

powershell -NoProfile -Command "try{ Get-Process -Id (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop).OwningProcess -ErrorAction Stop | Stop-Process -Force }catch{}" >nul 2>&1

echo [%date% %time%] subindo servidor>> "%LOG%"
REM Gustavo (14/11/2026): o servidor sobe SEM JANELA. Antes ele vivia numa
REM janela preta minimizada, e fechar essa janela matava o Jarvis na hora
REM (no log: "forrtl: error (200): program aborting due to window-CLOSE
REM event"). Sem janela nao ha o que fechar por engano. Para desligar de
REM proposito, use o "Parar Jarvis.bat" da area de trabalho.
REM Se o modo oculto nao subir, cai sozinho no modo antigo, com janela.
set "MODO=oculto"
powershell -NoProfile -Command "Start-Process -FilePath '%OJ%\start-server.bat' -WindowStyle Hidden" >nul 2>&1
if errorlevel 1 goto visivel
goto esperar

:visivel
set "MODO=visivel"
echo [%date% %time%] subindo COM janela (modo oculto nao funcionou)>> "%LOG%"
start "OpenJarvis servidor - NAO FECHE" /min "%OJ%\start-server.bat"

:esperar
set /a n=0
:wait
powershell -NoProfile -Command "try{ Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 }catch{ exit 1 }" >nul 2>&1
if not errorlevel 1 goto pronto
set /a n+=1
if %n% geq 60 goto timeout
timeout /t 2 /nobreak >nul
goto wait

:pronto
echo [%date% %time%] servidor pronto>> "%LOG%"
exit /b 0

:timeout
if "%MODO%"=="oculto" goto visivel
echo [%date% %time%] TIMEOUT>> "%LOG%"
exit /b 1

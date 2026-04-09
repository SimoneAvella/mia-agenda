@echo off
setlocal enabledelayedexpansion
cd /d %~dp0
cls
echo ============================================================
echo           AGENDA PERSONALE - ACCESSO SICURO (MFA)
echo ============================================================
echo.
echo [1] Sto verificando la rete locale...

:: Trova l'indirizzo IP locale
set "LOCAL_IP=127.0.0.1"
for /f "delims=" %%i in ('powershell -Command "(Test-Connection -ComputerName $env:COMPUTERNAME -Count 1).IPV4Address.IPAddressToString"') do set LOCAL_IP=%%i

echo Indirizzo locale per casa: http://%LOCAL_IP%:8088
echo.
echo ------------------------------------------------------------
echo [2] ACCESSO FUORI CASA (INTERNET)
echo ------------------------------------------------------------
echo Per usare l'Agenda fuori casa, apri un ALTRO terminale e scrivi:
echo    ngrok http 8088
echo.
echo Poi usa il link che ti fornira Ngrok sul tuo telefono.
echo ------------------------------------------------------------
echo.
echo Sto avviando il server e aprendo l'agenda nel browser...
echo.

:: Avvia il browser
start http://localhost:8088

:: Avvia il server Python
python -m uvicorn Backend.Backend_main:app --host 0.0.0.0 --port 8088 --log-level info

pause

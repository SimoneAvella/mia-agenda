@echo off
echo Sto spegnendo l'Agenda...
:: Trova il PID del processo sulla porta 8080 e lo chiude
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080') do (
    taskkill /f /pid %%a
)
echo Agenda spenta correttamente.
pause

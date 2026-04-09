Set WshShell = CreateObject("WScript.Shell")
' Esegue il file .bat in modalità nascosta (0)
WshShell.Run "cmd /c Avvia_Agenda.bat", 0
Set WshShell = Nothing

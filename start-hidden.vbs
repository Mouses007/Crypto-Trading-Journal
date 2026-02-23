' Startet den Crypto Trading Journal Server unsichtbar (kein CMD-Fenster).
' Doppelklick auf diese Datei oder ueber Desktop-Verknuepfung starten.
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c start.bat", 0, False

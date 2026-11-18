@echo off
rem Band Note Map - starts the small local server (only needed if MIDI is refused when opening index.html directly)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"

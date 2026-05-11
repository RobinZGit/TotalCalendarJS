@echo off
setlocal

REM One-command APK build for Windows.
REM Requires: Android SDK + JDK (project uses Java 17).

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_apk.ps1"
exit /b %ERRORLEVEL%


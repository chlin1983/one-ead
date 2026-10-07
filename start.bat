@echo off
REM Launch One EAD from the workspace root.
cd /d "%~dp0"
python run.py %*

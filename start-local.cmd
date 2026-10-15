@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Установите Python 3.10 или новее и повторите запуск.
  pause
  exit /b 1
)
echo Откройте http://127.0.0.1:8765 в браузере.
echo Для локальной LLM должна работать Ollama с моделью qwen3:4b.
python local_server.py
pause

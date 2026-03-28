@echo off
REM Скрипт запуска сервера с предварительным освобождением порта 3000

echo Stopping processes on port 3000...

REM Находим PID процесса на порту 3000
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    echo Killing process %%a on port 3000...
    taskkill /F /PID %%a 2>nul
)

REM Небольшая пауза для освобождения порта
timeout /t 2 /nobreak >nul

REM Запуск сервера
echo Starting server...
npm run start

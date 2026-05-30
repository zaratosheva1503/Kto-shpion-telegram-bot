@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo  Who Is The Spy - Telegram bot launcher
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/
  echo Then run start.bat again.
  pause
  exit /b 1
)

if not exist package.json (
  echo package.json was not found. Run start.bat from the project folder.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies into this folder...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

if not exist .env (
  echo First run: creating .env next to start.bat.
  set /p BOT_TOKEN_INPUT=Paste BOT_TOKEN from BotFather: 
  if "!BOT_TOKEN_INPUT!"=="" (
    echo BOT_TOKEN is required for the Telegram bot.
    pause
    exit /b 1
  )
  > .env echo BOT_TOKEN=!BOT_TOKEN_INPUT!
  >> .env echo PORT=3000
  >> .env echo USE_NGROK=1
  echo.
  set /p NGROK_TOKEN_INPUT=Paste ngrok authtoken or press Enter to skip: 
  if not "!NGROK_TOKEN_INPUT!"=="" >> .env echo NGROK_AUTHTOKEN=!NGROK_TOKEN_INPUT!
  echo .env file created.
)

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if not "%%A"=="" if not "%%A:~0,1"=="#" set "%%A=%%B"
)

if "%PORT%"=="" set "PORT=3000"
if "%USE_NGROK%"=="" set "USE_NGROK=1"

if /I "%USE_NGROK%"=="1" (
  if not exist "tools\ngrok.exe" (
    echo Downloading ngrok to the tools folder...
    if not exist tools mkdir tools
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'tools\ngrok.zip'; Expand-Archive -Path 'tools\ngrok.zip' -DestinationPath 'tools' -Force; Remove-Item 'tools\ngrok.zip' -Force } catch { exit 1 }"
    if errorlevel 1 (
      echo Failed to download ngrok. Check your internet or put ngrok.exe into the tools folder manually.
      pause
      exit /b 1
    )
  )

  if not "%NGROK_AUTHTOKEN%"=="" (
    tools\ngrok.exe config add-authtoken "%NGROK_AUTHTOKEN%" >nul 2>nul
  )

  echo Starting ngrok tunnel for port %PORT%...
  taskkill /IM ngrok.exe /F >nul 2>nul
  del ngrok.log >nul 2>nul
  start "ngrok tunnel" /min tools\ngrok.exe http %PORT% --log ngrok.log
  timeout /t 6 /nobreak >nul

  for /f "usebackq delims=" %%U in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 20;$i++){ try { $t=(Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels').tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1; if($t.public_url){ $t.public_url; exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"`) do set "PUBLIC_URL=%%U"

  if "!PUBLIC_URL!"=="" (
    echo ngrok did not return a public URL.
    echo Last ngrok log lines:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if(Test-Path ngrok.log){ Get-Content ngrok.log -Tail 30 }"
    echo If ngrok requires an account, check NGROK_AUTHTOKEN in .env and run again.
    pause
    exit /b 1
  )
) else (
  if "!PUBLIC_URL!"=="" set "PUBLIC_URL=http://localhost:%PORT%"
)

echo.
echo PUBLIC_URL=!PUBLIC_URL!
echo Local server: http://localhost:%PORT%
echo Press Ctrl+C to stop. You can close the ngrok window separately.
echo.
call npm start
pause

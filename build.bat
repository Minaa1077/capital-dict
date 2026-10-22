@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   《资本论》术语词典 -- 构建
echo   --------------------------------
echo.

"C:\Users\lenovo\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" scripts\build.mjs --offline

if errorlevel 1 (
  echo.
  echo   构建失败，请看上面的报错。
) else (
  echo.
  echo   站点：site\index.html
  echo   离线：dist\capital-dict-offline.html
)

echo.
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   《资本论》术语词典 -- 生成投稿材料
echo   ------------------------------------------------
echo   1/2  重新构建单文件离线版
echo   2/2  导出 Word / PDF / Excel 到 dist\投稿材料\
echo.

"C:\Users\lenovo\.workbuddy\binaries\node\versions\22.22.2-5\node.exe" scripts\build.mjs --offline
if errorlevel 1 goto fail

"C:\Users\lenovo\.workbuddy\binaries\node\versions\22.22.2-5\node.exe" scripts\make-submission.mjs
if errorlevel 1 goto fail

echo.
echo   材料已完成：dist\投稿材料\
echo   交件前记得先在站点「创作说明」页填好作者姓名、学校、联系方式，
echo   再重新跑一次本脚本，导出的文稿抬头才会带上这三项。
goto end

:fail
echo.
echo   出错了，请看上面的报错信息。

:end
echo.
pause

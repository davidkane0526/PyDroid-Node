@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

where git >nul 2>nul || (
  echo [ERROR] 未找到 Git，请先安装 Git for Windows。
  pause
  exit /b 1
)
where pnpm >nul 2>nul || (
  echo [ERROR] 未找到 pnpm，请先运行构建工具准备 Node.js / pnpm。
  pause
  exit /b 1
)

for /f "delims=" %%S in ('git status --porcelain') do set "HAS_CHANGES=1"
if not defined HAS_CHANGES (
  echo 当前没有需要提交的修改。
  pause
  exit /b 0
)

echo.
echo ==> 自动递增 PyDroid 版本号...
call pnpm version:bump
if errorlevel 1 goto :failed

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%V"
echo 当前版本：!APP_VERSION!

git add -A
if errorlevel 1 goto :failed

set "COMMIT_MESSAGE="
set /p "COMMIT_MESSAGE=提交说明（直接回车使用默认说明）: "
if not defined COMMIT_MESSAGE set "COMMIT_MESSAGE=chore: sync PyDroid v!APP_VERSION!"

git commit -m "!COMMIT_MESSAGE!"
if errorlevel 1 goto :failed

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH (
  echo [ERROR] 当前不在普通 Git 分支上。
  goto :failed
)

git remote get-url origin >nul 2>nul
if errorlevel 1 git remote add origin https://github.com/davidkane0526/PyDroid-Node.git

echo.
echo ==> 同步远端分支 !CURRENT_BRANCH! ...
git pull --rebase origin "!CURRENT_BRANCH!"
if errorlevel 1 (
  echo [ERROR] git pull --rebase 失败。请先处理冲突，再重新运行本脚本。
  goto :failed
)

git push -u origin "!CURRENT_BRANCH!"
if errorlevel 1 goto :failed

echo.
echo [OK] 已提交并推送 PyDroid v!APP_VERSION! 到 !CURRENT_BRANCH!。
pause
exit /b 0

:failed
echo.
echo [ERROR] Git 同步失败，窗口将保留以便查看上方信息。
pause
exit /b 1

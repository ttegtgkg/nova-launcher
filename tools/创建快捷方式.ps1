# 为开发版创建桌面 / 开始菜单快捷方式
#
# 用法（在项目根目录执行）：
#   powershell -ExecutionPolicy Bypass -File tools\创建快捷方式.ps1
#
# 说明：这个脚本只给「源码运行」用。如果你用安装包（NovaLauncher-Setup.exe）
# 安装，安装程序会自动创建快捷方式，不需要跑这个。

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root 'NovaLauncher.exe'
$ico  = Join-Path $root 'nova.ico'

Write-Host '== 创建 Nova Launcher 快捷方式 ==' -ForegroundColor Cyan

if (-not (Test-Path $exe)) {
  Write-Host "[错误] 找不到 $exe" -ForegroundColor Red
  Write-Host '       请先构建外壳：powershell -ExecutionPolicy Bypass -File build\build.ps1' -ForegroundColor Yellow
  exit 1
}

$sh = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path $env:USERPROFILE 'Desktop\Nova Launcher.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Nova Launcher.lnk')
)

foreach ($lnkPath in $targets) {
  $dir = Split-Path $lnkPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force }

  $lnk = $sh.CreateShortcut($lnkPath)
  $lnk.TargetPath       = $exe
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation     = $(if (Test-Path $ico) { "$ico,0" } else { "$exe,0" })
  $lnk.Description      = 'Nova Launcher - Minecraft 启动器'
  $lnk.WindowStyle      = 1
  $lnk.Save()

  Write-Host "  已创建  $lnkPath" -ForegroundColor Green
}

Write-Host ''
Write-Host '完成。桌面上双击「Nova Launcher」即可启动。' -ForegroundColor Cyan
Write-Host '提示：快捷方式指向当前项目目录，移动或删除该目录后需要重新创建。' -ForegroundColor DarkGray

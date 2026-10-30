# Nova Launcher 安装包构建脚本
# 依赖：系统自带 csc.exe（.NET Framework 4.x），无需安装任何第三方打包工具
# 用法：powershell -ExecutionPolicy Bypass -File build\build.ps1
param(
  [string]$NodeVersion = "v24.15.0",
  [string]$OutName = "NovaLauncher-Setup-1.0.0.exe"
)

$ErrorActionPreference = 'Stop'
$build = $PSScriptRoot
$root = Split-Path -Parent $build
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

Write-Host "== Nova Launcher 构建 ==" -ForegroundColor Cyan
if (-not (Test-Path $csc)) { throw "找不到 csc.exe，需要 .NET Framework 4.x" }

# ---------- 1. Node 运行时 ----------
$nodeZip = Join-Path $build "node-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
  Write-Host "[1/5] 下载 Node.js $NodeVersion 运行时 ..." -ForegroundColor Yellow
  $url = "https://npmmirror.com/mirrors/node/$NodeVersion/node-$NodeVersion-win-x64.zip"
  try {
    Invoke-WebRequest $url -OutFile $nodeZip -TimeoutSec 600 -UseBasicParsing
  } catch {
    Write-Host "  镜像失败，改用官方源 ..." -ForegroundColor DarkYellow
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $nodeZip -TimeoutSec 600 -UseBasicParsing
  }
  Write-Host "  完成: $([math]::Round((Get-Item $nodeZip).Length/1MB,1)) MB" -ForegroundColor Green
} else {
  Write-Host "[1/5] 复用已有 Node 运行时: $([math]::Round((Get-Item $nodeZip).Length/1MB,1)) MB" -ForegroundColor Green
}

# ---------- 2. WebView2 SDK（桌面外壳用，让程序有自己的窗口，不依赖浏览器） ----------
Write-Host "[2/5] 准备 WebView2 SDK ..." -ForegroundColor Yellow
$wv = Join-Path $build "webview2"
$wvShell = Join-Path $wv "shell"
$wvExt = Join-Path $wv "extracted"
New-Item -ItemType Directory -Force $wvShell | Out-Null

$needWv = -not (Test-Path (Join-Path $wvExt "lib\net462\Microsoft.Web.WebView2.Core.dll"))
if ($needWv) {
  Write-Host "  下载 NuGet 包 ..." -ForegroundColor DarkGray
  $idx = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json' -TimeoutSec 60
  $vers = $idx.versions | Where-Object { $_ -notmatch 'preview|prerelease|beta|alpha' }
  $pick = $vers[-1]
  $nupkg = Join-Path $wv "webview2.nupkg"
  Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$pick/microsoft.web.webview2.$pick.nupkg" `
    -OutFile $nupkg -TimeoutSec 300 -UseBasicParsing
  Copy-Item $nupkg (Join-Path $wv "webview2.zip") -Force
  if (Test-Path $wvExt) { Remove-Item $wvExt -Recurse -Force }
  Expand-Archive -Path (Join-Path $wv "webview2.zip") -DestinationPath $wvExt -Force
  Write-Host "  已获取 WebView2 SDK $pick" -ForegroundColor Green
} else {
  Write-Host "  复用已解压的 SDK" -ForegroundColor Green
}
Copy-Item (Join-Path $wvExt "lib\net462\Microsoft.Web.WebView2.Core.dll") $wvShell -Force
Copy-Item (Join-Path $wvExt "lib\net462\Microsoft.Web.WebView2.WinForms.dll") $wvShell -Force
Copy-Item (Join-Path $wvExt "build\native\x64\WebView2Loader.dll") $wvShell -Force

# ---------- 3. 编译桌面外壳 ----------
Write-Host "[3/5] 编译桌面外壳 NovaLauncher.exe ..." -ForegroundColor Yellow
Copy-Item (Join-Path $build "Shell.cs") $wvShell -Force
$ico = Join-Path $build "nova.ico"
if (-not (Test-Path $ico)) { throw "缺少 nova.ico" }
Copy-Item $ico $wvShell -Force
$shellExe = Join-Path $wvShell "NovaLauncher.exe"
if (Test-Path $shellExe) { Remove-Item $shellExe -Force }
& $csc /nologo /target:winexe /out:$shellExe /codepage:65001 `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  "/reference:$wvShell\Microsoft.Web.WebView2.Core.dll" `
  "/reference:$wvShell\Microsoft.Web.WebView2.WinForms.dll" `
  "/win32icon:$ico" /optimize+ (Join-Path $wvShell "Shell.cs")
if ($LASTEXITCODE -ne 0) { throw "外壳编译失败" }
Write-Host "  完成: $([math]::Round((Get-Item $shellExe).Length/1KB)) KB" -ForegroundColor Green

# ---------- 4. 收集文件并打 payload ----------
Write-Host "[4/5] 收集文件并打包 payload ..." -ForegroundColor Yellow
$stage = Join-Path $build "stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage "app") | Out-Null

$items = @('server','web','package.json','README.md','开源归属与致谢.md','start.bat','启动.bat')
foreach ($i in $items) {
  $src = Join-Path $root $i
  if (Test-Path $src) { Copy-Item $src -Destination (Join-Path $stage "app\$i") -Recurse -Force }
}
Copy-Item $nodeZip (Join-Path $stage "node.zip") -Force

# WebView2 SDK 是 BSD-3 类许可，二进制分发必须附带其许可声明与 NOTICE
foreach ($lf in @('LICENSE.txt','NOTICE.txt')) {
  $srcLic = Join-Path $wvExt $lf
  if (Test-Path $srcLic) { Copy-Item $srcLic (Join-Path $stage "app\WEBVIEW2-$lf") -Force }
  else { Write-Host "  [警告] 缺少 WebView2 $lf" -ForegroundColor DarkYellow }
}

# Node.js 是 MIT 类许可，重新分发其二进制必须附带许可声明
Add-Type -AssemblyName System.IO.Compression.FileSystem
$nz = [System.IO.Compression.ZipFile]::OpenRead($nodeZip)
$lic = $nz.Entries | Where-Object { $_.FullName -match '^[^/]+/LICENSE$' } | Select-Object -First 1
if ($lic -ne $null) {
  [void][System.IO.Compression.ZipFileExtensions]::ExtractToFile($lic, (Join-Path $stage "app\NODE-LICENSE.txt"), $true)
  Write-Host "  已附带 Node.js 许可声明" -ForegroundColor Green
}
$nz.Dispose()

# 外壳 + WebView2 依赖放在安装根目录（与 app 同级）
foreach ($f in @('NovaLauncher.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
  Copy-Item (Join-Path $wvShell $f) $stage -Force
}
Copy-Item $ico $stage -Force

$payload = Join-Path $build "payload.zip"
if (Test-Path $payload) { Remove-Item $payload -Force }
$zip = [System.IO.Compression.ZipFile]::Open($payload, 'Create')
$files = Get-ChildItem $stage -Recurse -File
foreach ($f in $files) {
  $entry = $f.FullName.Substring($stage.Length + 1).Replace('\','/')
  # node.zip 已是压缩格式，直接存储，省一次无意义的压缩
  $level = [System.IO.Compression.CompressionLevel]::Optimal
  if ($f.Name -eq 'node.zip') { $level = [System.IO.Compression.CompressionLevel]::NoCompression }
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, $level)
}
$zip.Dispose()
Write-Host "  payload.zip = $([math]::Round((Get-Item $payload).Length/1MB,2)) MB" -ForegroundColor Green

# ---------- 5. 编译安装程序 ----------
Write-Host "[5/5] 编译安装程序 ..." -ForegroundColor Yellow
$out = Join-Path $build $OutName
if (Test-Path $out) { Remove-Item $out -Force }

& $csc /nologo /target:winexe /out:$out /codepage:65001 `
  "/resource:$payload,payload.zip" `
  "/resource:$ico,nova.ico" `
  "/win32icon:$ico" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll `
  /reference:System.IO.Compression.FileSystem.dll `
  /optimize+ (Join-Path $build "Installer.cs")
if ($LASTEXITCODE -ne 0) { throw "编译失败，退出码 $LASTEXITCODE" }

Write-Host ""
Write-Host "构建完成: $out" -ForegroundColor Cyan
Write-Host "  体积: $([math]::Round((Get-Item $out).Length/1MB,2)) MB" -ForegroundColor Cyan
Write-Host "  静默安装: `"$OutName`" /S" -ForegroundColor DarkGray
Write-Host "  静默卸载: `"$OutName`" /UNINSTALL /S" -ForegroundColor DarkGray

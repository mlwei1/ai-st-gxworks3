# Generate GXW3Call interop assembly and compile Gxw3Native.exe (x86).
#
# Requirements: .NET Framework 4.x + TlbImp from Windows SDK; GX Works3 installs GXW3Call.dll.
# Output goes to tools/.cache/ (gitignored, not distributed with the repo).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-gxw3-native.ps1
$ErrorActionPreference = 'Stop'
$cache = Join-Path $PSScriptRoot '.cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null

$gxw3call = 'C:\Program Files (x86)\MELSOFT\GPPW3\GXW3Call.dll'
if (-not (Test-Path $gxw3call)) { throw "GXW3Call.dll not found: $gxw3call" }

$tlbimpCandidates = @(
  'C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\TlbImp.exe',
  'C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\x64\TlbImp.exe'
)
$tlbimp = $tlbimpCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $tlbimp) { throw 'TlbImp.exe not found (Windows SDK is required)' }

$interop = Join-Path $cache 'GXW3Call.Interop.dll'
if (-not (Test-Path $interop) -or (Get-Item $gxw3call).LastWriteTime -gt (Get-Item $interop).LastWriteTime) {
  Write-Host "[1/2] generating interop: $interop"
  & $tlbimp $gxw3call "/out:$interop" '/namespace:GXW3CallLib' | Out-Null
} else {
  Write-Host "[1/2] interop already present: $interop"
}

$csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
$exe = Join-Path $cache 'Gxw3Native.exe'
$src = Join-Path $PSScriptRoot 'Gxw3Native.cs'
Write-Host "[2/2] compiling Gxw3Native.exe (x86)"
& $csc /nologo /platform:x86 /optimize+ /target:exe "/out:$exe" "/r:$interop" $src
if ($LASTEXITCODE -ne 0) { throw "csc failed exit=$LASTEXITCODE" }
Write-Host "done: $exe"

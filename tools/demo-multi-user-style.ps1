# 多用户/多级档案演示：个人 → 公司 → 项目 三级合并后生成
#
# 运行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\demo-multi-user-style.ps1
#
# 输出目录：%TEMP%\ai-st-multi-user-demo

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$demo = Join-Path $env:TEMP 'ai-st-multi-user-demo'
Remove-Item $demo -Recurse -Force -ErrorAction SilentlyContinue
$profileDir = Join-Path $demo 'profiles'
foreach ($sub in @('user', 'company', 'project')) {
  New-Item -ItemType Directory -Path (Join-Path $profileDir $sub) -Force | Out-Null
}

function Write-Json($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
}

Write-Json (Join-Path $profileDir 'user\alice.json') @{
  schemaVersion = 1
  name = 'alice'
  scope = 'user'
  labels = @{ language = 'zh'; names = @{ X0 = '启动按钮' } }
  naming = @{ prefixes = @{ BOOL = 'q' } }
}

Write-Json (Join-Path $profileDir 'company\acme.json') @{
  schemaVersion = 1
  name = 'acme'
  scope = 'company'
  labels = @{ language = 'zh' }
  codeStructure = @{ modes = @('空闲', '运行', '手动', '停止', '故障', '暂停') }
}

Write-Json (Join-Path $profileDir 'project\robot.json') @{
  schemaVersion = 1
  name = 'robot'
  scope = 'project'
  defaults = @{ cylinderTimeoutMs = 5000 }
  codeStructure = @{ stopSequence = @{ order = @('竖直缸', '水平缸') } }
}

Write-Host '=== 1) 档案列表（目录内按 scope 排序） ==='
& node --experimental-strip-types --no-warnings src\cli.ts style list --dir $profileDir
if ($LASTEXITCODE -ne 0) { throw 'style list 失败' }

Write-Host ''
Write-Host '=== 2) 用三级档案目录生成 ==='
$genDir = Join-Path $demo 'generated'
& node --experimental-strip-types --no-warnings src\cli.ts gen specs\robot_transfer_steps_v2.json -o $genDir --style $profileDir
if ($LASTEXITCODE -ne 0) { throw '生成失败' }

$st = Join-Path $genDir 'robot_transfer_steps_v2.st'
Write-Host ''
Write-Host '=== 3) 验证合并效果 ==='
$checks = @(
  @{ pattern = '0空闲 1运行'; desc = 'company 档案模式名' },
  @{ pattern = 'q启动上升沿'; desc = 'user 档案 BOOL 前缀 q' },
  @{ pattern = '启动按钮'; desc = 'user 档案标签名' }
)
foreach ($c in $checks) {
  if (-not (Select-String -Path $st -Pattern $c.pattern -Encoding UTF8 -Quiet)) {
    throw "缺少期望内容：$($c.desc)（$($c.pattern)）"
  }
  Write-Host "  ✓ $($c.desc)"
}

Write-Host ''
Write-Host '=== 4) check-spec：spec 与档案目录的偏差 ==='
& node --experimental-strip-types --no-warnings src\cli.ts style check-spec specs\robot_transfer_steps_v2.json --style $profileDir
if ($LASTEXITCODE -ne 0) { throw 'check-spec 失败' }

Write-Host ''
Write-Host '=== 5) 档案差异审阅 ==='
& node --experimental-strip-types --no-warnings src\cli.ts style diff (Join-Path $profileDir 'user\alice.json') (Join-Path $profileDir 'company\acme.json')
if ($LASTEXITCODE -ne 0) { throw 'style diff 失败' }

Write-Host ''
Write-Host "完成。输出目录：$demo"
Write-Host "  档案：  $profileDir"
Write-Host "  生成物：$genDir"

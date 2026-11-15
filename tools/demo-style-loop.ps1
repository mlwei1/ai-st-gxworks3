# 编程习惯沉淀闭环演示：生成 → 用户修改 → 提取候选 → 采纳 → 重新生成
#
# 运行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\demo-style-loop.ps1
#
# 输出目录：%TEMP%\ai-st-style-loop-demo

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$demo = Join-Path $env:TEMP 'ai-st-style-loop-demo'
Remove-Item $demo -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $demo | Out-Null

$profile = 'profiles\industrial\robot_transfer_habits.json'
$before = Join-Path $demo 'before'
$after = Join-Path $demo 'after'
$candidatesDir = Join-Path $demo 'candidates'
$adopted = Join-Path $demo 'adopted.json'
$userSt = Join-Path $demo 'user_modified.st'
$node = 'node --experimental-strip-types --no-warnings'

Write-Host '=== 1) 用习惯档案生成基线 ST ==='
& node --experimental-strip-types --no-warnings src\cli.ts gen specs\robot_transfer_steps.json -o $before --style $profile
if ($LASTEXITCODE -ne 0) { throw '基线生成失败' }

$baselineSt = Join-Path $before 'robot_transfer_steps.st'

Write-Host ''
Write-Host '=== 2) 模拟用户修改：全局标签/局部变量改名 ==='
$src = Get-Content $baselineSt -Raw -Encoding UTF8
$src = $src.Replace('启动按钮', '开始按钮').Replace('nStep', 'n步号').Replace('bRun', 'b运行')
[IO.File]::WriteAllText($userSt, $src, (New-Object Text.UTF8Encoding($false)))
Write-Host "已写入 $userSt"

Write-Host ''
Write-Host '=== 3) 提取习惯候选 ==='
& node --experimental-strip-types --no-warnings src\cli.ts style candidates --generated $baselineSt --actual $userSt -o $candidatesDir
if ($LASTEXITCODE -ne 0) { throw '候选提取失败' }

Write-Host ''
Write-Host '=== 4) 采纳候选（写入新档案） ==='
& node --experimental-strip-types --no-warnings src\cli.ts style adopt --profile $profile --candidates (Join-Path $candidatesDir 'style_candidates.json') -o $adopted --dry-run
if ($LASTEXITCODE -ne 0) { throw '候选采纳失败' }
& node --experimental-strip-types --no-warnings src\cli.ts style adopt --profile $profile --candidates (Join-Path $candidatesDir 'style_candidates.json') -o $adopted
if ($LASTEXITCODE -ne 0) { throw '候选采纳写盘失败' }

Write-Host ''
Write-Host '=== 5) 用采纳后的档案重新生成 ==='
& node --experimental-strip-types --no-warnings src\cli.ts gen specs\robot_transfer_steps.json -o $after --style $adopted
if ($LASTEXITCODE -ne 0) { throw '重新生成失败' }

$finalSt = Join-Path $after 'robot_transfer_steps.st'
Write-Host ''
Write-Host '=== 6) 验证：用户习惯已生效 ==='
$checks = @('开始按钮', 'n步号', 'b运行')
foreach ($c in $checks) {
  $hit = Select-String -Path $finalSt -Pattern $c -Encoding UTF8 -Quiet
  if (-not $hit) { throw "重新生成结果缺少用户习惯：$c" }
  Write-Host "  ✓ $c"
}

Write-Host ''
Write-Host "完成。输出目录：$demo"
Write-Host "  基线：  $baselineSt"
Write-Host "  用户版：$userSt"
Write-Host "  候选：  $candidatesDir\style_candidates.md"
Write-Host "  新档案：$adopted"
Write-Host "  再生成：$finalSt"

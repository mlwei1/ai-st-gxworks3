# GX Works3 / Simulator3 复位脚本（仿真前清理）
# 用途：GX 被强制结束后，残留的 FSim3Dlg（模拟器窗口）会造成“模拟(n)”实例号漂移、
#       监视连到旧实例、写入看不到效果等问题。仿真前先运行本脚本清理。
# 注意：会关闭所有 GX Works3 与 GX Simulator3 进程，未保存的工程内容会丢失。

$ErrorActionPreference = 'SilentlyContinue'

$gx = Get-Process GXW3 -ErrorAction SilentlyContinue
if ($gx) {
    Write-Host "关闭 GX Works3（PID: $($gx.Id -join ', ')）…"
    $gx | Stop-Process -Force
}

$sim = Get-Process FSim3Dlg -ErrorAction SilentlyContinue
if ($sim) {
    Write-Host "关闭残留 GX Simulator3（PID: $($sim.Id -join ', ')）…"
    $sim | Stop-Process -Force
}

Start-Sleep -Seconds 2

$leftGx = @(Get-Process GXW3 -ErrorAction SilentlyContinue).Count
$leftSim = @(Get-Process FSim3Dlg -ErrorAction SilentlyContinue).Count
Write-Host "清理完成：GXW3=$leftGx, FSim3Dlg=$leftSim（都应为 0）"

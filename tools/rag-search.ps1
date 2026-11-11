#!/usr/bin/env pwsh
# 在已抽取的 RAG 手册文本里查找关键词，按「文档 + PDF 页序」输出命中位置与上下文。
#
# 前置：先运行 tools/extract-rag.ps1（生成 docs/RAG/extracted/*.txt，已 gitignore）。
#
# 用法示例：
#   pwsh tools/rag-search.ps1 -Keyword 'TON' -Doc '指令'
#   pwsh tools/rag-search.ps1 -Keyword 'LIMIT|RAMPF' -Max 30
#   pwsh tools/rag-search.ps1 -Keyword 'X1777' -Doc '应用篇'
#   pwsh tools/rag-search.ps1 -Keyword 'VAR_GLOBAL_RETAIN' -Context 3
#
# 说明：页码为按换页符计算的「PDF 页序」（封面/目录也算），与印刷页码可能相差几页。

param(
    [Parameter(Mandatory = $true)]
    [string]$Keyword,

    # 文档名过滤（正则，匹配文件名，如 '指令|程序设计'）
    [string]$Doc = '',

    # 命中行前后各显示多少行
    [int]$Context = 1,

    # 最多输出多少条命中
    [int]$Max = 20,

    [switch]$CaseSensitive
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$textDir = Join-Path $repoRoot 'docs/RAG/extracted'
if (-not (Test-Path $textDir)) {
    Write-Error "未找到抽取文本：$textDir`n请先运行：pwsh tools/extract-rag.ps1"
    exit 1
}

$files = Get-ChildItem $textDir -Filter *.txt |
    Where-Object { $Doc -eq '' -or $_.Name -match $Doc } |
    Sort-Object Name
if (-not $files) {
    Write-Error "没有匹配 -Doc '$Doc' 的文档。现有文档："
    Get-ChildItem $textDir -Filter *.txt | ForEach-Object { Write-Host "  $($_.BaseName)" }
    exit 1
}

$options = if ($CaseSensitive) {
    [System.Text.RegularExpressions.RegexOptions]::None
} else {
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
}

$total = 0
foreach ($file in $files) {
    $text = Get-Content $file.FullName -Raw -Encoding UTF8
    $pages = $text -split "`f"
    for ($p = 0; $p -lt $pages.Count; $p++) {
        if ($total -ge $Max) { break }
        $lines = $pages[$p] -split "`n"
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($total -ge $Max) { break }
            if (-not [regex]::IsMatch($lines[$i], $Keyword, $options)) { continue }
            $total++
            Write-Host ("[{0}] PDF页 {1}  (文档共 {2} 页)" -f $file.BaseName, ($p + 1), $pages.Count)
            $s = [Math]::Max(0, $i - $Context)
            $e = [Math]::Min($lines.Count - 1, $i + $Context)
            for ($j = $s; $j -le $e; $j++) {
                $mark = if ($j -eq $i) { '>>' } else { '  ' }
                Write-Host ("  {0} {1}" -f $mark, $lines[$j].TrimEnd())
            }
            Write-Host ''
        }
    }
}

if ($total -eq 0) {
    Write-Host "未找到 '$Keyword'（范围：$($files.Count) 个文档）。"
} elseif ($total -ge $Max) {
    Write-Host "已达 -Max $Max 条上限，可能还有更多命中；可缩小 -Doc 或调大 -Max。"
} else {
    Write-Host "共 $total 条命中。"
}

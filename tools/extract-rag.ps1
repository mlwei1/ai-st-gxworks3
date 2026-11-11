#!/usr/bin/env pwsh
# 提取 docs/RAG/*.pdf 的文本，供后续知识库/RAG 切块使用。
# 依赖：poppler 的 pdftotext（Windows 可用 winget/scoop 安装 poppler）。
#
# 用法：pwsh tools/extract-rag.ps1 [-OutDir docs/RAG/extracted]

param(
    [string]$OutDir = 'docs/RAG/extracted'
)

$ErrorActionPreference = 'Stop'

$pdftotext = (Get-Command pdftotext -ErrorAction SilentlyContinue).Source
if (-not $pdftotext) {
    Write-Error '未找到 pdftotext（poppler）。请先安装 poppler，并把其 bin 目录加入 PATH。'
    exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$ragDir = Join-Path $repoRoot 'docs/RAG'
$outAbs = Join-Path $repoRoot $OutDir
New-Item -ItemType Directory -Force -Path $outAbs | Out-Null

$pdfs = Get-ChildItem $ragDir -Filter *.pdf -File
if ($pdfs.Count -eq 0) {
    Write-Host "docs/RAG 下没有 PDF：$ragDir"
    exit 0
}

foreach ($pdf in $pdfs) {
    $dst = Join-Path $outAbs ($pdf.BaseName + '.txt')
    & $pdftotext -layout -enc UTF-8 $pdf.FullName $dst
    $text = Get-Content $dst -Raw -Encoding UTF8
    Write-Host ("OK  {0} -> {1}  ({2} chars)" -f $pdf.Name, $dst, $text.Length)
}

Write-Host ''
Write-Host "完成。文本在 $outAbs（已加入 .gitignore，不入库）。"

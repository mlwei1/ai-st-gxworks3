# GX Works3 OpenIF 探测脚本（32 位 PowerShell 晚绑定，无需 interop DLL）
# 用法：
#   powershell.exe -STA -File tools\gxw3-probe.ps1 -ProjectPath <gx3 副本路径> [-ImportXml <xml>]
param(
  [Parameter(Mandatory=$true)][string]$ProjectPath,
  [string]$ImportXml = ''
)
$ErrorActionPreference = 'Continue'
$result = [ordered]@{}

function New-COM([string]$clsid) {
  $t = [Type]::GetTypeFromCLSID([Guid]$clsid)
  return [Activator]::CreateInstance($t)
}
function J($k, $v) { $script:result[$k] = $v }

# CLSID
$CLSID_PRODUCT   = '8da501e2-a5c2-48f5-9e18-b396fe88c5dc'
$CLSID_TRANSMIT  = '538f4ca5-cc9d-4e21-aa5e-ae293cdeaf9a'
$CLSID_PROJECT   = 'b8fb0f14-3102-4c45-bc50-ddd931402475'
$CLSID_SESSION   = '6896a2ff-5f4e-4540-a167-00e220c5a521'

$tx = $prod = $proj = $sess = $null
try {
  $tx   = New-COM $CLSID_TRANSMIT
  $prod = New-COM $CLSID_PRODUCT
  $prod.Initialize($tx)
  try { $v = 0; $prod.GetOpenIFVersion([ref]$v); J 'openIFVersion' $v } catch { J 'openIFVersion' "ERR: $($_.Exception.Message)" }

  $sess = New-COM $CLSID_SESSION
  $sess.Initialize($tx)
  try { $sess.CheckSupport(1); J 'sessionCheckSupport' 'ok' } catch { J 'sessionCheckSupport' "ERR: $($_.Exception.Message)" }

  $proj = New-COM $CLSID_PROJECT
  $proj.Initialize($tx)
  J 'projectObject' 'created'

  # OpenProject(bstrProjectPath, wTimeOut, lUserInterfaceMode, lpbCallID, pbIsReadOnly, lplReturnCode)
  $callId = [byte]0
  $isReadOnly = [bool]$false
  $rc = [int]0
  $timeout = [uint16]60000
  try {
    $proj.OpenProject($ProjectPath, $timeout, [int]0, [ref]$callId, [ref]$isReadOnly, [ref]$rc)
    J 'openProject' "ok callId=$callId readOnly=$isReadOnly rc=$rc"
    J 'isProjectOpened' ([bool]$proj.IsProjectOpened($ProjectPath, [ref]$rc))
  } catch {
    J 'openProject' "ERR: $($_.Exception.Message)"
  }

  if ($ImportXml -and $result['openProject'] -like 'ok*') {
    $callId2 = [byte]0
    $impErr = [int]0
    $rc2 = [int]0
    try {
      $proj.ImportProjectXml($ImportXml, [int]0, [int]0, '', [ref]$impErr, [ref]$rc2)
      J 'importProjectXml' "ok errors=$impErr rc=$rc2"
    } catch { J 'importProjectXml' "ERR: $($_.Exception.Message)" }

    # RebuildProjectExt(lpbCallID, lLabelAssignmentType, bCheckProgram, lpdwError, lpdwWarning, lpdwCheckWarning, lplReturnCode)
    $callId3 = [byte]0
    $err = [int]0; $warn = [int]0; $chkWarn = [int]0; $rc3 = [int]0
    try {
      $proj.RebuildProjectExt([ref]$callId3, [int]0, [bool]$true, [ref]$err, [ref]$warn, [ref]$chkWarn, [ref]$rc3)
      J 'rebuild' "ok error=$err warning=$warn checkWarning=$chkWarn rc=$rc3"
    } catch { J 'rebuild' "ERR: $($_.Exception.Message)" }

    $modified = $false
    try { $proj.IsProjectModified([ref]$callId3, [ref]$modified); J 'isModified' ([bool]$modified) } catch { J 'isModified' "ERR: $($_.Exception.Message)" }
  }

  # 收尾
  try { if ($proj) { $c = [byte]0; $r = [int]0; $proj.CloseProject([ref]$c, [int]0, [ref]$r); J 'closeProject' "ok rc=$r" } } catch { J 'closeProject' "ERR: $($_.Exception.Message)" }
} catch {
  J 'fatal' $_.Exception.Message
} finally {
  foreach ($o in @($proj, $sess, $prod, $tx)) {
    if ($o) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch {} }
  }
  $result | ConvertTo-Json -Depth 4
}

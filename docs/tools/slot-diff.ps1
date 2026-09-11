# slot-diff.ps1 — enumerate DSH client slot declarations from two installed trees
# and report the differences.
#
# Slots are declared by `declare module '@deepseek-ai/dsh-client-ui-slots'`
# -> `interface SlotMap { 'key': { kind; scope; owner? } }`. The block contains
# nested braces, so the scan tracks brace depth from the interface header rather
# than stopping at the first closing brace.
#
# Usage:
#   pwsh -File slot-diff.ps1 -OldRoot <dir> -NewRoot <dir>

param(
  [Parameter(Mandatory)][string]$OldRoot,
  [Parameter(Mandatory)][string]$NewRoot
)

function Get-SlotDecls {
  param([string]$Root)

  # key -> file that declared it (first declaration wins).
  # Plain hashtable: Windows PowerShell's OrderedDictionary has no ContainsKey.
  $slots = @{}
  # key -> "kind;scope"
  $specs = @{}

  $files = Get-ChildItem $Root -Recurse -File -Filter *.d.ts -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    $lines = [System.IO.File]::ReadAllLines($f.FullName)
    for ($i = 0; $i -lt $lines.Length; $i++) {
      if ($lines[$i] -notmatch 'interface\s+SlotMap\b') { continue }

      # Brace depth from the interface header line onward.
      $depth = 0
      for ($j = $i; $j -lt $lines.Length; $j++) {
        $line = $lines[$j]
        $opens = ([regex]::Matches($line, '\{')).Count
        $closes = ([regex]::Matches($line, '\}')).Count

        if ($j -gt $i -and $depth -ge 1) {
          $m = [regex]::Match($line, "^\s*'([a-zA-Z][a-zA-Z0-9._-]*)':\s*\{")
          if ($m.Success) {
            $key = $m.Groups[1].Value
            if (-not $slots.ContainsKey($key)) {
              $slots[$key] = $f.Name
              # Capture the declaration body for kind/scope reporting.
              $body = @()
              $d2 = 0
              for ($k = $j; $k -lt [Math]::Min($j + 12, $lines.Length); $k++) {
                $body += $lines[$k].Trim()
                $d2 += ([regex]::Matches($lines[$k], '\{')).Count
                $d2 -= ([regex]::Matches($lines[$k], '\}')).Count
                if ($d2 -le 0 -and $k -gt $j) { break }
              }
              $kind = ([regex]::Match($body -join ' ', "kind:\s*'([a-z]+)'")).Groups[1].Value
              $scope = ([regex]::Match($body -join ' ', "scope:\s*'([a-z-]+)'")).Groups[1].Value
              $specs[$key] = "$kind/$scope"
            }
          }
        }

        $depth += $opens - $closes
        if ($depth -le 0 -and $j -gt $i) { break }
      }
    }
  }
  return [pscustomobject]@{ Slots = $slots; Specs = $specs }
}

$old = Get-SlotDecls -Root $OldRoot
$new = Get-SlotDecls -Root $NewRoot

Write-Host "old ($OldRoot): $($old.Slots.Count) slots"
Write-Host "new ($NewRoot): $($new.Slots.Count) slots"
Write-Host ''

Write-Host '=== ONLY IN NEW (added) ==='
$added = $new.Slots.Keys | Where-Object { -not $old.Slots.ContainsKey($_) } | Sort-Object
foreach ($k in $added) { Write-Host ("  + {0,-46} {1}" -f $k, $new.Specs[$k]) }
if (-not $added) { Write-Host '  (none)' }
Write-Host ''

Write-Host '=== ONLY IN OLD (removed) ==='
$removed = $old.Slots.Keys | Where-Object { -not $new.Slots.ContainsKey($_) } | Sort-Object
foreach ($k in $removed) { Write-Host ("  - {0,-46} {1}" -f $k, $old.Specs[$k]) }
if (-not $removed) { Write-Host '  (none)' }
Write-Host ''

Write-Host '=== COMMON, SPEC CHANGED ==='
$changed = @()
foreach ($k in ($old.Slots.Keys | Where-Object { $new.Slots.ContainsKey($_) } | Sort-Object)) {
  if ($old.Specs[$k] -ne $new.Specs[$k]) {
    $changed += $k
    Write-Host ("  ~ {0,-46} {1}  ->  {2}" -f $k, $old.Specs[$k], $new.Specs[$k])
  }
}
if (-not $changed) { Write-Host '  (none)' }
Write-Host ''

Write-Host '=== COMMON, UNCHANGED ==='
foreach ($k in ($old.Slots.Keys | Where-Object { $new.Slots.ContainsKey($_) -and $old.Specs[$_] -eq $new.Specs[$_] } | Sort-Object)) {
  Write-Host ("  = {0,-46} {1}" -f $k, $new.Specs[$k])
}

# Live view of the Phase 8 build loop: pi-subagents runs, plan.md Phase 8 progress, files touched.
# Usage: powershell -ExecutionPolicy Bypass -File Tools\watch-workflow.ps1 [-Hours 6] [-Interval 2]
# Read-only: reads pi-subagents run artifacts in %TEMP% and the repo; never writes.
param([double]$Hours = 6, [int]$Interval = 2)

$runsDir = Join-Path $env:TEMP "pi-subagents-user-$env:USERNAME\async-subagent-runs"
$repo = Split-Path -Parent $PSScriptRoot
$plan = Join-Path $repo ".claude\plan.md"

function Ago([double]$ms) {
    if (-not $ms) { return "-" }
    $s = [int](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $ms) / 1000)
    if ($s -lt 60) { "${s}s" } elseif ($s -lt 3600) { "$([int]($s/60))m" } else { "{0:N1}h" -f ($s/3600) }
}

function Clip([string]$t, [int]$w) { if ($t.Length -gt $w) { $t.Substring(0, $w) } else { $t } }

function Bar([int]$done, [int]$total, [int]$width = 30) {
    if ($total -le 0) { return "" }
    $n = [int]($width * $done / $total)
    ("#" * $n) + ("." * ($width - $n)) + "  $done/$total"
}

function LastAction($dir) {
    $ev = Join-Path $dir "events.jsonl"
    if (-not (Test-Path $ev)) { return "" }
    $lines = Get-Content $ev -Tail 60 -ErrorAction SilentlyContinue
    [array]::Reverse($lines)
    foreach ($l in $lines) {
        try { $e = $l | ConvertFrom-Json } catch { continue }
        if ($e.type -eq "tool_execution_start") {
            $a = $e.args; if (-not $a) { $a = $e.arguments }
            $txt = if ($a.command) { $a.command } elseif ($a.path) { $a.path } else { "" }
            return ("{0}: {1}" -f $e.toolName, ($txt -replace "\s+", " "))
        }
    }
    ""
}

$colors = @{ running = "Yellow"; complete = "Green"; completed = "Green"; failed = "Red"; error = "Red"; stopped = "DarkGray" }

while ($true) {
    $cutoff = (Get-Date).AddHours(-$Hours)
    $rows = @()
    if (Test-Path $runsDir) {
        Get-ChildItem $runsDir -Directory | Where-Object { $_.LastWriteTime -gt $cutoff } | ForEach-Object {
            $sf = Join-Path $_.FullName "status.json"
            if (-not (Test-Path $sf)) { return }
            try { $s = Get-Content $sf -Raw | ConvertFrom-Json } catch { return }
            if ($s.mode -eq "workflow") { return } # parent wrapper; its children are listed as their own runs
            $step = $s.steps | Select-Object -First 1
            $name = if ($step.sessionName) { $step.sessionName -replace "^worker: ", "" } else { "" }
            $rows += [pscustomobject]@{
                Id = $s.runId.Substring(0, 8); State = $s.state; Agent = $step.agent
                Started = $s.startedAt; Active = $s.lastActivityAt; Cwd = (Split-Path -Leaf $s.cwd)
                Tokens = $s.totalTokens.total; Turns = $s.turnCount; Tools = $s.toolCount
                Task = $name; Last = (LastAction $_.FullName)
            }
        }
    }

    $w = [Math]::Max(80, $Host.UI.RawUI.WindowSize.Width - 1)
    $out = @()
    Clear-Host
    Write-Host ("Omni Phase 8 build loop   {0}   refresh {1}s   Ctrl+C to quit" -f (Get-Date -Format "HH:mm:ss"), $Interval) -ForegroundColor Cyan
    Write-Host ("-" * $w) -ForegroundColor DarkGray

    # plan.md Phase 8 progress, per subsection
    if (Test-Path $plan) {
        $in8 = $false; $sec = ""; $stats = [ordered]@{}
        foreach ($l in Get-Content $plan) {
            if ($l -match "^## Phase 8") { $in8 = $true; continue }
            if ($in8 -and $l -match "^## ") { break }
            if (-not $in8) { continue }
            if ($l -match "^### (\S+)") { $sec = $Matches[1]; $stats[$sec] = @(0, 0); continue }
            if ($sec -and $l -match "^- \[( |x)\]") { $stats[$sec][1]++; if ($Matches[1] -eq "x") { $stats[$sec][0]++ } }
        }
        Write-Host "plan.md Phase 8" -ForegroundColor White
        foreach ($k in $stats.Keys) { Write-Host ("  {0,-5} {1}" -f $k, (Bar $stats[$k][0] $stats[$k][1])) }
        Write-Host ""
    }

    Write-Host ("Subagent runs (last {0} h): {1} running, {2} total" -f $Hours, @($rows | Where-Object State -eq "running").Count, $rows.Count) -ForegroundColor White
    foreach ($r in ($rows | Sort-Object Started -Descending)) {
        $c = $colors[$r.State]; if (-not $c) { $c = "Gray" }
        $head = "  {0}  {1,-9} {2,-7} cwd={3,-10} up {4,-5} idle {5,-4} turns {6,-3} tools {7,-3} tok {8}" -f `
            $r.Id, $r.State, $r.Agent, $r.Cwd, (Ago $r.Started), (Ago $r.Active), $r.Turns, $r.Tools, $r.Tokens
        Write-Host $head -ForegroundColor $c
        Write-Host (Clip ("      task: " + $r.Task) $w) -ForegroundColor Gray
        if ($r.State -eq "running" -and $r.Last) {
            Write-Host (Clip ("      now:  " + $r.Last) $w) -ForegroundColor DarkGray
        }
    }
    Write-Host ""

    # files the workers are producing (excludes build output)
    Write-Host "Files touched in the last 10 min" -ForegroundColor White
    $recent = (Get-Date).AddMinutes(-10)
    foreach ($d in "Backend", "Web", "Deploy") {
        $p = Join-Path $repo $d
        if (-not (Test-Path $p)) { continue }
        $f = Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -gt $recent -and $_.FullName -notmatch "\\(node_modules|target|dist)\\" }
        $names = ($f | Sort-Object LastWriteTime -Descending | Select-Object -First 6 | ForEach-Object { $_.FullName.Substring($repo.Length + 1) }) -join "  "
        Write-Host (Clip ("  {0,-8} {1,3} files  {2}" -f $d, @($f).Count, $names) $w) -ForegroundColor Gray
    }

    Start-Sleep -Seconds $Interval
}

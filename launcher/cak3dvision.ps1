# CAK3Dvision launcher for NukeBox. Runs on its own: no Claude session needed.
#   cak3dvision.ps1 -Action Start   start the server if needed, then open the globe
#   cak3dvision.ps1 -Action Stop    stop the server
#   cak3dvision.ps1 -Action Status  print whether it's running
# The desktop shortcuts call this through cak3dvision-hidden.vbs, so no console window shows.
param([ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start')

$ErrorActionPreference = 'Stop'
$Root     = Split-Path -Parent $PSScriptRoot
$Node     = 'C:\Program Files\nodejs\node.exe'
$Vite     = Join-Path $Root 'node_modules\vite\bin\vite.js'
$TsExe    = 'C:\Program Files\Tailscale\tailscale.exe'
$HostName = 'nukebox.tailac984b.ts.net'
$Port     = 4173
$Url      = "https://${HostName}:$Port/"
$LogDir   = Join-Path $Root '.gev-logs'
$Log      = Join-Path $LogDir 'cak3dvision-server.log'
$CertFile = Join-Path $Root '.certs\nukebox.crt'
$KeyFile  = Join-Path $Root '.certs\nukebox.key'

function Show-Message([string]$Text, [int]$Icon = 64) {
    # 16 = error, 48 = warning, 64 = info. Closes by itself after 15 s.
    (New-Object -ComObject WScript.Shell).Popup($Text, 15, 'CAK3Dvision', $Icon) | Out-Null
}

function Get-ServerProcess {
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $p" -ErrorAction SilentlyContinue
        if ($proc -and $proc.Name -eq 'node.exe') { return $proc }
    }
    return $null
}

function Update-CertIfNeeded {
    # Tailscale certs last ~90 days; renew when under 14 days are left.
    $renew = $true
    if (Test-Path $CertFile) {
        try {
            $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertFile)
            $renew = $cert.NotAfter -lt (Get-Date).AddDays(14)
        } catch { $renew = $true }
    }
    if ($renew) {
        New-Item -ItemType Directory -Force (Split-Path $CertFile) | Out-Null
        & $TsExe cert --cert-file $CertFile --key-file $KeyFile $HostName 2>&1 | Out-Null
    }
}

switch ($Action) {
    'Status' {
        $p = Get-ServerProcess
        if ($p) { "Running (PID $($p.ProcessId)) at $Url" } else { 'Not running' }
    }

    'Stop' {
        $p = Get-ServerProcess
        if (-not $p) { Show-Message 'CAK3Dvision is not running.'; break }
        # Stop the server and its npm/cmd parents if any are left.
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Show-Message 'CAK3Dvision stopped.'
    }

    'Start' {
        if (Get-ServerProcess) { Start-Process $Url; break }

        foreach ($f in @($Node, $Vite, $TsExe)) {
            if (-not (Test-Path $f)) { Show-Message "Missing: $f" 16; exit 1 }
        }
        # Tailscale must be up: the server listens only on NukeBox's tailnet address.
        $tsIp = (& $TsExe ip -4 2>$null | Select-Object -First 1)
        if (-not $tsIp) { Show-Message 'Tailscale is not connected. Turn Tailscale on, then try again.' 48; exit 1 }

        try { Update-CertIfNeeded } catch {
            Show-Message "Could not renew the Tailscale HTTPS certificate:`n$($_.Exception.Message)" 48
        }

        New-Item -ItemType Directory -Force $LogDir | Out-Null
        if (Test-Path $Log) { Move-Item -Force $Log "$Log.1" }
        Start-Process -FilePath $Node -ArgumentList "`"$Vite`"" -WorkingDirectory $Root `
            -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"

        $deadline = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $deadline -and -not (Get-ServerProcess)) { Start-Sleep -Milliseconds 500 }
        if (Get-ServerProcess) {
            Start-Process $Url
        } else {
            $tail = ''
            foreach ($f in @($Log, "$Log.err")) { if (Test-Path $f) { $tail += (Get-Content $f -Tail 8) -join "`n" } }
            Show-Message "CAK3Dvision did not start within 60 seconds.`n`n$tail`n`nFull log: $Log" 16
            exit 1
        }
    }
}

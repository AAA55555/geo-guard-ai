#Requires -Version 5.1
<#
Windows smoke test for the real CLI (dist/cli.js).

scripts/e2e.sh and scripts/pack-check.sh are POSIX-only and skip themselves on
Windows, so until now nothing exercised the win32 code paths at all:

  - shell-alias: the `powershell` branch writes a *function*
    (`function claude { geo-guard claude @args }`), not an `alias`, into
    Documents/PowerShell/Microsoft.PowerShell_profile.ps1
  - config: configDir() lives under %APPDATA% on win32, not ~/.config
  - resolve-bin: PATHEXT candidates (`claude` -> `claude.cmd`) and no X_OK check
  - run: spawn of a .cmd wrapper — the very thing the engines floor
    (18.20 / 20.12) exists for
  - run: profileForCommand() strips .cmd/.bat/.exe/.ps1

Every assertion below fails the script (exit 1) when the behaviour breaks; it
never merely prints.

Isolation: HOME / USERPROFILE / APPDATA and every GEO_GUARD_* variable point
inside a throwaway sandbox, and the sandbox is verified against os.homedir()
before any step that writes to the profile path is allowed to run. Nothing here
touches the real user profile. No network: the one step that needs a country
preloads a fetch stub, and the "cannot determine the country" step points at a
dead local port.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $root 'dist\cli.js'
if (-not (Test-Path $cli)) {
    Write-Host "windows-smoke: FAIL - $cli not found (run npm run build first)"
    exit 1
}
$node = (Get-Command node).Source

# NODE_OPTIONS=--require <path> is not quoted, so a space in the path would
# split into two options. Temp is short and space-free on CI; bail out loudly
# rather than fail somewhere confusing.
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("ggsmoke-" + [System.Guid]::NewGuid().ToString('N'))
if ($sandbox -match '\s') {
    Write-Host "windows-smoke: FAIL - sandbox path contains a space: $sandbox"
    exit 1
}

# Wiped before the run and restored afterwards. PATH is saved separately: it is
# extended, never cleared.
$envNames = @(
    'HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SHELL', 'NODE_OPTIONS',
    'GEO_GUARD_CONFIG_DIR', 'GEO_GUARD_CONFIG_FILE', 'GEO_GUARD_RC', 'GEO_GUARD_SHELL',
    'GEO_GUARD_ALLOWED', 'GEO_GUARD_PROVIDERS', 'GEO_GUARD_TIMEOUT', 'GEO_GUARD_REAL_BIN',
    'GEO_GUARD_LANG', 'GEO_GUARD_PROFILE'
)
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name) }
$originalPath = [Environment]::GetEnvironmentVariable('PATH')

function Set-Env {
    param([string]$Name, $Value)
    # Note: PowerShell deletes an env var when it is set to '' — so every
    # "unset" here is a real unset and no step relies on an empty value.
    if ($null -eq $Value) {
        Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
    } else {
        Set-Item -Path "Env:$Name" -Value $Value
    }
}

# Args are passed as one explicit array: PowerShell would otherwise try to bind
# `--yes` and friends as parameter names of this function.
function Invoke-Geo {
    param([string[]]$GeoArgs)
    $outFile = Join-Path $sandbox 'last-stdout.txt'
    $errFile = Join-Path $sandbox 'last-stderr.txt'
    $argList = @(@($cli) + $GeoArgs | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    })
    $proc = Start-Process -FilePath $node -ArgumentList $argList -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    $out = ''
    $err = ''
    if (Test-Path $outFile) { $out = [string](Get-Content -Raw -Path $outFile) }
    if (Test-Path $errFile) { $err = [string](Get-Content -Raw -Path $errFile) }
    [pscustomobject]@{ ExitCode = $proc.ExitCode; StdOut = $out; StdErr = $err }
}

function Assert-Exit {
    param($Result, [int]$Expected, [string]$What)
    if ($Result.ExitCode -ne $Expected) {
        throw "$What : expected exit $Expected, got $($Result.ExitCode)`n--- stdout ---`n$($Result.StdOut)`n--- stderr ---`n$($Result.StdErr)"
    }
}

function Assert-Contains {
    param([string]$Text, [string]$Needle, [string]$What)
    if (-not $Text.Contains($Needle)) { throw "$What : expected to contain '$Needle', got:`n$Text" }
}

function Assert-NotContains {
    param([string]$Text, [string]$Needle, [string]$What)
    if ($Text.Contains($Needle)) { throw "$What : must not contain '$Needle', got:`n$Text" }
}

$failed = $false
try {
    New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
    $sandboxHome = Join-Path $sandbox 'home'
    $appData = Join-Path $sandbox 'appdata'
    $binDir = Join-Path $sandbox 'bin'
    New-Item -ItemType Directory -Path $sandboxHome, $appData, $binDir -Force | Out-Null

    foreach ($name in $envNames) { Set-Env $name $null }
    Set-Env 'PATH' $originalPath
    Set-Env 'HOME' $sandboxHome
    Set-Env 'USERPROFILE' $sandboxHome
    Set-Env 'APPDATA' $appData
    Set-Env 'GEO_GUARD_LANG' 'en'

    # --- 0. isolation gate: everything below writes into os.homedir() ---------
    $seenHome = & $node -e "process.stdout.write(require('node:os').homedir())"
    if ($seenHome -ne $sandboxHome) {
        throw "sandbox isolation failed: os.homedir() is '$seenHome', expected '$sandboxHome' — refusing to run, the real profile would be modified"
    }
    Write-Host "windows-smoke: sandbox HOME=$sandboxHome APPDATA=$appData"

    # --- 1. setup: the powershell alias branch and the %APPDATA% config dir ---
    # No --shell and no GEO_GUARD_SHELL on purpose: with SHELL unset this also
    # covers detectShell()'s win32 fallback to 'powershell'.
    $r = Invoke-Geo @('setup', '--yes', '--countries', 'NL', '--no-cursor')
    Assert-Exit $r 0 'setup'

    $profilePath = Join-Path $sandboxHome 'Documents\PowerShell\Microsoft.PowerShell_profile.ps1'
    if (-not (Test-Path $profilePath)) {
        throw "setup did not write the PowerShell profile at $profilePath (stdout: $($r.StdOut))"
    }
    $rc = [string](Get-Content -Raw -Path $profilePath)
    Assert-Contains $rc '# >>> geo-guard-ai begin >>>' 'managed block marker'
    Assert-Contains $rc 'function claude { geo-guard claude @args }' 'powershell alias body (must be a function, not an alias)'
    Assert-NotContains $rc 'alias claude=' 'powershell profile must not get the POSIX alias form'

    $configFile = Join-Path $appData 'geo-guard-ai\config.json'
    if (-not (Test-Path $configFile)) {
        throw "setup did not write the config under %APPDATA% ($configFile)"
    }
    $cfg = Get-Content -Raw -Path $configFile | ConvertFrom-Json
    if (($cfg.allowed -join ',') -ne 'NL') {
        throw "config written under %APPDATA% has allowed=[$($cfg.allowed -join ',')], expected [NL]"
    }

    # The Claude Code hook file is found through os.homedir(), i.e. %USERPROFILE%
    # on Windows — the same lookup the real install does.
    $settings = Join-Path $sandboxHome '.claude\settings.json'
    if (-not (Test-Path $settings)) { throw "setup did not write the Claude Code hook at $settings" }
    Assert-Contains ([string](Get-Content -Raw -Path $settings)) 'geo-guard check' 'hook command in settings.json'

    # --- 2. setup is idempotent on the PowerShell profile --------------------
    $r = Invoke-Geo @('setup', '--yes', '--countries', 'NL', '--no-cursor')
    Assert-Exit $r 0 'setup (second run)'
    $rc = [string](Get-Content -Raw -Path $profilePath)
    $blocks = ([regex]::Matches($rc, [regex]::Escape('geo-guard-ai begin'))).Count
    if ($blocks -ne 1) { throw "expected exactly one managed block after a second setup, found $blocks" }

    # --- 3. `check`: the hook contract, on Windows ---------------------------
    # 3a. country undeterminable -> block with exit 2. Port 9 (discard) refuses
    # immediately, so this needs no network and no stub.
    Set-Env 'GEO_GUARD_PROVIDERS' 'http://127.0.0.1:9/country'
    Set-Env 'GEO_GUARD_TIMEOUT' '2'
    $r = Invoke-Geo @('check')
    Assert-Exit $r 2 'check must block (exit 2) when the country cannot be determined'

    # 3b/3c need a country: preload a fetch stub, same trick the unit suite uses.
    $mock = Join-Path $sandbox 'mock-fetch.cjs'
    Set-Content -Path $mock -Encoding ASCII -Value "globalThis.fetch = async () => ({ ok: true, text: async () => 'RU' })"
    Set-Env 'NODE_OPTIONS' "--require $mock"
    Set-Env 'GEO_GUARD_PROVIDERS' 'https://example.test/fake'

    Set-Env 'GEO_GUARD_ALLOWED' 'RU'
    $r = Invoke-Geo @('check')
    Assert-Exit $r 0 'check with an allowed country'
    if ($r.StdOut -ne '{"continue":true}') {
        throw "hook stdout contract broken: expected exactly '{""continue"":true}', got '$($r.StdOut)'"
    }

    Set-Env 'GEO_GUARD_ALLOWED' 'NL'
    $r = Invoke-Geo @('check')
    Assert-Exit $r 2 'check must block (exit 2) a country outside the list'

    # --- 4. the wrapper: PATHEXT resolution + spawning a .cmd ----------------
    # A .cmd on PATH with no extension typed is the Windows-only half of
    # resolve-bin, and spawning it is what the engines floor exists for.
    Set-Content -Path (Join-Path $binDir 'claude.cmd') -Encoding ASCII -Value @"
@echo off
echo GEOGUARD_CLAUDE_RAN
"@
    Set-Content -Path (Join-Path $binDir 'ggsmoke.cmd') -Encoding ASCII -Value @"
@echo off
echo GEOGUARD_SMOKE_RAN
"@
    Set-Env 'PATH' ($binDir + ';' + $originalPath)

    $wrapCfg = Join-Path $sandbox 'wrap-config.json'
    Set-Content -Path $wrapCfg -Encoding ASCII -Value '{"allowed":["RU"],"profiles":{"claude":{"allowed":["NL"]}}}'
    Set-Env 'GEO_GUARD_CONFIG_FILE' $wrapCfg
    Set-Env 'GEO_GUARD_ALLOWED' $null

    # 4a. spawn of a plain .exe, args forwarded — the baseline the rest builds on.
    Set-Env 'GEO_GUARD_REAL_BIN' $node
    $r = Invoke-Geo @('ggsmoke', '--version')
    Assert-Exit $r 0 'wrapping an .exe under the shared policy'
    if ($r.StdOut -notmatch '^v\d') {
        throw "the wrapped .exe did not run or its args were lost, stdout: '$($r.StdOut)'"
    }
    Set-Env 'GEO_GUARD_REAL_BIN' $null

    # 4b. `ggsmoke` -> ggsmoke.cmd via PATHEXT, then spawned. This is the case the
    # engines floor (18.20 / 20.12) is about: those releases changed how Node
    # launches a .bat/.cmd. If this assertion is the one that fails, look at
    # src/run.ts (spawn without `shell`), not at this script.
    $r = Invoke-Geo @('ggsmoke')
    Assert-Exit $r 0 'wrapping a .cmd under the shared policy'
    Assert-Contains $r.StdOut 'GEOGUARD_SMOKE_RAN' 'the wrapped .cmd did not actually run'

    # 4c. `claude` maps to the claude profile (NL only) -> blocked, and the real
    # binary must never be reached.
    $r = Invoke-Geo @('claude', '--version')
    if ($r.ExitCode -eq 0) {
        throw "geo-guard claude must be blocked under the 'claude' profile, got exit 0`n$($r.StdOut)"
    }
    Assert-NotContains $r.StdOut 'GEOGUARD_CLAUDE_RAN' 'the wrapped binary ran despite the block'
    # The exact phrase, not just the word: 'claude' appears in the command line
    # itself, so a looser check would pass even if the profile were ignored.
    Assert-Contains $r.StdErr "the 'claude' policy" 'the block message must name the profile it applied'

    # --- 5. uninstall cleans the PowerShell profile and the %APPDATA% config -
    Set-Env 'GEO_GUARD_CONFIG_FILE' $null
    $r = Invoke-Geo @('uninstall', '--quiet')
    Assert-Exit $r 0 'uninstall'
    $rc = [string](Get-Content -Raw -Path $profilePath)
    if ($rc -match 'geo-guard') {
        throw "uninstall left geo-guard lines in the PowerShell profile:`n$rc"
    }
    if (Test-Path $configFile) { throw "uninstall left the config file behind: $configFile" }
    # settings.json is the user's file: uninstall strips our entry but keeps it.
    if (Test-Path $settings) {
        Assert-NotContains ([string](Get-Content -Raw -Path $settings)) 'geo-guard check' 'uninstall left the hook in settings.json'
    }

    Write-Host 'windows-smoke: OK (powershell profile, %APPDATA% config, PATHEXT + .cmd spawn, check exit codes, uninstall)'
} catch {
    $failed = $true
    Write-Host "windows-smoke: FAIL - $($_.Exception.Message)"
    Write-Host $_.ScriptStackTrace
} finally {
    foreach ($name in $envNames) { Set-Env $name $savedEnv[$name] }
    Set-Env 'PATH' $originalPath
    Remove-Item -Recurse -Force -Path $sandbox -ErrorAction SilentlyContinue
}

if ($failed) { exit 1 }
exit 0

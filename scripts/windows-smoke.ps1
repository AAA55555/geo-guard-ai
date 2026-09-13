#Requires -Version 5.1
<#
Windows smoke test for the real CLI (dist/cli.js).

scripts/e2e.sh and scripts/pack-check.sh are POSIX-only and skip themselves on
Windows, so until now nothing exercised the win32 code paths at all:

  - shim: the launch gate is `claude.cmd` in the shim directory, not a
    bare `claude` file
  - shell-path: the `powershell` branch writes a PowerShell PATH prepend
    (`$env:PATH = ...`), not the POSIX `case`/`esac` form, into
    Documents/PowerShell/Microsoft.PowerShell_profile.ps1
  - windows-path: the shim directory also goes into the user PATH
    (HKCU\Environment), which is what cmd.exe, Explorer, shortcuts and IDEs
    read — the profile above reaches PowerShell sessions and nothing else
  - config: configDir() lives under %APPDATA% on win32, not ~/.config
  - resolve-bin: PATHEXT candidates (`claude` -> `claude.cmd`) and no X_OK check
  - run: spawn of a .cmd wrapper — the very thing the engines floor
    (18.20 / 20.12) exists for
  - run: profileForCommand() strips .cmd/.bat/.exe/.ps1

Every assertion below fails the script (exit 1) when the behaviour breaks; it
never merely prints.

Isolation: HOME / USERPROFILE / APPDATA / GEO_GUARD_SHIM_DIR and every other
GEO_GUARD_* variable point inside a throwaway sandbox, and the sandbox is verified against os.homedir()
before any step that writes to the profile path is allowed to run. Nothing on
disk outside the sandbox is touched.

The one exception is HKCU\Environment: the user PATH belongs to the account and
cannot be redirected by an environment variable, so this script saves its raw
value and registry type up front, works against a known probe value, and
restores it in `finally` on every exit path — a failure in the middle included.

No network: the one step that needs a country preloads a fetch stub, and the
"cannot determine the country" step points at a dead local port.
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
    'GEO_GUARD_LANG', 'GEO_GUARD_PROFILE', 'GEO_GUARD_SHIM_DIR'
)
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name) }
$originalPath = [Environment]::GetEnvironmentVariable('PATH')

# --- the user PATH (HKCU\Environment) ----------------------------------------
# setup writes the shim directory there too — the PowerShell profile covers
# PowerShell sessions and nothing else. That value belongs to the account, not
# to the sandbox, so it is saved here (raw, with its registry type) and restored
# in `finally` no matter how this script ends. The runner is ephemeral; a test
# that leaves an environment worse than it found it is still a bad test.
function Get-UserPathValue {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
    if ($null -eq $key) { return $null }
    try {
        $name = $key.GetValueNames() | Where-Object { $_ -ieq 'Path' } | Select-Object -First 1
        if ($null -eq $name) { return $null }
        return [pscustomobject]@{
            Name = $name
            Kind = $key.GetValueKind($name)
            # DoNotExpandEnvironmentNames: %USERPROFILE% and friends must come
            # back as written, or restoring would bake today's expansion in.
            Raw  = [string]$key.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
    } finally { $key.Close() }
}

function Set-UserPathValue {
    param([string]$Name, $Kind, [string]$Raw)
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
    try { $key.SetValue($Name, $Raw, $Kind) } finally { $key.Close() }
}

function Restore-UserPathValue {
    param($Saved)
    if ($null -ne $Saved) {
        Set-UserPathValue -Name $Saved.Name -Kind $Saved.Kind -Raw $Saved.Raw
        return
    }
    # There was no user PATH before us, so there must be none after us either.
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if ($null -eq $key) { return }
    try {
        $name = $key.GetValueNames() | Where-Object { $_ -ieq 'Path' } | Select-Object -First 1
        if ($null -ne $name) { $key.DeleteValue($name) }
    } finally { $key.Close() }
}

$savedUserPath = Get-UserPathValue

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

# Start-Process cannot feed stdin, and the payload path is the whole point of
# this step, so the CLI is driven through Node's own child_process instead.
function Invoke-GeoWithStdin {
    param([string[]]$GeoArgs, [string]$StdinText)
    $runner = Join-Path $sandbox 'run-with-stdin.cjs'
    $payloadFile = Join-Path $sandbox 'payload.json'
    Set-Content -Path $payloadFile -Encoding ASCII -NoNewline -Value $StdinText
    $script = @'
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const [cli, payloadFile, ...rest] = process.argv.slice(2)
const r = spawnSync(process.execPath, [cli, ...rest], {
  input: fs.readFileSync(payloadFile),
  encoding: 'utf8',
})
fs.writeFileSync(process.env.GGSMOKE_OUT, r.stdout ?? '')
fs.writeFileSync(process.env.GGSMOKE_ERR, r.stderr ?? '')
process.exit(r.status ?? 1)
'@
    Set-Content -Path $runner -Encoding ASCII -Value $script
    $outFile = Join-Path $sandbox 'last-stdout.txt'
    $errFile = Join-Path $sandbox 'last-stderr.txt'
    Set-Env 'GGSMOKE_OUT' $outFile
    Set-Env 'GGSMOKE_ERR' $errFile
    $argList = @(@($runner, $cli, $payloadFile) + $GeoArgs)
    $proc = Start-Process -FilePath $node -ArgumentList $argList -NoNewWindow -Wait -PassThru
    Set-Env 'GGSMOKE_OUT' $null
    Set-Env 'GGSMOKE_ERR' $null
    $out = ''
    $err = ''
    if (Test-Path $outFile) { $out = [string](Get-Content -Raw -Path $outFile) }
    if (Test-Path $errFile) { $err = [string](Get-Content -Raw -Path $errFile) }
    [pscustomobject]@{ ExitCode = $proc.ExitCode; StdOut = $out; StdErr = $err }
}

# Names, sizes and contents of everything in the sandbox — for asserting that a
# command changed nothing. The helper's own scratch files are excluded.
function Get-TreeSnapshot {
    param([string]$Root)
    $skip = @('last-stdout.txt', 'last-stderr.txt', 'payload.json', 'run-with-stdin.cjs')
    $lines = Get-ChildItem -Path $Root -Recurse -Force -File |
        Where-Object { $skip -notcontains $_.Name } |
        Sort-Object FullName |
        ForEach-Object { "$($_.FullName)|$($_.Length)|" + [System.IO.File]::ReadAllText($_.FullName) }
    return ($lines -join "`n")
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
    # The launch gate: pinned into the sandbox, never ~/.geo-guard/bin.
    $shimDir = Join-Path $sandbox 'shim-bin'
    New-Item -ItemType Directory -Path $sandboxHome, $appData, $binDir -Force | Out-Null

    foreach ($name in $envNames) { Set-Env $name $null }
    Set-Env 'PATH' $originalPath
    Set-Env 'HOME' $sandboxHome
    Set-Env 'USERPROFILE' $sandboxHome
    Set-Env 'APPDATA' $appData
    Set-Env 'GEO_GUARD_SHIM_DIR' $shimDir
    Set-Env 'GEO_GUARD_LANG' 'en'

    # --- 0. isolation gate: everything below writes into os.homedir() ---------
    $seenHome = & $node -e "process.stdout.write(require('node:os').homedir())"
    if ($seenHome -ne $sandboxHome) {
        throw "sandbox isolation failed: os.homedir() is '$seenHome', expected '$sandboxHome' — refusing to run, the real profile would be modified"
    }
    Write-Host "windows-smoke: sandbox HOME=$sandboxHome APPDATA=$appData"

    # A known user PATH to work against: one entry, REG_EXPAND_SZ, holding an
    # unexpanded %VAR%. Every assertion below is about what geo-guard does to
    # exactly this value — including that it stays REG_EXPAND_SZ and that the
    # %VAR% is never expanded on the way through.
    $probeEntry = '%USERPROFILE%\ggsmoke-probe'
    Set-UserPathValue -Name 'Path' -Kind ([Microsoft.Win32.RegistryValueKind]::ExpandString) -Raw $probeEntry

    # --- 1. setup: the powershell PATH branch, the .cmd shim, %APPDATA% ------
    # No --shell and no GEO_GUARD_SHELL on purpose: with SHELL unset this also
    # covers detectShell()'s win32 fallback to 'powershell'.
    $r = Invoke-Geo @('setup', '--yes', '--countries', 'NL', '--no-cursor')
    Assert-Exit $r 0 'setup'

    $profilePath = Join-Path $sandboxHome 'Documents\PowerShell\Microsoft.PowerShell_profile.ps1'
    if (-not (Test-Path $profilePath)) {
        throw "setup did not write the PowerShell profile at $profilePath (stdout: $($r.StdOut))"
    }
    $rc = [string](Get-Content -Raw -Path $profilePath)
    Assert-Contains $rc '# >>> geo-guard-ai path begin >>>' 'managed PATH block marker'
    Assert-Contains $rc '$env:PATH' 'powershell PATH body (must be the PowerShell form)'
    Assert-Contains $rc $shimDir 'the PATH block must name the shim directory'
    Assert-NotContains $rc 'case ":$PATH:"' 'powershell profile must not get the POSIX PATH form'
    # The gate is a PATH shim now; an alias would be the weaker thing it replaced.
    Assert-NotContains $rc 'alias claude=' 'powershell profile must not get a POSIX alias'
    Assert-NotContains $rc 'function claude' 'powershell profile must not get an alias function'

    # On Windows the shim is a .cmd — a bare `claude` file would never run.
    $shim = Join-Path $shimDir 'claude.cmd'
    if (-not (Test-Path $shim)) { throw "setup did not write the launch gate at $shim" }
    Assert-Contains ([string](Get-Content -Raw -Path $shim)) 'geo-guard-ai shim v1: claude' 'shim marker'

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

    # --- 1b. setup puts the shim directory into the user PATH ----------------
    # The PowerShell profile above is read by PowerShell and nothing else:
    # cmd.exe, a shortcut, Explorer and every IDE take PATH from here.
    Assert-Contains $r.StdOut 'user PATH' 'setup did not report what it did to the user PATH'
    $userPath = Get-UserPathValue
    if ($null -eq $userPath) { throw 'setup removed the user PATH value entirely' }
    if ($userPath.Kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
        throw "setup changed the user PATH type to $($userPath.Kind) — a REG_SZ stops every %VAR% in it from expanding"
    }
    if ($userPath.Raw -ne ($shimDir + ';' + $probeEntry)) {
        throw "user PATH is '$($userPath.Raw)', expected the shim directory prepended to '$probeEntry'"
    }

    # --- 2. setup is idempotent on the PowerShell profile and the user PATH --
    $r = Invoke-Geo @('setup', '--yes', '--countries', 'NL', '--no-cursor')
    Assert-Exit $r 0 'setup (second run)'
    $rc = [string](Get-Content -Raw -Path $profilePath)
    $blocks = ([regex]::Matches($rc, [regex]::Escape('geo-guard-ai path begin'))).Count
    if ($blocks -ne 1) { throw "expected exactly one managed block after a second setup, found $blocks" }

    $userPath = Get-UserPathValue
    if ($userPath.Raw -ne ($shimDir + ';' + $probeEntry)) {
        throw "a second setup changed the user PATH to '$($userPath.Raw)' — it must write nothing when the entry is already there"
    }
    if ($userPath.Kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
        throw "a second setup changed the user PATH type to $($userPath.Kind)"
    }

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

    # --- 4d. the profile comes from the payload the host pipes to stdin -------
    # The only place this is decided on Windows, and the one thing the POSIX
    # suites cannot tell us anything about: reading stdin. With profiles
    # configured, `check` reads the JSON the host writes and picks the policy
    # from hook_event_name. Claude Code allows RU here, Cursor does not.
    # A config with per-tool profiles, alongside the installed one.
    $profileConfig = Join-Path $sandbox 'profiles-config.json'
    Set-Content -Path $profileConfig -Encoding ASCII -Value '{"allowed":["NL"],"profiles":{"claude":{"allowed":["RU"]},"cursor":{"allowed":["NL"]}}}'
    Set-Env 'GEO_GUARD_CONFIG_FILE' $profileConfig
    Set-Env 'GEO_GUARD_PROVIDERS' 'https://example.test/fake'
    Set-Env 'NODE_OPTIONS' "--require $mock"

    $r = Invoke-GeoWithStdin @('check') '{"hook_event_name":"UserPromptSubmit","prompt":"hi"}'
    Assert-Exit $r 0 'check must pass under the claude profile (payload read from stdin)'
    if ($r.StdOut -ne '{"continue":true}') {
        throw "check wrote '$($r.StdOut)' on stdout, expected the exact control JSON"
    }

    $r = Invoke-GeoWithStdin @('check') '{"hook_event_name":"beforeSubmitPrompt","prompt":"hi"}'
    Assert-Exit $r 2 'check must block under the cursor profile (payload read from stdin)'
    Assert-Contains $r.StdErr "the 'cursor' policy" 'the block must name the profile taken from the payload'

    Set-Env 'NODE_OPTIONS' $null
    Set-Env 'GEO_GUARD_CONFIG_FILE' $configFile

    # --- 4e. status reports what is installed, and writes nothing -------------
    # The shim directory ahead of the real binary is what makes the gate real,
    # and status judges it by exactly that: the same PATH a new terminal gets.
    Set-Env 'PATH' ($shimDir + ';' + $binDir + ';' + $originalPath)
    $before = Get-TreeSnapshot $sandbox
    $r = Invoke-Geo @('status')
    # Exit 0: this sandbox has no %USERPROFILE%\.cursor at all, and setup skips
    # the Cursor hook on a machine without Cursor — so nothing is missing. What
    # matters here is that the two things that ARE installed are found, on win32
    # paths, through the PowerShell profile.
    Assert-Exit $r 0 'status must exit 0 when everything setup installs is in place'
    Assert-Contains $r.StdOut 'no hook needed' 'status should not demand a Cursor hook on a machine without Cursor'
    # The profile path is the win32-specific part: status has to look in
    # Documents\PowerShell, not at a POSIX rc. The alias line itself is
    # normalized ("alias 'claude' -> geo-guard claude"), so the raw
    # `function claude { ... }` body never appears in the report.
    Assert-Contains $r.StdOut 'Microsoft.PowerShell_profile.ps1' 'status did not look at the PowerShell profile'
    Assert-Contains $r.StdOut 'claude goes through geo-guard' 'status did not report the launch gate it should have found'
    Assert-Contains $r.StdOut 'is added to PATH' 'status did not report the PATH entry'
    # The Windows-only half of "does the gate actually work": the user PATH is
    # what every new process gets, this process's PATH is what this terminal has.
    Assert-Contains $r.StdOut 'is in your user PATH' 'status did not check the user PATH'
    Assert-Contains $r.StdOut 'is on the PATH of this process' 'status did not check the inherited PATH'
    Assert-NotContains $r.StdOut 'PATH finds another binary first' 'status called a working gate stale'
    Assert-Contains $r.StdOut 'our hook entry is in place' 'status did not find the Claude Code hook it installed'
    # cursor-agent gets a line of its own. No cursor-agent on a CI runner, so it
    # must report "not needed" and stay out of the exit code — exactly like the
    # Cursor hook above.
    Assert-Contains $r.StdOut 'cursor-agent is not installed here' 'status did not report the cursor-agent gate separately'
    $after = Get-TreeSnapshot $sandbox
    if ($before -ne $after) {
        throw "status changed the sandbox — it must be read-only`nbefore:`n$before`nafter:`n$after"
    }

    # --- 5. uninstall cleans the PowerShell profile and the %APPDATA% config -
    Set-Env 'GEO_GUARD_CONFIG_FILE' $null
    $r = Invoke-Geo @('uninstall', '--quiet')
    Assert-Exit $r 0 'uninstall'
    $rc = [string](Get-Content -Raw -Path $profilePath)
    if ($rc -match 'geo-guard') {
        throw "uninstall left geo-guard lines in the PowerShell profile:`n$rc"
    }
    if (Test-Path $shim) { throw "uninstall left the launch gate behind: $shim" }
    # The user PATH goes back to exactly what it was — our entry gone, the
    # neighbour's %VAR% entry untouched and still unexpanded, type unchanged.
    $userPath = Get-UserPathValue
    if ($null -eq $userPath) { throw 'uninstall deleted the user PATH value instead of editing it' }
    if ($userPath.Raw -ne $probeEntry) {
        throw "uninstall left the user PATH as '$($userPath.Raw)', expected '$probeEntry'"
    }
    if ($userPath.Kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
        throw "uninstall changed the user PATH type to $($userPath.Kind)"
    }
    if (Test-Path $configFile) { throw "uninstall left the config file behind: $configFile" }
    # settings.json is the user's file: uninstall strips our entry but keeps it.
    if (Test-Path $settings) {
        Assert-NotContains ([string](Get-Content -Raw -Path $settings)) 'geo-guard check' 'uninstall left the hook in settings.json'
    }

    $r = Invoke-Geo @('status')
    Assert-Exit $r 1 'status must exit 1 once uninstall has removed everything'
    Assert-Contains $r.StdOut 'no shim for claude' 'status still reports the launch gate after uninstall removed it'

    Write-Host 'windows-smoke: OK (powershell PATH block, user PATH in HKCU\Environment, .cmd shim, %APPDATA% config, PATHEXT + .cmd spawn, check exit codes, stdin payload -> profile, status, uninstall)'
} catch {
    $failed = $true
    Write-Host "windows-smoke: FAIL - $($_.Exception.Message)"
    Write-Host $_.ScriptStackTrace
} finally {
    foreach ($name in $envNames) { Set-Env $name $savedEnv[$name] }
    Set-Env 'PATH' $originalPath
    # Runs on every exit path, including a failure in the middle of section 1b:
    # from that point on the account's own PATH carries a sandbox directory.
    try {
        Restore-UserPathValue $savedUserPath
    } catch {
        Write-Host "windows-smoke: WARNING - could not restore the user PATH: $($_.Exception.Message)"
    }
    Remove-Item -Recurse -Force -Path $sandbox -ErrorAction SilentlyContinue
}

if ($failed) { exit 1 }
exit 0

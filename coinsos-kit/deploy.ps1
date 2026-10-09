<#
  Build CoinsOS on this PC (inside Docker - no Go/Node needed) and deploy it to
  your Home VPS over SSH. Run it again any time to update.

  Usage:  .\deploy.ps1 -BoxHost 192.168.1.50
          .\deploy.ps1 -BoxHost 192.168.1.50 -Arch arm64 -DashboardUrl https://coins.example.com
#>
param(
  [Parameter(Mandatory)] [string] $BoxHost,
  [int]    $SshPort = 2222,
  [string] $User = 'vps',
  [ValidateSet('amd64', 'arm64')] [string] $Arch = 'amd64',
  [string] $CoinsOsPath = 'E:\Mining OS',
  [string] $DashboardUrl = '',
  [switch] $BuildOnly   # build + package, skip the upload
)
$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
if (-not $DashboardUrl) { $DashboardUrl = "http://${BoxHost}:8089" }
foreach ($p in 'backend', 'dashboard') {
  if (-not (Test-Path (Join-Path $CoinsOsPath $p))) { throw "Can't find $CoinsOsPath\$p - pass -CoinsOsPath." }
}
foreach ($t in 'docker', 'ssh', 'tar') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { throw "$t is required but not found." } }

$stage = Join-Path $env:TEMP 'coinsos-deploy'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path "$stage\bin", "$stage\site" | Out-Null

Write-Host '==> Building backend (linux/'$Arch')...' -ForegroundColor Cyan
docker run --rm -v "$CoinsOsPath\backend:/src:ro" -v "${stage}\bin:/out" -w /src `
  -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=$Arch golang:1.23-alpine `
  go build -o /out/coinsos-server ./cmd/server
if ($LASTEXITCODE) { throw 'Backend build failed.' }

Write-Host '==> Building dashboard...' -ForegroundColor Cyan
docker run --rm -v "$CoinsOsPath\dashboard:/src:ro" -v "${stage}\site:/out" node:20-alpine sh -c `
  'mkdir /work && cd /src && tar cf - --exclude=node_modules --exclude=dist . | tar xf - -C /work && cd /work && npm install --no-audit --no-fund && npm run build && cp -r dist/. /out/'
if ($LASTEXITCODE) { throw 'Dashboard build failed.' }

Write-Host '==> Packaging...' -ForegroundColor Cyan
Copy-Item "$CoinsOsPath\backend\migrations" "$stage\migrations" -Recurse
Copy-Item "$kit\remote\*" $stage -Recurse
# shell scripts must have LF endings on the box, whatever Windows did to them
Get-ChildItem $stage -Recurse -File | Where-Object { $_.Name -match '\.(sh|run)$' } | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($_.FullName, $t, (New-Object Text.UTF8Encoding $false))
}
Set-Content -Path "$stage\dashboard-url.txt" -Value $DashboardUrl -NoNewline -Encoding ascii
$payload = Join-Path $env:TEMP 'coinsos-payload.tgz'
& "$env:SystemRoot\System32\tar.exe" -czf $payload -C $stage .
if ($LASTEXITCODE) { throw 'tar failed.' }
if ($BuildOnly) { Write-Host "Payload: $payload" -ForegroundColor Green; return }

Write-Host "==> Uploading to ${User}@${BoxHost}:$SshPort  (enter your Home VPS password)" -ForegroundColor Cyan
$remote = 'tmp=$(mktemp -d) && cd "$tmp" && tar xzf - && sh ./install.sh; rc=$?; rm -rf "$tmp"; exit $rc'
cmd /c "ssh -p $SshPort -o StrictHostKeyChecking=accept-new $User@$BoxHost `"$remote`" < `"$payload`""
if ($LASTEXITCODE) { throw 'Remote install failed.' }
Remove-Item $stage, $payload -Recurse -Force
Write-Host 'Done.' -ForegroundColor Green

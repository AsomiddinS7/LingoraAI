$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'dist/index.html')) {
    throw 'The built app is missing. Run npm run build first.'
}
$env:SPEECH_SERVE_DIST = 'true'
if (-not $env:SPEECH_PORT) { $env:SPEECH_PORT = '8787' }
if (-not $env:SPEECH_PUBLIC_ORIGIN) { $env:SPEECH_PUBLIC_ORIGIN = 'http://localhost:' + $env:SPEECH_PORT }
Write-Host ('Open ' + $env:SPEECH_PUBLIC_ORIGIN + '/#/conversation')
if (Test-Path -LiteralPath '.env.speech') {
    node --env-file=.env.speech scripts/speech-server.mjs
} else {
    node scripts/speech-server.mjs
}

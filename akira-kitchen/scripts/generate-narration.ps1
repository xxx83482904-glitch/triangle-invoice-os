param([string]$Voice = 'Microsoft Sayaka')
$ErrorActionPreference = 'Stop'
$akiraRoot = Split-Path -Parent $PSScriptRoot
$akiraAudio = Join-Path $akiraRoot 'public/akira-kitchen/audio'
$akiraWaves = Join-Path $akiraRoot '../outputs/akira-preschool-ux-2026-11-01/wav'
New-Item -ItemType Directory -Force -Path $akiraAudio,$akiraWaves | Out-Null
$akiraText = Get-Content -LiteralPath (Join-Path $akiraRoot 'content/narration.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$akiraSpeech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$akiraSpeech.SelectVoice($Voice)
$akiraSpeech.Volume = 95
try {
  foreach ($entry in $akiraText.PSObject.Properties) {
    $akiraSpeech.SetOutputToWaveFile((Join-Path $akiraWaves ($entry.Name + '.wav')))
    $safeText = [System.Security.SecurityElement]::Escape($entry.Value)
    $akiraSpeech.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP"><prosody rate="+10%" pitch="+8%">' + $safeText + '</prosody></speak>')
    $akiraSpeech.SetOutputToNull()
  }
} finally { $akiraSpeech.Dispose() }
Write-Output ('Generated ' + @($akiraText.PSObject.Properties).Count + ' WAV clips with ' + $Voice)

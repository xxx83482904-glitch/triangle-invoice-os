param([switch]$NoBrowser)
& (Join-Path $PSScriptRoot 'start.ps1') -Dev -NoBrowser:$NoBrowser

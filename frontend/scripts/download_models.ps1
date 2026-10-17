# PowerShell script to prepare face-api models for Windows
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetDir = Join-Path $scriptDir "..\public\models"
$sourceDir = Join-Path $scriptDir "..\node_modules\@vladmandic\face-api\model"

if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$files = @(
    "tiny_face_detector_model-weights_manifest.json",
    "tiny_face_detector_model.bin",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model.bin",
    "face_recognition_model-weights_manifest.json",
    "face_recognition_model.bin"
)

Write-Host "Setting up face-api models in $targetDir..." -ForegroundColor Cyan

foreach ($file in $files) {
    $dest = Join-Path $targetDir $file
    if (Test-Path $dest) {
        Write-Host "  [skip] $file already exists." -ForegroundColor Gray
    } else {
        $src = Join-Path $sourceDir $file
        if (Test-Path $src) {
            Write-Host "  [copy] $file from node_modules..." -ForegroundColor Green
            Copy-Item -Path $src -Destination $dest
        } else {
            Write-Host "  [download] $file from GitHub..." -ForegroundColor Yellow
            $url = "https://raw.githubusercontent.com/vladmandic/face-api/master/model/$file"
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        }
    }
}

Write-Host "All models ready in $targetDir!" -ForegroundColor Green

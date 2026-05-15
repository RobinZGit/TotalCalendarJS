# Скачивает последний artifact TotalCalendar-apk из GitHub Actions и отправляет на psl1@mail.ru.
# Требует: gh auth, секреты или переменные MAILRU_SMTP_USER / MAILRU_SMTP_PASSWORD.
param(
  [string]$SmtpUser = $env:MAILRU_SMTP_USER,
  [string]$SmtpPassword = $env:MAILRU_SMTP_PASSWORD,
  [string]$To = 'psl1@mail.ru',
  [int]$RunId = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SmtpUser) -or [string]::IsNullOrWhiteSpace($SmtpPassword)) {
  throw 'Задайте MAILRU_SMTP_USER и MAILRU_SMTP_PASSWORD (пароль для внешнего приложения Mail.ru).'
}

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DownloadDir = Join-Path $RepoRoot '_apk_dl'
if (Test-Path -LiteralPath $DownloadDir) {
  Remove-Item -Recurse -Force $DownloadDir
}
New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null

if ($RunId -le 0) {
  $runJson = gh run list --workflow 'Build Android APK' --limit 1 --json databaseId,conclusion,status
  $run = ($runJson | ConvertFrom-Json)[0]
  if ($run.conclusion -ne 'success') {
    throw "Последний прогон Build Android APK не success: status=$($run.status) conclusion=$($run.conclusion)"
  }
  $RunId = [int]$run.databaseId
}

Write-Host "Downloading artifact from run $RunId ..."
Push-Location $DownloadDir
try {
  gh run download $RunId --name TotalCalendar-apk
} finally {
  Pop-Location
}

$ApkPath = Join-Path $DownloadDir 'TotalCalendar.apk'
if (!(Test-Path -LiteralPath $ApkPath)) {
  throw "APK not found after download: $ApkPath"
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $ApkPath).Length / 1MB, 2)
Write-Host "Sending $ApkPath ($sizeMb MB) to $To via smtp.mail.ru ..."

Add-Type -AssemblyName System.Net.Mail
$msg = New-Object System.Net.Mail.MailMessage
$msg.From = $SmtpUser
[void]$msg.To.Add($To)
$msg.Subject = "Total Calendar APK (manual send, run $RunId)"
$msg.Body = "Вложение: TotalCalendar.apk из GitHub Actions run $RunId.`nРазмер: $sizeMb MB."
$msg.Attachments.Add((New-Object System.Net.Mail.Attachment($ApkPath)))

$smtp = New-Object System.Net.Mail.SmtpClient('smtp.mail.ru', 465)
$smtp.EnableSsl = $true
$smtp.Credentials = New-Object System.Net.NetworkCredential($SmtpUser, $SmtpPassword)
$smtp.Send($msg)

Write-Host "Sent to $To"

# Скачивает последний artifact TotalCalendar-apk и отправляет на psl1@mail.ru.
# По умолчанию Brevo SMTP (пароль Mail.ru не нужен): SMTP_USER, SMTP_PASSWORD, SMTP_FROM.
param(
  [string]$SmtpHost = $(if ($env:SMTP_HOST) { $env:SMTP_HOST } else { 'smtp-relay.brevo.com' }),
  [int]$SmtpPort = $(if ($env:SMTP_PORT) { [int]$env:SMTP_PORT } else { 587 }),
  [string]$SmtpUser = $env:SMTP_USER,
  [string]$SmtpPassword = $env:SMTP_PASSWORD,
  [string]$SmtpFrom = $env:SMTP_FROM,
  [string]$To = 'psl1@mail.ru',
  [int]$RunId = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SmtpUser) -or [string]::IsNullOrWhiteSpace($SmtpPassword) -or [string]::IsNullOrWhiteSpace($SmtpFrom)) {
  throw 'Задайте SMTP_USER, SMTP_PASSWORD и SMTP_FROM (ключ Brevo: https://www.brevo.com).'
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
Write-Host "Sending $ApkPath ($sizeMb MB) to $To via ${SmtpHost}:${SmtpPort} ..."

Add-Type -AssemblyName System.Net.Mail
$msg = New-Object System.Net.Mail.MailMessage
$msg.From = $SmtpFrom
[void]$msg.To.Add($To)
$msg.Subject = "Total Calendar APK (manual send, run $RunId)"
$msg.Body = "Вложение: TotalCalendar.apk из GitHub Actions run $RunId.`nРазмер: $sizeMb MB."
$msg.Attachments.Add((New-Object System.Net.Mail.Attachment($ApkPath)))

$smtp = New-Object System.Net.Mail.SmtpClient($SmtpHost, $SmtpPort)
$smtp.EnableSsl = $SmtpPort -ne 25
$smtp.Credentials = New-Object System.Net.NetworkCredential($SmtpUser, $SmtpPassword)
$smtp.Send($msg)

Write-Host "Sent to $To"

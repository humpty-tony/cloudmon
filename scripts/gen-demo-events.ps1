<#
.SYNOPSIS
  Generate a steady stream of benign AWS API calls so CloudTrail records them, giving
  CloudMon's live capture activity to show during a demo.

.DESCRIPTION
  You can't write events *into* CloudTrail - it records real API calls - so this makes a
  variety of harmless, mostly READ-ONLY calls across many services, plus:
    - a few calls that intentionally fail (-> CloudTrail error rows, shown red in CloudMon)
    - a denied sts:AssumeRole against a bogus role (-> a "sensitive + denied" row)
    - with -Writes: self-cleaning create/delete pairs, so events show even if your trail
      only logs write events.

  Safety: nothing persistent is created (every write is immediately deleted), no secret
  VALUES are read, and calls you lack permission for simply log as AccessDenied events
  (which demo fine). It's the same benign recon a describe/list sweep does.

  Requires the AWS CLI ('aws') on PATH and a working profile (SSO logged in, etc.).

  Tip: use -Region matching the region CloudMon is capturing. Global-service events
  (IAM, STS, Route 53, S3 ListBuckets) are recorded in us-east-1, so a us-east-1 capture
  shows the most.

.EXAMPLE
  ./gen-demo-events.ps1 -Profile coveo-prod -Region us-east-1

.EXAMPLE
  ./gen-demo-events.ps1 -Duration 120 -Interval 1 -Writes
#>
[CmdletBinding()]
param(
  [string]$Profile = $env:AWS_PROFILE,
  [string]$Region = $(if ($env:AWS_REGION) { $env:AWS_REGION } else { 'us-east-1' }),
  [int]$Duration = 0,        # seconds; 0 = run until Ctrl-C
  [double]$Interval = 1.5,   # seconds between calls
  [switch]$Writes
)

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Error "The AWS CLI ('aws') is not on your PATH."
  exit 1
}

$awsBase = @('--region', $Region, '--output', 'json', '--no-cli-pager')
if ($Profile) { $awsBase += @('--profile', $Profile) }

# Confirm identity up front and capture the account id (used for the bogus AssumeRole).
$identOut = & aws @awsBase sts get-caller-identity 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "error: couldn't authenticate - check -Profile / your SSO login:" -ForegroundColor Red
  ($identOut | Out-String).Trim() -split "`n" | ForEach-Object { Write-Host "  $_" }
  exit 1
}
$account = try { ($identOut | Out-String | ConvertFrom-Json).Account } catch { '' }
Write-Host "> Generating CloudTrail activity as account $account in $Region  (Ctrl-C to stop)" -ForegroundColor Cyan
Write-Host ''

# Benign, no-required-parameter, read-only calls across many services.
$reads = @(
  'sts get-caller-identity'
  's3api list-buckets'
  'ec2 describe-instances'
  'ec2 describe-security-groups'
  'ec2 describe-vpcs'
  'ec2 describe-subnets'
  'ec2 describe-regions'
  'ec2 describe-addresses'
  'ec2 describe-snapshots --owner-ids self'
  'iam list-users'
  'iam list-roles'
  'iam get-account-summary'
  'iam list-account-aliases'
  'kms list-keys'
  'kms list-aliases'
  'secretsmanager list-secrets'
  'ssm describe-parameters'
  'lambda list-functions'
  'dynamodb list-tables'
  'sns list-topics'
  'sqs list-queues'
  'cloudwatch describe-alarms'
  'logs describe-log-groups'
  'cloudtrail describe-trails'
  'cloudformation list-stacks'
  'autoscaling describe-auto-scaling-groups'
  'route53 list-hosted-zones'
  'ecr describe-repositories'
  'elbv2 describe-load-balancers'
)

# Calls that reference non-existent resources -> CloudTrail records them with an
# errorCode (red rows in CloudMon). All read-only, all harmless.
$errs = @(
  'iam get-user --user-name cloudmon-demo-nope'
  'ec2 describe-instances --instance-ids i-0abcdef0123456789'
  'secretsmanager describe-secret --secret-id cloudmon-demo-nope'
  'kms describe-key --key-id cloudmon-demo-nope'
  'ssm get-parameter --name /cloudmon-demo/nope'
  'dynamodb describe-table --table-name cloudmon-demo-nope'
)

# Invoke-Call "<service> <action> [args...]" - make the call, discard output, print a
# one-line status.
function Invoke-Call([string]$desc) {
  $parts = $desc -split ' '
  $svc = $parts[0]; $act = $parts[1]
  $out = & aws @awsBase @parts 2>&1
  $prefix = '  {0,-14} {1,-30} ' -f $svc, $act
  if ($LASTEXITCODE -eq 0) {
    Write-Host $prefix -NoNewline -ForegroundColor DarkGray
    Write-Host 'ok' -ForegroundColor Green
  }
  else {
    $text = ($out | Out-String)
    $code = if ($text -match '\(([A-Za-z]+)\) when calling') { $Matches[1] } else { 'error' }
    Write-Host $prefix -NoNewline -ForegroundColor DarkGray
    Write-Host $code -ForegroundColor Yellow
  }
}

# Self-cleaning write pair (opt-in): create then immediately delete an SSM parameter.
function Invoke-WriteCycle {
  $name = "/cloudmon-demo/$(Get-Random)-$(Get-Random)"
  Invoke-Call "ssm put-parameter --name $name --value demo --type String --overwrite"
  Invoke-Call "ssm delete-parameter --name $name"
}

# A denied AssumeRole against a role that doesn't exist - a "sensitive + denied" row.
function Invoke-AssumeBogus {
  if ($account) {
    Invoke-Call "sts assume-role --role-arn arn:aws:iam::${account}:role/cloudmon-demo-nope --role-session-name cloudmon-demo"
  }
}

$count = 0
$done = $false
$start = Get-Date
try {
  while ($true) {
    $r = Get-Random -Minimum 0 -Maximum 100
    if ($Writes -and $r -lt 12) {
      Invoke-WriteCycle; $count += 2
    }
    elseif ($r -lt 20) {
      Invoke-Call $errs[(Get-Random -Maximum $errs.Count)]; $count++
    }
    elseif ($r -lt 26) {
      Invoke-AssumeBogus; $count++
    }
    else {
      Invoke-Call $reads[(Get-Random -Maximum $reads.Count)]; $count++
    }

    if ($Duration -gt 0 -and ((Get-Date) - $start).TotalSeconds -ge $Duration) {
      $done = $true
      break
    }
    Start-Sleep -Milliseconds ([int]($Interval * 1000))
  }
}
finally {
  Write-Host ''
  if ($done) {
    Write-Host "Done - $count calls in ~$Duration s." -ForegroundColor Cyan
  }
  else {
    Write-Host "Stopped after $count calls." -ForegroundColor Cyan
  }
}

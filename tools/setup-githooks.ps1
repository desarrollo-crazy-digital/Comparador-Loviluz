Param(
  [string]$HooksPath = ".githooks"
)

git config core.hooksPath $HooksPath
Write-Host "Configured git core.hooksPath=$HooksPath"

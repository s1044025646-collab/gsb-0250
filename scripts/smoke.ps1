$env:MORSE_DB_PATH = "data/server.db"
$p = Start-Process -FilePath node -ArgumentList '--disable-warning=ExperimentalWarning','dist/api/server.js','--port','8765' -PassThru -WindowStyle Hidden -RedirectStandardOutput data/server.out
try {
  Start-Sleep -Seconds 2
  Invoke-RestMethod http://127.0.0.1:8765/health | ConvertTo-Json -Compress
  $e = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"text":"agent 42","unit":100}' http://127.0.0.1:8765/api/encode
  $body = @{ segments = $e.segments; unit = 100; tolerance = 0.2 } | ConvertTo-Json -Depth 10
  $d = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body http://127.0.0.1:8765/api/decode
  Write-Output "decode status=$($d.status) text=$($d.text) chars=$($d.chars.Count)"
  try {
    Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"text":"","unit":100}' http://127.0.0.1:8765/api/encode
  } catch {
    Write-Output "error-body: $($_.ErrorDetails.Message)"
  }
} finally {
  Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
}

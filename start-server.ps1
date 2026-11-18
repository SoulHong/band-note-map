# Band Note Map - tiny local web server (built-in Windows PowerShell, nothing to install).
# Only needed if your browser refuses MIDI for a page opened straight from disk (file://).
# It serves this folder at http://localhost:8780/ for your own computer only. Close the window to stop it.
param([switch]$NoBrowser)
$port = 8780
$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.wav'='audio/wav'; '.txt'='text/plain; charset=utf-8'; '.css'='text/css' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Band Note Map is running at http://localhost:$port/  (close this window to stop)"
if (-not $NoBrowser) { Start-Process "http://localhost:$port/index.html" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $rel) { $rel = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $type = $types[[IO.Path]::GetExtension($file).ToLower()]
    if ($type) { $ctx.Response.ContentType = $type }
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}

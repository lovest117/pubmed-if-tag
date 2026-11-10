# 一键发布：打包带版本号的 crx/zip → 提交推送 → 建 GitHub Release 并上传 → 部署主页
# 用法：
#   .\scripts\release.ps1                 # 全流程
#   .\scripts\release.ps1 -SkipDeploy     # 不发 Cloudflare
#   .\scripts\release.ps1 -UseGit         # 用 git rev-parse 当前分支推送（默认 main）

param(
  [string]$Message = "",
  [switch]$SkipDeploy,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$Pem = "E:\Downloads\Pubmed-IF-Tag.pem"
$Repo = "lovest117/pubmed-if-tag"
$Branch = "main"

if (-not (Test-Path -LiteralPath $Chrome)) { throw "找不到 Chrome：$Chrome" }
if (-not (Test-Path -LiteralPath $Pem)) { throw "找不到签名私钥：$Pem" }

# ---------- 1. 读版本号 ----------
$manifestPath = Join-Path $Root "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$ver = $manifest.version
$tag = "v$ver"
$baseName = "Pubmed-IF-Tag-$tag"
Write-Output "▶ 版本 $ver（$baseName）"

# ---------- 2. 组装干净副本 ----------
$stage = Join-Path $env:TEMP "pif-build-$ver"
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$files = @("manifest.json", "content.js", "content.css", "popup.html", "popup.js", "options.html", "options.js")
foreach ($f in $files) { Copy-Item -LiteralPath (Join-Path $Root $f) -Destination $stage }
Copy-Item -LiteralPath (Join-Path $Root "data") -Destination (Join-Path $stage "data") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "icons") -Destination (Join-Path $stage "icons") -Recurse

# 干净副本里不该出现的仓库文档/脚本
$expect = @("manifest.json", "content.js", "content.css", "popup.html", "popup.js", "options.html", "options.js")
$got = @(Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object { $_.Name })
$allowed = @("manifest.json", "content.js", "content.css", "popup.html", "popup.js", "options.html", "options.js",
             "journal-if.js", "library.js", "settings.js", "icon16.png", "icon48.png", "icon128.png")
$extra = $got | Where-Object { $allowed -notcontains $_ }
if ($extra) { throw "打包目录含多余文件：$($extra -join ', ')" }
Write-Output ("  文件清单：" + $got.Count + " 个")

# ---------- 3. 打包 crx ----------
$profile = Join-Path $env:TEMP "pif-pack-profile"
if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
$p = Start-Process -FilePath $Chrome -ArgumentList @(
  "--user-data-dir=$profile",
  "--pack-extension=$stage",
  "--pack-extension-key=$Pem"
) -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "Chrome 打包失败，退出码 $($p.ExitCode)" }

$crxSrc = "$stage.crx"
if (-not (Test-Path -LiteralPath $crxSrc)) { throw "未生成 crx" }
$dist = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$crxOut = Join-Path $dist "$baseName.crx"
Move-Item -LiteralPath $crxSrc -Destination $crxOut -Force

# 校验 crx：CRX 头 + zip 段可读 + manifest 版本
$bytes = [IO.File]::ReadAllBytes($crxOut)
$magic = -join ($bytes[0..3] | ForEach-Object { [char]$_ })
if ($magic -ne "Cr24") { throw "crx 头异常：$magic" }
$zipStart = -1
for ($i = 0; $i -lt $bytes.Length - 8; $i++) {
  if ($bytes[$i] -eq 0x50 -and $bytes[$i+1] -eq 0x4B -and $bytes[$i+2] -eq 0x03 -and $bytes[$i+3] -eq 0x04) { $zipStart = $i; break }
}
if ($zipStart -lt 0) { throw "crx 内找不到 zip 段" }
$tmpZip = Join-Path $env:TEMP "pif-verify-$ver.zip"
[IO.File]::WriteAllBytes($tmpZip, $bytes[$zipStart..($bytes.Length - 1)])
Add-Type -AssemblyName System.IO.Compression.FileSystem
$za = [IO.Compression.ZipFile]::OpenRead($tmpZip)
$entries = @($za.Entries | ForEach-Object { $_.FullName })
$za.Dispose()
Remove-Item -LiteralPath $tmpZip -Force
Write-Output ("  crx 内条目：" + $entries.Count + " 个 · " + [math]::Round((Get-Item $crxOut).Length/1KB,1) + " KB")
if ($entries -notcontains "manifest.json") { throw "crx 根目录缺少 manifest.json" }
if ($entries -notcontains "popup.js") { throw "crx 缺少 popup.js（弹窗逻辑必须外置）" }
if ($entries -contains "README.md" -or $entries -contains "site/index.html") { throw "crx 混入了仓库文档，检查打包目录" }

# popup.html 不允许内联脚本（MV3 会拦截）
$popupHtml = Get-Content -LiteralPath (Join-Path $stage "popup.html") -Raw -Encoding utf8
if ($popupHtml -match '<script>') { throw "popup.html 存在内联 <script>，会被 MV3 CSP 拦截" }

# 期刊库不允许重复键：JS 对象字面量遇到重复键会静默后者覆盖前者，
# 表现是"某本期刊显示了另一本期刊的 IF"，而不报任何错
$dbText = [IO.File]::ReadAllText((Join-Path $stage "data\journal-if.js"), [Text.Encoding]::UTF8)
$dbKeys = @{}
foreach ($line in ($dbText -split "`n")) {
  if ($line -match '^\s*"([^"]+)"\s*:\s*\{\s*if\s*:') {
    $k = $matches[1]
    if ($dbKeys.ContainsKey($k)) { throw "期刊库存在重复键：$k" }
    $dbKeys[$k] = 1
  }
}
Write-Output ("  期刊库：" + $dbKeys.Count + " 条，无重复键")

# ---------- 4. 生成站点下载包 ----------
$dlDir = Join-Path $Root "site\download"
New-Item -ItemType Directory -Force -Path $dlDir | Out-Null
Get-ChildItem -LiteralPath $dlDir -Filter *.zip -File | Remove-Item -Force   # 站点只保留最新一版
$zipOut = Join-Path $dlDir "$baseName.zip"
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipOut -CompressionLevel Optimal
Write-Output ("  zip：" + [math]::Round((Get-Item $zipOut).Length/1KB,1) + " KB → site/download")

# 弹窗检查更新读这个文件（无速率限制、国内可访问）。
# 必须和本次发版同步写入，否则线上会一直报旧版本号，用户点版本号看到的提示就是错的
$verJson = ("{`n  `"version`": `"$ver`",`n  `"zip`": `"$baseName.zip`",`n  `"released`": `"" +
  (Get-Date -Format 'yyyy-MM-dd') + "`"`n}`n")
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $Root "site\version.json"), $verJson, $utf8NoBom)
Write-Output ("  version.json：" + $ver)

# 主页 HTML 里的静态兜底版本号与下载链接同步。
# 页面运行时还会 fetch version.json 覆盖，这两处只是首屏与离线兜底；
# 不同步的话，页面在 version.json 拉取失败时会显示上一版版本号与失效的下载地址。
# 只认带 data-ver-static / data-dl-static 的锚点，changelog 里的历史版本号不会被误改。
$siteIdx = Join-Path $Root "site\index.html"
if (Test-Path -LiteralPath $siteIdx) {
  $htmlOld = [IO.File]::ReadAllText($siteIdx, [Text.Encoding]::UTF8)
  $htmlNew = $htmlOld -replace '(data-ver-static>v)\d+(?:\.\d+)*', ('${1}' + $ver)
  $htmlNew = $htmlNew -replace '(Pubmed-IF-Tag-v)\d+(?:\.\d+)*\.zip', ('${1}' + $ver + '.zip')
  if ($htmlNew -ne $htmlOld) {
    [IO.File]::WriteAllText($siteIdx, $htmlNew, $utf8NoBom)
    Write-Output ("  index.html 静态版本号已同步为 " + $tag)
  } else {
    Write-Output "  index.html 静态版本号无需改动"
  }
  if ($htmlNew -notmatch ('data-ver-static>v' + [regex]::Escape($ver))) {
    throw "index.html 同步后仍不含 data-ver-static>v$ver，检查锚点是否被改动"
  }
}

Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue

# ---------- 5. 提交并推送 ----------
if (-not $NoPush) {
  Push-Location $Root
  git add -A | Out-Null
  $staged = git diff --cached --name-only
  if (-not $staged) {
    Write-Output "  没有需要提交的改动"
  } else {
    $msg = if ($Message) { $Message } else { "发布 $tag" }
    git commit -m $msg | Out-Null
    Write-Output ("  已提交：" + ($staged -join ", "))
  }
  # 不要对 native exe 加 2>&1：PowerShell 会把 stderr 包成 NativeCommandError，
  # 在 ErrorActionPreference=Stop 下直接中断脚本
  git push origin $Branch | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "git push 失败" }
  Write-Output "  已推送 origin/$Branch"
  Pop-Location
}

# ---------- 6. GitHub Release ----------
# 取凭证必须走 cmd 的管道：PowerShell 直接把多行字符串管给 native exe 时，
# git 收不到 protocol 字段，会报 "refusing to work with credential missing protocol field"
$inFile = Join-Path $env:TEMP "pif-cred-in.txt"
[IO.File]::WriteAllText($inFile, "protocol=https`r`nhost=github.com`r`n`r`n", (New-Object Text.ASCIIEncoding))
Push-Location $Root
$credText = cmd /c "type `"$inFile`" | git credential fill" 2>$null
Pop-Location
Remove-Item -LiteralPath $inFile -Force -ErrorAction SilentlyContinue

$line = $credText | Select-String -Pattern "^password="
if (-not $line) { throw "取不到 GitHub token（git credential fill 未返回 password）" }
$token = $line.ToString().Replace("password=", "").Trim()

$headers = @{
  Authorization = "Bearer $token"
  "User-Agent"  = "pubmed-if-tag-release"
  Accept        = "application/vnd.github+json"
}

$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $headers -TimeoutSec 30
} catch {
  $rel = $null
}

if (-not $rel) {
  $payload = @{
    tag_name         = $tag
    name             = "Pubmed IF Tag $tag"
    target_commitish = $Branch
    draft            = $false
    prerelease       = $false
    body             = "见 [README](https://github.com/$Repo#readme) 与 [主页](https://pubmed-if-tag.pages.dev/)。`n`n安装包：``$baseName.zip``（解压后用「加载解压缩的扩展」）。"
  } | ConvertTo-Json -Depth 3
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" -Headers $headers -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 30
  Write-Output ("  已创建 Release $tag（id=" + $rel.id + "）")
} else {
  Write-Output ("  复用已有 Release $tag（id=" + $rel.id + "）")
}

# 同名资产先删，避免上传冲突
foreach ($a in $rel.assets) {
  if ($a.name -in @("$baseName.crx", "$baseName.zip")) {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/assets/$($a.id)" -Headers $headers -Method Delete -TimeoutSec 30
    Write-Output ("  删除旧资产 " + $a.name)
  }
}

foreach ($item in @(
  @{ Path = $crxOut; Type = "application/octet-stream" },
  @{ Path = $zipOut; Type = "application/zip" }
)) {
  $name = Split-Path -Leaf $item.Path
  $bytes = [IO.File]::ReadAllBytes($item.Path)
  $url = "https://uploads.github.com/repos/$Repo/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($name))"
  $res = Invoke-RestMethod -Uri $url -Headers $headers -Method Post -Body $bytes -ContentType $item.Type -TimeoutSec 120
  Write-Output ("  上传 " + $res.name + " · " + $res.size + " bytes · state=" + $res.state)
}

# ---------- 7. 部署主页 ----------
if (-not $SkipDeploy) {
  $ca = Join-Path $env:TEMP "win-ca.pem"
  if (Test-Path -LiteralPath $ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
  Push-Location $Root
  npx --yes wrangler@4 pages deploy (Join-Path $Root "site") --project-name=pubmed-if-tag --branch=main --commit-dirty=true | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "wrangler 部署失败" }
  Write-Output "  已部署 Cloudflare Pages"
  Pop-Location
}

Write-Output ""
Write-Output "✅ 完成：$tag"
Write-Output ("   crx   → " + $crxOut)
Write-Output ("   zip   → " + $zipOut)
Write-Output ("   发布页 → https://github.com/$Repo/releases/tag/$tag")
Write-Output "   主页   → https://pubmed-if-tag.pages.dev/"

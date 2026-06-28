$p = 'tools.js'
$c = [IO.File]::ReadAllText($p)
$old = "    async execute(name, params) {`r`n        const tool = this.tools.get(name);`r`n        if (!tool) throw new Error(`"Tool not found: `${name}`");`r`n        return await tool.fn(params);`r`n    }"
$new = "    async execute(name, params) {`r`n        const tool = this.tools.get(name);`r`n        if (!tool) throw new Error(`"Tool not found: `${name}`");`r`n        const result = await tool.fn(params);`r`n        return sanitizeToolOutput(result);`r`n    }"
if ($c.Contains($old)) {
    [IO.File]::WriteAllText($p, $c.Replace($old, $new))
    Write-Host 'OK: layer-1 execute() patched'
} else {
    Write-Host 'MISS'
    # diagnostic: dump bytes around the target
    $idx = $c.IndexOf('async execute(name, params)')
    if ($idx -ge 0) {
        $snippet = $c.Substring($idx, [Math]::Min(250, $c.Length - $idx))
        Write-Host '--- ACTUAL BYTES ---'
        [System.Text.Encoding]::UTF8.GetBytes($snippet) | ForEach-Object { '{0:X2}' -f $_ } | Select-Object -First 80
    }
}

/**
 * @fileoverview Auto-fix common compilation/runtime errors for C, C++, Python.
 * Detects and fixes missing braces, semicolons, indentation, and syntax issues.
 */

const fs = require('fs');

/**
 * Auto-fix common compilation errors in a source file.
 * Supports C, C++, and Python.
 * @param {string} filePath - Path to the source file
 * @param {string} _compileError - The compiler/runtime error output (unused, kept for API compat)
 * @returns {string} Description of what was fixed, or empty string if no fix needed
 */
function autoFixFile(filePath, _compileError) {
    try {
        if (!fs.existsSync(filePath)) return '';
        const code = fs.readFileSync(filePath, 'utf-8');
        if (!code.trim()) return '';

        const ext = filePath.split('.').pop().toLowerCase();
        let fixes, modified;

        if (ext === 'c') {
            ({ fixes, code: modified } = _fixC(code));
        } else if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp') {
            ({ fixes, code: modified } = _fixCpp(code));
        } else if (ext === 'py' || ext === 'python') {
            ({ fixes, code: modified } = _fixPython(code));
        } else {
            return '';
        }

        if (!fixes || fixes.length === 0) return '';

        fs.writeFileSync(filePath, modified, 'utf-8');
        return 'Auto-fixed: ' + fixes.join('; ') + '. Re-compile/run to verify.';
    } catch (e) {
        return '';
    }
}

/**
 * Fix common C compilation errors.
 * Returns { fixes: string[], code: string }.
 */
function _fixC(code) {
    const fixes = [];
    let modified = code;

    // 1. Missing closing braces
    const openBraces = (modified.match(/\{/g) || []).length;
    const closeBraces = (modified.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
        const missing = openBraces - closeBraces;
        modified += '\n' + '}'.repeat(missing);
        fixes.push(`Added ${missing} missing closing brace(s)`);
    }

    // 2. Missing semicolon at end of file
    const lastLine = modified.trim().split('\n').pop()?.trim() || '';
    if (lastLine && !lastLine.endsWith(';') && !lastLine.endsWith('}') && !lastLine.endsWith('{') && !lastLine.endsWith(')')) {
        if (!lastLine.match(/^\w+\s+\w+\s*\(/) && /^(int|char|float|double|void|return|printf|puts|exit|break|continue)/.test(lastLine)) {
            modified += ';';
            fixes.push('Added missing semicolon at end of file');
        }
    }

    // 3. Unclosed parentheses in printf/function calls
    const openParens = (modified.match(/\(/g) || []).length;
    const closeParens = (modified.match(/\)/g) || []).length;
    if (openParens > closeParens) {
        const lines = modified.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const lp = (lines[i].match(/\(/g) || []).length;
            const rp = (lines[i].match(/\)/g) || []).length;
            if (lp > rp) {
                if (lines[i].includes('printf') || lines[i].includes('puts')) {
                    lines[i] = lines[i].trimRight() + ');';
                    fixes.push(`Fixed unclosed printf() call on line ${i + 1}`);
                } else {
                    lines[i] = lines[i].trimRight() + ')';
                    fixes.push(`Fixed unclosed parenthesis on line ${i + 1}`);
                }
                modified = lines.join('\n');
                break;
            }
        }
    }

    return { fixes, code: modified };
}

/**
 * Fix common C++ compilation errors.
 * Returns { fixes: string[], code: string }.
 */
function _fixCpp(code) {
    const fixes = [];
    let modified = code;

    // 1. Missing closing braces
    const openBraces = (modified.match(/\{/g) || []).length;
    const closeBraces = (modified.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
        const missing = openBraces - closeBraces;
        modified += '\n' + '}'.repeat(missing);
        fixes.push(`Added ${missing} missing closing brace(s)`);
    }

    // 2. Missing semicolon after class/struct
    const newCode = modified.replace(/^(\s*)\}(?:\s*\/\/.*)?\s*\n(?=\s*(?:int|void|class|struct|using|namespace|template|#))/gm, '$1};\n');
    if (newCode !== modified) {
        fixes.push('Added missing semicolon after class/struct');
        modified = newCode;
    }

    // 3. Missing semicolons on cout/cin statements
    const lines = modified.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}') && !line.endsWith('(') && !line.endsWith(')')) {
            if (/^(cout|cin|cerr|clog|std::cout|std::cin)\s*<</.test(line)) {
                lines[i] = lines[i].trimRight() + ';';
                fixes.push(`Added missing semicolon on line ${i + 1} (cout/cin)`);
                modified = lines.join('\n');
                break;
            }
        }
    }

    // 4. Fix empty #include directives — model sometimes omits header names
    // Detect "#include \n" or "#include  \n" and add the needed headers
    const emptyInclude = /^#include\s*$/m;
    if (emptyInclude.test(modified)) {
        const needed = _detectMissingCppHeaders(modified);
        if (needed.length > 0) {
            const headers = [...needed];
            let idx = 0;
            modified = modified.replace(/^#include\s*$/gm, () => {
                const h = headers[idx++];
                return h ? `#include <${h}>` : '';
            });
            fixes.push('Added missing C++ headers: ' + needed.join(', '));
        }
    }

    return { fixes, code: modified };
}

/**
 * Fix common Python runtime errors.
 * Returns { fixes: string[], code: string }.
 */
function _fixPython(code) {
    const fixes = [];
    let modified = code;
    const lines = modified.split('\n');

    // 1. Missing colon after control flow keywords
    const colonKw = /\b(if|elif|else|for|while|def|class|try|except|finally|with|async|await)\s*[\(]?.*[\)]?\s*$/;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimRight();
        const stripped = trimmed.trim();
        if (stripped && colonKw.test(stripped) && !stripped.endsWith(':')) {
            lines[i] = trimmed + ':';
            fixes.push(`Added missing colon on line ${i + 1}`);
            modified = lines.join('\n');
            break;
        }
    }

    // 2. Inconsistent indentation (tabs vs spaces)
    let hasMixed = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('\t') && lines[i].includes('    ')) {
            hasMixed = true;
            break;
        }
    }
    if (hasMixed) {
        modified = modified.replace(/\t/g, '    ');
        fixes.push('Fixed mixed indentation (tabs → spaces)');
    }

    // 3. Empty block body — add pass
    const lines2 = modified.split('\n');
    for (let i = 0; i < lines2.length; i++) {
        const stripped = lines2[i].trim();
        if (/^(def |class |if |elif |else:|for |while |with |try:|except |finally:)/.test(stripped)) {
            let nextNonEmpty = -1;
            for (let j = i + 1; j < lines2.length; j++) {
                if (lines2[j].trim() !== '') { nextNonEmpty = j; break; }
            }
            if (nextNonEmpty !== -1 && lines2[nextNonEmpty].search(/\S/) !== -1 &&
                lines2[nextNonEmpty].search(/\S/) <= lines2[i].search(/\S/)) {
                const indent = lines2[i].match(/^(\s*)/)[1];
                lines2.splice(i + 1, 0, indent + '    pass');
                fixes.push("Added 'pass' after empty block on line " + (i + 1));
                modified = lines2.join('\n');
                break;
            }
        }
    }

    return { fixes, code: modified };
}

/**
 * Scan C++ code for used symbols and return needed header names.
 * Maps common identifiers to their standard library headers.
 */
function _detectMissingCppHeaders(code) {
    const needed = [];
    const symbolHeaderMap = [
        { re: /\bstd::cout\b|\bstd::cin\b|\bstd::cerr\b|\bstd::clog\b|\bcout\b|\bcin\b|\bcerr\b|\bclog\b|\bendl\b/,        h: 'iostream' },
        { re: /\bstd::vector\b|\bvector\s*[<(]/,                                                                          h: 'vector' },
        { re: /\bstd::array\b|\barray\s*[<(]/,                                                                            h: 'array' },
        { re: /\bstd::string\b|\bstd::to_string\b|\bstd::getline\b/,                                                       h: 'string' },
        { re: /\bstd::map\b|\bmap\s*[<(]/,                                                                                h: 'map' },
        { re: /\bstd::set\b|\bset\s*[<(]/,                                                                                h: 'set' },
        { re: /\bstd::unordered_map\b/,                                                                                   h: 'unordered_map' },
        { re: /\bstd::unordered_set\b/,                                                                                   h: 'unordered_set' },
        { re: /\bstd::sort\b|\bstd::find\b|\bstd::max\b|\bstd::min\b|\bstd::reverse\b|\bstd::binary_search\b/,             h: 'algorithm' },
        { re: /\bstd::thread\b/,                                                                                          h: 'thread' },
        { re: /\bstd::mutex\b|\bstd::lock_guard\b|\bstd::unique_lock\b/,                                                  h: 'mutex' },
        { re: /\bstd::fstream\b|\bstd::ifstream\b|\bstd::ofstream\b/,                                                     h: 'fstream' },
        { re: /\bstd::stringstream\b|\bstd::istringstream\b|\bstd::ostringstream\b/,                                       h: 'sstream' },
        { re: /\bstd::sqrt\b|\bstd::pow\b|\bstd::sin\b|\bstd::cos\b/,                                                     h: 'cmath' },
        { re: /\babs\s*\(/,                                                                                               h: 'cstdlib' },
        { re: /\bstd::make_shared\b|\bstd::make_unique\b|\bstd::shared_ptr\b|\bstd::unique_ptr\b/,                         h: 'memory' },
        { re: /\bstd::function\b/,                                                                                        h: 'functional' },
        { re: /\bstd::optional\b/,                                                                                        h: 'optional' },
        { re: /\bstd::variant\b/,                                                                                         h: 'variant' },
        { re: /\bstd::tuple\b/,                                                                                           h: 'tuple' },
        { re: /\bstd::chrono::/,                                                                                          h: 'chrono' },
        { re: /\bstd::filesystem::/,                                                                                      h: 'filesystem' },
        { re: /\bstd::regex\b/,                                                                                           h: 'regex' },
        { re: /\bstd::async\b|\bstd::future\b|\bstd::promise\b/,                                                          h: 'future' },
    ];
    for (const { re, h } of symbolHeaderMap) {
        if (re.test(code) && !needed.includes(h)) {
            needed.push(h);
        }
    }
    return needed;
}

// Backward-compatible alias
module.exports = { autoFixFile, autoFixCFile: autoFixFile };

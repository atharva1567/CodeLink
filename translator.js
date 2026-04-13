// translator.js — CodeLink Translation Engine
// Rule-based source-to-source translator for Python, Java, C++, JavaScript.
// Organized as: translate(code, from, to) → string

"use strict";

// ─── Public API ───────────────────────────────────────────────────────────────

function translate(code, from, to) {
  if (from === to) return code;
  const key = `${from}_${to}`;
  const fn = TRANSLATORS[key];
  if (!fn) return `// Translation from ${from} to ${to} is not yet supported.\n`;
  try {
    return fn(code.trimEnd());
  } catch (e) {
    return `// Translation error: ${e.message}\n// Please review manually.\n`;
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

// Strip trailing whitespace per line, keep blank lines
function cleanLines(lines) {
  return lines.map(l => l.trimEnd());
}

// Detect indent level (count leading spaces, treating 4-space or 2-space as one level)
function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : '';
}

function indentCount(line, size = 4) {
  return Math.floor(indentOf(line).length / size);
}

// Convert Python/JS indent level to a brace-based language indent string
function ind(level, size = 4) {
  return ' '.repeat(level * size);
}

// Wrap a block of lines with open/close braces at a given indent level
function braceBlock(bodyLines, level) {
  return [
    `${ind(level)}{`,
    ...bodyLines,
    `${ind(level)}}`
  ];
}

// Infer Java/C++ type from a value string
function inferType(val, lang = 'java') {
  val = val.trim();
  if (/^-?\d+$/.test(val)) return 'int';
  if (/^-?\d+\.\d+$/.test(val)) return lang === 'java' ? 'double' : 'double';
  if (/^(true|false)$/.test(val)) return 'boolean';
  if (/^["']/.test(val)) return lang === 'java' ? 'String' : 'string';
  if (/^\[/.test(val)) return lang === 'java' ? 'int[]' : 'vector<int>';
  return 'auto';
}

// Convert a Python/JS print string to a Java println argument chain
// e.g. "Hello " + name  →  "Hello " + name  (stays the same)
// Handles f-strings: f"x is {x}" → "x is " + x
function convertFString(s) {
  // f"..." or f'...'
  const fm = s.match(/^f["'](.*?)["']$/s);
  if (!fm) return s;
  const inner = fm[1];
  // Split on {expr}
  const parts = [];
  let remaining = inner;
  const re = /\{([^}]+)\}/g;
  let match, last = 0;
  while ((match = re.exec(inner)) !== null) {
    const before = inner.slice(last, match.index);
    if (before) parts.push(`"${before}"`);
    parts.push(match[1]);
    last = match.index + match[0].length;
  }
  const tail = inner.slice(last);
  if (tail) parts.push(`"${tail}"`);
  return parts.length ? parts.join(' + ') : '""';
}

// Convert Java/C++ string concat to JS template literal
function toTemplateLiteral(expr) {
  // "text" + var + "text" → `text${var}text`
  const parts = expr.split(/\s*\+\s*/);
  let result = '';
  for (const p of parts) {
    const trimmed = p.trim();
    const strMatch = trimmed.match(/^["'](.*?)["']$/);
    if (strMatch) {
      result += strMatch[1];
    } else {
      result += '${' + trimmed + '}';
    }
  }
  return '`' + result + '`';
}

// Convert a for-range condition to Python range call
// for (int i = 0; i < 10; i++) → range(0, 10)
// for (int i = 0; i < n; i++) → range(n)
function toPythonRange(init, cond, incr) {
  const initM  = init.trim().match(/(?:int\s+|let\s+|var\s+)?(\w+)\s*=\s*(.+)/);
  const condM  = cond.trim().match(/(\w+)\s*(<|<=|>|>=)\s*(.+)/);
  if (!initM || !condM) return null;
  const varName = initM[1];
  const start   = initM[2].trim();
  const op      = condM[2];
  let   end     = condM[3].trim();

  // step detection
  let step = null;
  if (/\+=\s*(\d+)/.test(incr)) step = incr.match(/\+=\s*(\d+)/)[1];
  else if (/\-=\s*(\d+)/.test(incr)) { step = '-' + incr.match(/\-=\s*(\d+)/)[1]; }

  if (op === '<=') end = `${end} + 1`;
  else if (op === '>') { end = start; /* reversed — just note it */ }

  const startStr = start === '0' ? '' : start + ', ';
  const stepStr  = step ? `, ${step}` : '';
  return { varName, range: `range(${startStr}${end}${stepStr})` };
}

// ─── Python → Java ────────────────────────────────────────────────────────────

function pythonToJava(code) {
  const lines = code.split('\n');
  const out = [];

  // Collect top-level function names to know what's a method
  const funcNames = lines
    .filter(l => /^def\s+\w+/.test(l.trim()))
    .map(l => l.trim().match(/^def\s+(\w+)/)[1]);
  const hasMain = funcNames.includes('main');

  out.push('public class Main {');
  out.push('');

  let i = 0;
  let classIndentStack = []; // track Python class state

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const baseIndent = indentOf(line);
    const lvl = Math.floor(baseIndent.length / 4) + 1; // +1 for class wrapper

    // Skip blank
    if (trimmed === '') { out.push(''); i++; continue; }

    // Comment
    if (trimmed.startsWith('#')) {
      out.push(`${ind(lvl)}//${trimmed.slice(1)}`);
      i++; continue;
    }

    // Class definition
    const classDef = trimmed.match(/^class\s+(\w+)(?:\((\w+)\))?:/);
    if (classDef) {
      const cname = classDef[1];
      const parent = classDef[2] && classDef[2] !== 'object' ? ` extends ${classDef[2]}` : '';
      out.push(`${ind(lvl)}public static class ${cname}${parent} {`);
      i++; continue;
    }

    // Function / method definition
    const funcDef = trimmed.match(/^def\s+(\w+)\s*\((.*?)\)\s*(?:->\s*\S+)?:/);
    if (funcDef) {
      const fname = funcDef[1];
      const params = funcDef[2];
      const isMain = fname === 'main';
      const isCtor = false; // Python __init__ → constructor

      let jParams = '';
      if (params.trim() && params.trim() !== 'self') {
        const ps = params.split(',')
          .map(p => p.trim())
          .filter(p => p && p !== 'self')
          .map(p => {
            // type hints: name: type
            const th = p.match(/^(\w+)\s*:\s*(\w+)/);
            if (th) {
              const jType = pyTypeToJava(th[2]);
              return `${jType} ${th[1]}`;
            }
            return `Object ${p}`;
          });
        jParams = ps.join(', ');
      }

      if (isMain) {
        out.push(`${ind(lvl)}public static void main(String[] args) {`);
      } else if (fname === '__init__') {
        // Constructor — get class name from context
        out.push(`${ind(lvl)}public Main(${jParams}) {`);
      } else if (fname.startsWith('__')) {
        out.push(`${ind(lvl)}// [manual review needed] special method: ${trimmed}`);
        out.push(`${ind(lvl)}public Object ${fname}(${jParams}) {`);
      } else {
        out.push(`${ind(lvl)}public static Object ${fname}(${jParams}) {`);
      }
      i++; continue;
    }

    // Return
    const ret = trimmed.match(/^return\s*(.*)/);
    if (ret) {
      out.push(`${ind(lvl)}return ${convertExprPyToJava(ret[1])};`);
      i++; continue;
    }

    // print(...)
    const printM = trimmed.match(/^print\((.*)\)$/s);
    if (printM) {
      let arg = printM[1].trim();
      arg = convertFString(arg);
      arg = convertExprPyToJava(arg);
      out.push(`${ind(lvl)}System.out.println(${arg});`);
      i++; continue;
    }

    // For loop — for x in range(...)
    const forRange = trimmed.match(/^for\s+(\w+)\s+in\s+range\(([^)]+)\):/);
    if (forRange) {
      const v = forRange[1];
      const args = forRange[2].split(',').map(a => a.trim());
      let start = '0', end = '', step = '1', op = '<';
      if (args.length === 1) { end = args[0]; }
      else if (args.length === 2) { start = args[0]; end = args[1]; }
      else { start = args[0]; end = args[1]; step = args[2]; }
      if (step.startsWith('-')) { op = '>'; }
      out.push(`${ind(lvl)}for (int ${v} = ${start}; ${v} ${op} ${end}; ${v} += ${step}) {`);
      i++; continue;
    }

    // For loop — for item in list
    const forIn = trimmed.match(/^for\s+(\w+)\s+in\s+(.+):/);
    if (forIn) {
      out.push(`${ind(lvl)}for (Object ${forIn[1]} : ${convertExprPyToJava(forIn[2])}) {`);
      i++; continue;
    }

    // While
    const whileM = trimmed.match(/^while\s+(.+):/);
    if (whileM) {
      out.push(`${ind(lvl)}while (${convertExprPyToJava(whileM[1])}) {`);
      i++; continue;
    }

    // If / elif / else
    const ifM = trimmed.match(/^if\s+(.+):/);
    if (ifM) {
      out.push(`${ind(lvl)}if (${convertExprPyToJava(ifM[1])}) {`);
      i++; continue;
    }
    if (trimmed.match(/^elif\s+(.+):/)) {
      const cond = trimmed.match(/^elif\s+(.+):/)[1];
      out.push(`${ind(lvl - 1)}} else if (${convertExprPyToJava(cond)}) {`);
      i++; continue;
    }
    if (trimmed === 'else:') {
      out.push(`${ind(lvl - 1)}} else {`);
      i++; continue;
    }

    // Closing dedent: detect a line at lower indent that follows a block
    // We handle braces by tracking indent changes
    // Emit closing brace when indent decreases
    // (handled by emitting { when block starts and } when indent drops)
    // Since Python uses dedent, we emit } when the NEXT line is at a lower level
    // Strategy: look ahead
    const nextTrimmed = (lines[i + 1] || '').trim();
    const nextIndent  = indentOf(lines[i + 1] || '');
    const nextLvl     = Math.floor(nextIndent.length / 4) + 1;

    // Variable declaration
    const varDecl = trimmed.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (varDecl && !trimmed.includes('==')) {
      const name = varDecl[1];
      const val  = convertExprPyToJava(varDecl[2]);
      const type = inferType(varDecl[2], 'java');
      if (type === 'auto') {
        out.push(`${ind(lvl)}Object ${name} = ${val};`);
      } else {
        out.push(`${ind(lvl)}${type} ${name} = ${val};`);
      }
      // Emit closing braces if indent drops
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // Augmented assignment
    const augAssign = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
    if (augAssign) {
      out.push(`${ind(lvl)}${augAssign[1]} ${augAssign[2]} ${convertExprPyToJava(augAssign[3])};`);
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // Pass
    if (trimmed === 'pass') { out.push(`${ind(lvl)}// pass`); i++; continue; }

    // Break / continue
    if (trimmed === 'break')    { out.push(`${ind(lvl)}break;`); i++; continue; }
    if (trimmed === 'continue') { out.push(`${ind(lvl)}continue;`); i++; continue; }

    // Fallback — expression statement
    out.push(`${ind(lvl)}${convertExprPyToJava(trimmed)};`);
    emitClosingBraces(out, lvl, nextLvl);
    i++;
  }

  // Close outer class
  out.push('}');
  out.push('');

  return cleanLines(out).join('\n');
}

function emitClosingBraces(out, currentLvl, nextLvl) {
  for (let l = currentLvl; l > nextLvl; l--) {
    out.push(`${ind(l - 1)}}`);
  }
}

function pyTypeToJava(t) {
  const map = { int:'int', float:'double', str:'String', bool:'boolean', list:'List', dict:'Map', void:'void' };
  return map[t] || t;
}

function convertExprPyToJava(expr) {
  if (!expr) return '';
  let e = expr.trim();
  // Boolean literals
  e = e.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
  // not → !
  e = e.replace(/\bnot\s+/g, '!');
  // and/or
  e = e.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||');
  // String methods
  e = e.replace(/\.upper\(\)/g, '.toUpperCase()');
  e = e.replace(/\.lower\(\)/g, '.toLowerCase()');
  e = e.replace(/\.strip\(\)/g, '.trim()');
  e = e.replace(/\.append\(([^)]+)\)/g, '.add($1)');
  e = e.replace(/len\(([^)]+)\)/g, '$1.length()');
  // f-string
  e = convertFString(e);
  // Floor division
  e = e.replace(/\/\//g, '/');
  // Exponent
  e = e.replace(/(\w+)\s*\*\*\s*(\w+)/g, 'Math.pow($1, $2)');
  return e;
}

// ─── Python → C++ ─────────────────────────────────────────────────────────────

function pythonToCpp(code) {
  const lines = code.split('\n');
  const out = [];
  out.push('#include <iostream>');
  out.push('#include <string>');
  out.push('#include <vector>');
  out.push('using namespace std;');
  out.push('');

  let i = 0;
  let inClass = false;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const baseIndent = indentOf(line);
    const lvl = Math.floor(baseIndent.length / 4);
    const nextIndent = indentOf(lines[i + 1] || '');
    const nextLvl = Math.floor(nextIndent.length / 4);

    if (trimmed === '') { out.push(''); i++; continue; }
    if (trimmed.startsWith('#')) { out.push(`${ind(lvl)}//${trimmed.slice(1)}`); i++; continue; }

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\((\w+)\))?:/);
    if (classDef) {
      const parent = classDef[2] && classDef[2] !== 'object' ? ` : public ${classDef[2]}` : '';
      out.push(`${ind(lvl)}class ${classDef[1]}${parent} {`);
      out.push(`${ind(lvl)}public:`);
      inClass = true;
      i++; continue;
    }

    // Function
    const funcDef = trimmed.match(/^def\s+(\w+)\s*\((.*?)\)\s*(?:->\s*(\S+))?:/);
    if (funcDef) {
      const fname = funcDef[1];
      const params = funcDef[2];
      const retHint = funcDef[3];
      const retType = retHint ? pyTypeToCpp(retHint) : 'void';
      const isMain = fname === 'main';
      let cppParams = '';
      if (params.trim() && params.trim() !== 'self') {
        cppParams = params.split(',')
          .map(p => p.trim()).filter(p => p && p !== 'self')
          .map(p => {
            const th = p.match(/^(\w+)\s*:\s*(\w+)/);
            if (th) return `${pyTypeToCpp(th[2])} ${th[1]}`;
            return `auto ${p}`;
          }).join(', ');
      }
      if (isMain) {
        out.push(`int main() {`);
      } else {
        out.push(`${ind(lvl)}${retType} ${fname}(${cppParams}) {`);
      }
      i++; continue;
    }

    // Return
    const ret = trimmed.match(/^return\s*(.*)/);
    if (ret) {
      out.push(`${ind(lvl)}return ${convertExprPyToCpp(ret[1])};`);
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // print
    const printM = trimmed.match(/^print\((.*)\)$/s);
    if (printM) {
      let arg = printM[1].trim();
      const parts = parsePrintArgs(arg);
      const chain = parts.map(p => convertExprPyToCpp(convertFString(p))).join(' << ');
      out.push(`${ind(lvl)}cout << ${chain} << endl;`);
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // For range
    const forRange = trimmed.match(/^for\s+(\w+)\s+in\s+range\(([^)]+)\):/);
    if (forRange) {
      const v = forRange[1];
      const args = forRange[2].split(',').map(a => a.trim());
      let start = '0', end = '', step = '1', op = '<';
      if (args.length === 1) end = args[0];
      else if (args.length === 2) { start = args[0]; end = args[1]; }
      else { start = args[0]; end = args[1]; step = args[2]; }
      if (step.startsWith('-')) op = '>';
      out.push(`${ind(lvl)}for (int ${v} = ${start}; ${v} ${op} ${end}; ${v} += ${step}) {`);
      i++; continue;
    }

    // For in
    const forIn = trimmed.match(/^for\s+(\w+)\s+in\s+(.+):/);
    if (forIn) {
      out.push(`${ind(lvl)}for (auto ${forIn[1]} : ${convertExprPyToCpp(forIn[2])}) {`);
      i++; continue;
    }

    // While
    const whileM = trimmed.match(/^while\s+(.+):/);
    if (whileM) {
      out.push(`${ind(lvl)}while (${convertExprPyToCpp(whileM[1])}) {`);
      i++; continue;
    }

    // If/elif/else
    const ifM = trimmed.match(/^if\s+(.+):/);
    if (ifM) { out.push(`${ind(lvl)}if (${convertExprPyToCpp(ifM[1])}) {`); i++; continue; }
    const elifM = trimmed.match(/^elif\s+(.+):/);
    if (elifM) { out.push(`${ind(Math.max(0,lvl-1))}} else if (${convertExprPyToCpp(elifM[1])}) {`); i++; continue; }
    if (trimmed === 'else:') { out.push(`${ind(Math.max(0,lvl-1))}} else {`); i++; continue; }

    // Var decl
    const varDecl = trimmed.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (varDecl && !trimmed.includes('==')) {
      const type = inferType(varDecl[2], 'cpp');
      const val  = convertExprPyToCpp(varDecl[2]);
      out.push(`${ind(lvl)}${type === 'auto' ? 'auto' : type} ${varDecl[1]} = ${val};`);
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // Augmented assignment
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
    if (augA) { out.push(`${ind(lvl)}${augA[1]} ${augA[2]} ${convertExprPyToCpp(augA[3])};`); emitClosingBraces(out, lvl, nextLvl); i++; continue; }

    if (trimmed === 'pass') { out.push(`${ind(lvl)}// pass`); i++; continue; }
    if (trimmed === 'break')    { out.push(`${ind(lvl)}break;`); i++; continue; }
    if (trimmed === 'continue') { out.push(`${ind(lvl)}continue;`); i++; continue; }

    out.push(`${ind(lvl)}${convertExprPyToCpp(trimmed)};`);
    emitClosingBraces(out, lvl, nextLvl);
    i++;
  }

  out.push('');
  return cleanLines(out).join('\n');
}

function pyTypeToCpp(t) {
  const map = { int:'int', float:'double', str:'string', bool:'bool', list:'vector<auto>', void:'void' };
  return map[t] || t;
}

function convertExprPyToCpp(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false').replace(/\bNone\b/g,'nullptr');
  e = e.replace(/\bnot\s+/g,'!');
  e = e.replace(/\band\b/g,'&&').replace(/\bor\b/g,'||');
  e = e.replace(/\.upper\(\)/g,'.toupper()');
  e = e.replace(/\.lower\(\)/g,'.tolower()');
  e = e.replace(/\.strip\(\)/g,'/* .strip() — use manual trim */');
  e = e.replace(/\.append\(([^)]+)\)/g,'.push_back($1)');
  e = e.replace(/len\(([^)]+)\)/g,'$1.size()');
  e = e.replace(/(\w+)\s*\*\*\s*(\w+)/g,'pow($1, $2)');
  e = convertFString(e);
  return e;
}

// parse comma args in print(), respecting nested parens
function parsePrintArgs(str) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(' || ch === '[') { depth++; cur += ch; }
    else if (ch === ')' || ch === ']') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ─── Python → JavaScript ──────────────────────────────────────────────────────

function pythonToJs(code) {
  const lines = code.split('\n');
  const out = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const baseIndent = indentOf(line);
    const lvl = Math.floor(baseIndent.length / 4);
    const nextLvl = Math.floor(indentOf(lines[i + 1] || '').length / 4);

    if (trimmed === '') { out.push(''); i++; continue; }
    if (trimmed.startsWith('#')) { out.push(`${ind(lvl)}//${trimmed.slice(1)}`); i++; continue; }

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\((\w+)\))?:/);
    if (classDef) {
      const ext = classDef[2] && classDef[2] !== 'object' ? ` extends ${classDef[2]}` : '';
      out.push(`${ind(lvl)}class ${classDef[1]}${ext} {`);
      i++; continue;
    }

    // Function
    const funcDef = trimmed.match(/^def\s+(\w+)\s*\((.*?)\)\s*(?:->\s*\S+)?:/);
    if (funcDef) {
      const fname = funcDef[1];
      const params = funcDef[2].split(',').map(p=>{
        const pTrim = p.trim();
        if (!pTrim || pTrim === 'self') return null;
        return pTrim.replace(/\s*:\s*\w+/,'').replace(/\s*=\s*.+/,'').trim();
      }).filter(Boolean).join(', ');
      if (fname === '__init__') {
        out.push(`${ind(lvl)}constructor(${params}) {`);
      } else {
        out.push(`${ind(lvl)}function ${fname}(${params}) {`);
      }
      i++; continue;
    }

    // Return
    const ret = trimmed.match(/^return\s*(.*)/);
    if (ret) { out.push(`${ind(lvl)}return ${convertExprPyToJs(ret[1])};`); emitClosingBraces(out, lvl, nextLvl); i++; continue; }

    // print
    const printM = trimmed.match(/^print\((.*)\)$/s);
    if (printM) {
      let arg = printM[1].trim();
      // f-string → template literal
      const fm = arg.match(/^f["'](.*?)["']$/s);
      if (fm) {
        let tl = fm[1].replace(/\{([^}]+)\}/g, '${$1}');
        out.push(`${ind(lvl)}console.log(\`${tl}\`);`);
      } else {
        out.push(`${ind(lvl)}console.log(${convertExprPyToJs(arg)});`);
      }
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // For range
    const forRange = trimmed.match(/^for\s+(\w+)\s+in\s+range\(([^)]+)\):/);
    if (forRange) {
      const v = forRange[1];
      const args = forRange[2].split(',').map(a=>a.trim());
      let start='0', end='', step='1', op='<';
      if (args.length===1) end=args[0];
      else if (args.length===2) { start=args[0]; end=args[1]; }
      else { start=args[0]; end=args[1]; step=args[2]; }
      if (step.startsWith('-')) op='>';
      const stepStr = step === '1' ? `${v}++` : `${v} += ${step}`;
      out.push(`${ind(lvl)}for (let ${v} = ${start}; ${v} ${op} ${end}; ${stepStr}) {`);
      i++; continue;
    }

    // For in
    const forIn = trimmed.match(/^for\s+(\w+)\s+in\s+(.+):/);
    if (forIn) {
      out.push(`${ind(lvl)}for (let ${forIn[1]} of ${convertExprPyToJs(forIn[2])}) {`);
      i++; continue;
    }

    // While / if / elif / else
    const whileM = trimmed.match(/^while\s+(.+):/);
    if (whileM) { out.push(`${ind(lvl)}while (${convertExprPyToJs(whileM[1])}) {`); i++; continue; }
    const ifM = trimmed.match(/^if\s+(.+):/);
    if (ifM) { out.push(`${ind(lvl)}if (${convertExprPyToJs(ifM[1])}) {`); i++; continue; }
    const elifM = trimmed.match(/^elif\s+(.+):/);
    if (elifM) { out.push(`${ind(Math.max(0,lvl-1))}} else if (${convertExprPyToJs(elifM[1])}) {`); i++; continue; }
    if (trimmed === 'else:') { out.push(`${ind(Math.max(0,lvl-1))}} else {`); i++; continue; }

    // Variable
    const varDecl = trimmed.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (varDecl && !trimmed.includes('==')) {
      out.push(`${ind(lvl)}let ${varDecl[1]} = ${convertExprPyToJs(varDecl[2])};`);
      emitClosingBraces(out, lvl, nextLvl);
      i++; continue;
    }

    // Augmented assignment
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
    if (augA) { out.push(`${ind(lvl)}${augA[1]} ${augA[2]} ${convertExprPyToJs(augA[3])};`); emitClosingBraces(out, lvl, nextLvl); i++; continue; }

    if (trimmed === 'pass') { out.push(`${ind(lvl)}// pass`); i++; continue; }
    if (trimmed === 'break') { out.push(`${ind(lvl)}break;`); i++; continue; }
    if (trimmed === 'continue') { out.push(`${ind(lvl)}continue;`); i++; continue; }

    out.push(`${ind(lvl)}${convertExprPyToJs(trimmed)};`);
    emitClosingBraces(out, lvl, nextLvl);
    i++;
  }

  return cleanLines(out).join('\n');
}

function convertExprPyToJs(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false').replace(/\bNone\b/g,'null');
  e = e.replace(/\bnot\s+/g,'!');
  e = e.replace(/\band\b/g,'&&').replace(/\bor\b/g,'||');
  e = e.replace(/\.append\(([^)]+)\)/g,'.push($1)');
  e = e.replace(/len\(([^)]+)\)/g,'$1.length');
  e = e.replace(/(\w+)\s*\*\*\s*(\w+)/g,'Math.pow($1, $2)');
  e = e.replace(/\.upper\(\)/g,'.toUpperCase()').replace(/\.lower\(\)/g,'.toLowerCase()');
  e = e.replace(/\.strip\(\)/g,'.trim()');
  return e;
}

// ─── Java → Python ────────────────────────────────────────────────────────────

function javaToPickython(code) {
  const lines = code.split('\n');
  const out = [];
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '' || trimmed === '{' || trimmed === '}' || trimmed === '};') {
      if (trimmed === '}' || trimmed === '};') { indentLevel = Math.max(0, indentLevel - 1); }
      continue;
    }

    // Skip imports and package
    if (/^(import|package)\s/.test(trimmed)) continue;

    // Comments
    if (trimmed.startsWith('//')) { out.push(`${ind(indentLevel)}#${trimmed.slice(2)}`); continue; }
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      out.push(`${ind(indentLevel)}# ${trimmed.replace(/^[/*]+\s*/,'').replace(/\*\/$/,'').trim()}`);
      continue;
    }

    // Class definition
    const classDef = trimmed.match(/^(?:public\s+)?(?:static\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classDef) {
      const parent = classDef[2] ? `(${classDef[2]})` : '';
      out.push(`${ind(indentLevel)}class ${classDef[1]}${parent}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // main method
    if (/public static void main\s*\(/.test(trimmed)) {
      out.push(`${ind(indentLevel)}def main():`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // Method/function
    const methDef = trimmed.match(/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*(\w[\w<>\[\]]*)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+\w+\s*)?\{?$/);
    if (methDef && methDef[2] !== 'if' && methDef[2] !== 'while' && methDef[2] !== 'for') {
      const fname = methDef[2];
      const params = methDef[3].split(',').map(p => {
        const parts = p.trim().split(/\s+/);
        return parts[parts.length - 1] || '';
      }).filter(Boolean);
      const hasSelf = trimmed.includes('static') ? '' : 'self, ';
      out.push(`${ind(indentLevel)}def ${fname}(${hasSelf}${params.join(', ')}):`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // Variable declaration
    const varDecl = trimmed.match(/^(?:int|double|float|long|String|boolean|char|var|auto)\s+(\w+)\s*=\s*(.+);$/);
    if (varDecl) {
      out.push(`${ind(indentLevel)}${varDecl[1]} = ${convertExprJavaToPy(varDecl[2])}`);
      continue;
    }

    // Println / print
    const printM = trimmed.match(/^System\.out\.println\((.*)\);$/);
    if (printM) {
      out.push(`${ind(indentLevel)}print(${convertExprJavaToPy(printM[1])})`);
      continue;
    }
    const printNoNl = trimmed.match(/^System\.out\.print\((.*)\);$/);
    if (printNoNl) {
      out.push(`${ind(indentLevel)}print(${convertExprJavaToPy(printNoNl[1])}, end='')`);
      continue;
    }

    // For i loop
    const forI = trimmed.match(/^for\s*\(\s*(?:int|var)\s+(\w+)\s*=\s*([^;]+);\s*\1\s*(<|<=|>|>=)\s*([^;]+);\s*\1(\+\+|--|[+\-]=\s*\d+)\s*\)/);
    if (forI) {
      const v = forI[1], start = forI[2].trim(), op = forI[3], end = forI[4].trim(), inc = forI[5];
      let rangeStr = '';
      const step = inc.includes('--') || inc.includes('-=') ? '-1' : (inc.match(/\+=\s*(\d+)/) ? inc.match(/\+=\s*(\d+)/)[1] : '1');
      const endExpr = op === '<=' ? `${end} + 1` : end;
      rangeStr = start === '0' ? `range(${endExpr})` : `range(${start}, ${endExpr}${step !== '1' ? ', ' + step : ''})`;
      out.push(`${ind(indentLevel)}for ${v} in ${rangeStr}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // For-each
    const forEach = trimmed.match(/^for\s*\(\s*(?:\w[\w<>]*)\s+(\w+)\s*:\s*(\w+)\s*\)/);
    if (forEach) {
      out.push(`${ind(indentLevel)}for ${forEach[1]} in ${forEach[2]}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // While
    const whileM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (whileM) {
      out.push(`${ind(indentLevel)}while ${convertExprJavaToPy(whileM[1])}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // if / else if / else
    const ifM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (ifM) {
      out.push(`${ind(indentLevel)}if ${convertExprJavaToPy(ifM[1])}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }
    const elifM = trimmed.match(/^(?:\}\s*)?else\s+if\s*\((.+)\)\s*\{?$/);
    if (elifM) {
      out.push(`${ind(indentLevel)}elif ${convertExprJavaToPy(elifM[1])}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) {
      out.push(`${ind(indentLevel)}else:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // Return
    const ret = trimmed.match(/^return\s+(.*);$/);
    if (ret) { out.push(`${ind(indentLevel)}return ${convertExprJavaToPy(ret[1])}`); continue; }

    // Increment / decrement
    if (trimmed.match(/^\w+\+\+;$/)) { const v=trimmed.replace('++;',''); out.push(`${ind(indentLevel)}${v} += 1`); continue; }
    if (trimmed.match(/^\w+--;$/))   { const v=trimmed.replace('--;',''); out.push(`${ind(indentLevel)}${v} -= 1`); continue; }

    // Augmented assign
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);$/);
    if (augA) { out.push(`${ind(indentLevel)}${augA[1]} ${augA[2]} ${convertExprJavaToPy(augA[3])}`); continue; }

    // Assignment
    const assign = trimmed.match(/^(\w+)\s*=\s*(.+);$/);
    if (assign) { out.push(`${ind(indentLevel)}${assign[1]} = ${convertExprJavaToPy(assign[2])}`); continue; }

    // break / continue
    if (trimmed === 'break;') { out.push(`${ind(indentLevel)}break`); continue; }
    if (trimmed === 'continue;') { out.push(`${ind(indentLevel)}continue`); continue; }

    // Opening brace only
    if (trimmed === '{') { indentLevel++; continue; }

    // Fallback
    const stripped = trimmed.replace(/;$/, '');
    out.push(`${ind(indentLevel)}${convertExprJavaToPy(stripped)}`);
  }

  return cleanLines(out).join('\n');
}

function convertExprJavaToPy(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\bnull\b/g,'None');
  e = e.replace(/&&/g,'and').replace(/\|\|/g,'or').replace(/!/g,'not ');
  e = e.replace(/\.toUpperCase\(\)/g,'.upper()').replace(/\.toLowerCase\(\)/g,'.lower()');
  e = e.replace(/\.trim\(\)/g,'.strip()');
  e = e.replace(/\.add\(([^)]+)\)/g,'.append($1)');
  e = e.replace(/\.size\(\)/g,'.length').replace(/\.length\(\)/g,'.__len__()');
  e = e.replace(/Math\.pow\(([^,]+),\s*([^)]+)\)/g,'$1 ** $2');
  e = e.replace(/String\.valueOf\(([^)]+)\)/g,'str($1)');
  e = e.replace(/Integer\.parseInt\(([^)]+)\)/g,'int($1)');
  e = e.replace(/Double\.parseDouble\(([^)]+)\)/g,'float($1)');
  // Remove type casts like (int)
  e = e.replace(/\(int\)\s*/g,'int(').replace(/\(double\)\s*/g,'float(');
  // String.format → f-string (basic)
  e = e.replace(/String\.format\("([^"]+)"(?:,([^)]+))?\)/g, (_, fmt, args) => {
    let result = fmt.replace(/%[sd]/g, match => {
      return '{}';
    });
    return `f"${result}"`;
  });
  return e;
}

// ─── Java → C++ ───────────────────────────────────────────────────────────────

function javaToCpp(code) {
  const lines = code.split('\n');
  const out = [];
  out.push('#include <iostream>');
  out.push('#include <string>');
  out.push('#include <vector>');
  out.push('using namespace std;');
  out.push('');

  let i = 0;
  let inClass = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (/^(import|package)\s/.test(trimmed)) continue;
    if (trimmed === '') { out.push(''); continue; }

    // Comments
    if (trimmed.startsWith('//')) { out.push(`${indent}//${trimmed.slice(2)}`); continue; }

    // Class
    const classDef = trimmed.match(/^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classDef) {
      const parent = classDef[2] ? ` : public ${classDef[2]}` : '';
      out.push(`${indent}class ${classDef[1]}${parent} {`);
      out.push(`${indent}public:`);
      continue;
    }

    // main
    if (/public static void main\s*\(/.test(trimmed)) {
      out.push(`${indent}int main() {`);
      continue;
    }

    // Method signature
    const meth = trimmed.match(/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*(\w[\w<>\[\]]*)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (meth && !['if','while','for','switch'].includes(meth[2])) {
      const rtype = javaTypeToCpp(meth[1]);
      const fname = meth[2];
      const params = meth[3].split(',').filter(p=>p.trim()).map(p => {
        const pts = p.trim().split(/\s+/);
        if (pts.length >= 2) return `${javaTypeToCpp(pts[0])} ${pts[pts.length-1]}`;
        return p.trim();
      }).join(', ');
      out.push(`${indent}${rtype} ${fname}(${params}) {`);
      continue;
    }

    // Variable declaration
    const varD = trimmed.match(/^(?:int|double|float|long|String|boolean|char|var)\s+(\w+)\s*=\s*(.+);$/);
    if (varD) {
      const type = trimmed.split(/\s+/)[0];
      out.push(`${indent}${javaTypeToCpp(type)} ${varD[1]} = ${convertExprJavaToCpp(varD[2])};`);
      continue;
    }

    // println / print
    const pln = trimmed.match(/^System\.out\.println\((.*)\);$/);
    if (pln) { out.push(`${indent}cout << ${convertExprJavaToCpp(pln[1])} << endl;`); continue; }
    const prt = trimmed.match(/^System\.out\.print\((.*)\);$/);
    if (prt) { out.push(`${indent}cout << ${convertExprJavaToCpp(prt[1])};`); continue; }
    const prtf = trimmed.match(/^System\.out\.printf\((.*)\);$/);
    if (prtf) { out.push(`${indent}printf(${prtf[1]});`); continue; }

    // For i
    const forI = trimmed.match(/^for\s*\(\s*(?:int|var)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) {
      out.push(`${indent}for (int ${forI[1]} = ${forI[2].trim()}; ${forI[3].trim()}; ${forI[4].trim()}) {`);
      continue;
    }
    // For-each
    const forE = trimmed.match(/^for\s*\(\s*(\w[\w<>]*)\s+(\w+)\s*:\s*(\w+)\s*\)\s*\{?$/);
    if (forE) {
      out.push(`${indent}for (${javaTypeToCpp(forE[1])} ${forE[2]} : ${forE[3]}) {`);
      continue;
    }

    // While
    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${indent}while (${convertExprJavaToCpp(wM[1])}) {`); continue; }

    // if/else if/else
    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${indent}if (${convertExprJavaToCpp(iM[1])}) {`); continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${indent}} else if (${convertExprJavaToCpp(eiM[1])}) {`); continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${indent}} else {`); continue; }

    // Return / break / continue
    const retM = trimmed.match(/^return\s+(.*);$/);
    if (retM) { out.push(`${indent}return ${convertExprJavaToCpp(retM[1])};`); continue; }
    if (trimmed === 'return;') { out.push(`${indent}return;`); continue; }
    if (trimmed === 'break;') { out.push(`${indent}break;`); continue; }
    if (trimmed === 'continue;') { out.push(`${indent}continue;`); continue; }

    // Increment
    if (trimmed.match(/^\w+\+\+;$/)) { out.push(`${indent}${trimmed}`); continue; }
    if (trimmed.match(/^\w+--;$/))   { out.push(`${indent}${trimmed}`); continue; }

    // Braces
    if (trimmed === '{') { out.push(`${indent}{`); continue; }
    if (trimmed === '}' || trimmed === '};') { out.push(`${indent}}`); continue; }

    // main closing → add return 0
    // Augmented assign / generic statement
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);$/);
    if (augA) { out.push(`${indent}${augA[1]} ${augA[2]} ${convertExprJavaToCpp(augA[3])};`); continue; }

    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);$/);
    if (assn) { out.push(`${indent}${assn[1]} = ${convertExprJavaToCpp(assn[2])};`); continue; }

    out.push(`${indent}${convertExprJavaToCpp(trimmed)}`);
  }

  return cleanLines(out).join('\n');
}

function javaTypeToCpp(t) {
  const map = { int:'int', long:'long', double:'double', float:'float', boolean:'bool', String:'string', void:'void', char:'char' };
  return map[t] || t;
}

function convertExprJavaToCpp(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\bString\b/g,'string');
  e = e.replace(/\.toString\(\)/g,`/* toString */`);
  e = e.replace(/Math\.pow\(([^,]+),\s*([^)]+)\)/g,'pow($1, $2)');
  e = e.replace(/Math\.abs\(([^)]+)\)/g,'abs($1)');
  e = e.replace(/Math\.sqrt\(([^)]+)\)/g,'sqrt($1)');
  e = e.replace(/Math\.max\(([^)]+)\)/g,'max($1)');
  e = e.replace(/Math\.min\(([^)]+)\)/g,'min($1)');
  e = e.replace(/String\.valueOf\(([^)]+)\)/g,'to_string($1)');
  e = e.replace(/Integer\.parseInt\(([^)]+)\)/g,'stoi($1)');
  e = e.replace(/Double\.parseDouble\(([^)]+)\)/g,'stod($1)');
  e = e.replace(/\.toUpperCase\(\)/g, '/* .toUpperCase() — use transform */');
  e = e.replace(/\.toLowerCase\(\)/g, '/* .toLowerCase() — use transform */');
  e = e.replace(/\.equals\(([^)]+)\)/g,' == $1');
  e = e.replace(/\.length\(\)/g,'.length()');
  e = e.replace(/new ArrayList<.*?>\(\)/g,'vector<auto>()');
  return e;
}

// ─── Java → JavaScript ────────────────────────────────────────────────────────

function javaToJs(code) {
  const lines = code.split('\n');
  const out = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (/^(import|package)\s/.test(trimmed)) continue;
    if (trimmed === '') { out.push(''); continue; }

    if (trimmed.startsWith('//')) { out.push(`${indent}//${trimmed.slice(2)}`); continue; }

    // Class
    const classDef = trimmed.match(/^(?:public\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classDef) {
      const ext = classDef[2] ? ` extends ${classDef[2]}` : '';
      out.push(`${indent}class ${classDef[1]}${ext} {`);
      continue;
    }

    // main
    if (/public static void main\s*\(/.test(trimmed)) {
      out.push(`${indent}function main() {`);
      continue;
    }

    // Constructor
    const ctorM = trimmed.match(/^(?:public\s+)?(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (ctorM && ctorM[1] === ctorM[1] && /^[A-Z]/.test(ctorM[1])) {
      const params = ctorM[2].split(',').filter(p=>p.trim()).map(p => p.trim().split(/\s+/).pop()).join(', ');
      out.push(`${indent}constructor(${params}) {`);
      continue;
    }

    // Method
    const meth = trimmed.match(/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*(?:\w[\w<>\[\]]*)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (meth && !['if','while','for'].includes(meth[1])) {
      const fname = meth[1];
      const params = meth[2].split(',').filter(p=>p.trim()).map(p => p.trim().split(/\s+/).pop()).join(', ');
      const isMemberMethod = !trimmed.includes('static');
      out.push(`${indent}${isMemberMethod ? '' : 'function '}${fname}(${params}) {`);
      continue;
    }

    // Var decl
    const varD = trimmed.match(/^(?:int|double|float|long|String|boolean|char|var|final)\s+(\w+)\s*=\s*(.+);$/);
    if (varD) {
      const keyword = trimmed.startsWith('final') ? 'const' : 'let';
      out.push(`${indent}${keyword} ${varD[1]} = ${convertExprJavaToJs(varD[2])};`);
      continue;
    }

    // println
    const pln = trimmed.match(/^System\.out\.println\((.*)\);$/);
    if (pln) { out.push(`${indent}console.log(${convertExprJavaToJs(pln[1])});`); continue; }
    const prt = trimmed.match(/^System\.out\.print\((.*)\);$/);
    if (prt) { out.push(`${indent}process.stdout.write(${convertExprJavaToJs(prt[1])});`); continue; }

    // for i
    const forI = trimmed.match(/^for\s*\(\s*(?:int|var)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) { out.push(`${indent}for (let ${forI[1]} = ${forI[2].trim()}; ${forI[3].trim()}; ${forI[4].trim()}) {`); continue; }

    // for-each
    const forE = trimmed.match(/^for\s*\(\s*(?:\w[\w<>]*)\s+(\w+)\s*:\s*(\w+)\s*\)\s*\{?$/);
    if (forE) { out.push(`${indent}for (let ${forE[1]} of ${forE[2]}) {`); continue; }

    // while / if / else if / else
    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${indent}while (${convertExprJavaToJs(wM[1])}) {`); continue; }
    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${indent}if (${convertExprJavaToJs(iM[1])}) {`); continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${indent}} else if (${convertExprJavaToJs(eiM[1])}) {`); continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${indent}} else {`); continue; }

    // return
    const retM = trimmed.match(/^return\s+(.*);$/);
    if (retM) { out.push(`${indent}return ${convertExprJavaToJs(retM[1])};`); continue; }
    if (trimmed === 'return;') { out.push(`${indent}return;`); continue; }
    if (trimmed === 'break;')    { out.push(`${indent}break;`); continue; }
    if (trimmed === 'continue;') { out.push(`${indent}continue;`); continue; }

    if (trimmed === '{') { out.push(`${indent}{`); continue; }
    if (trimmed === '}' || trimmed === '};') { out.push(`${indent}}`); continue; }

    // augmented assign / plain
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=|\+\+|--)\s*(?:(.+))?;$/);
    if (augA) { out.push(`${indent}${trimmed}`); continue; }

    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);$/);
    if (assn) { out.push(`${indent}${assn[1]} = ${convertExprJavaToJs(assn[2])};`); continue; }

    out.push(`${indent}${convertExprJavaToJs(trimmed.replace(/;$/,''))};`);
  }

  // Append main call if main was defined
  if (code.includes('public static void main')) out.push('\nmain();');

  return cleanLines(out).join('\n');
}

function convertExprJavaToJs(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\bString\b/g,'').trim();
  e = e.replace(/Math\.pow\(([^,]+),\s*([^)]+)\)/g,'Math.pow($1, $2)');
  e = e.replace(/Math\.abs\(([^)]+)\)/g,'Math.abs($1)');
  e = e.replace(/Math\.sqrt\(([^)]+)\)/g,'Math.sqrt($1)');
  e = e.replace(/String\.valueOf\(([^)]+)\)/g,'String($1)');
  e = e.replace(/Integer\.parseInt\(([^)]+)\)/g,'parseInt($1)');
  e = e.replace(/Double\.parseDouble\(([^)]+)\)/g,'parseFloat($1)');
  e = e.replace(/\.equals\(([^)]+)\)/g,' === $1');
  e = e.replace(/\.length\(\)/g,'.length');
  e = e.replace(/new ArrayList<.*?>\(\)/g,'[]');
  e = e.replace(/\.add\(([^)]+)\)/g,'.push($1)');
  // Convert "a" + var + "b" to template literal
  if (e.includes('"') && e.includes('+')) {
    e = toTemplateLiteral(e);
  }
  return e;
}

// ─── C++ → Python ─────────────────────────────────────────────────────────────

function cppToPython(code) {
  const lines = code.split('\n');
  const out = [];
  let indentLevel = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') { out.push(''); continue; }
    if (trimmed.startsWith('#include') || trimmed.startsWith('using namespace')) continue;

    if (trimmed.startsWith('//')) { out.push(`${ind(indentLevel)}#${trimmed.slice(2)}`); continue; }

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\s*:\s*public\s+(\w+))?/);
    if (classDef) {
      const parent = classDef[2] ? `(${classDef[2]})` : '';
      out.push(`${ind(indentLevel)}class ${classDef[1]}${parent}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // public: / private: labels
    if (/^(public|private|protected):$/.test(trimmed)) continue;

    // main function
    if (/^int main\s*\(/.test(trimmed)) {
      out.push(`${ind(indentLevel)}def main():`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // Function definition
    const funcDef = trimmed.match(/^(\w[\w<>*]*)\s+(\w+)\s*\(([^)]*)\)\s*(?:const)?\s*\{?$/);
    if (funcDef && !['if','while','for'].includes(funcDef[2])) {
      const params = funcDef[3].split(',').filter(p=>p.trim()).map(p => {
        const ps = p.trim().split(/\s+/);
        return ps[ps.length-1].replace(/[*&]/g,'');
      }).filter(Boolean).join(', ');
      out.push(`${ind(indentLevel)}def ${funcDef[2]}(${params}):`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // cout
    const coutM = trimmed.match(/^cout\s*<<\s*(.*?)\s*(?:<<\s*endl)?\s*;$/);
    if (coutM) {
      const parts = coutM[1].split('<<').map(p=>p.trim()).filter(p=>p && p!=='endl');
      if (parts.length === 1) {
        out.push(`${ind(indentLevel)}print(${convertExprCppToPy(parts[0])})`);
      } else {
        const joined = parts.map(p=>convertExprCppToPy(p)).join(' + ');
        out.push(`${ind(indentLevel)}print(${joined})`);
      }
      continue;
    }

    // Variable declaration
    const varD = trimmed.match(/^(?:int|double|float|long|string|bool|auto|char)\s+(\w+)(?:\s*=\s*(.+))?;$/);
    if (varD) {
      const val = varD[2] ? convertExprCppToPy(varD[2]) : 'None';
      out.push(`${ind(indentLevel)}${varD[1]} = ${val}`);
      continue;
    }

    // for i
    const forI = trimmed.match(/^for\s*\(\s*(?:int|auto)\s+(\w+)\s*=\s*([^;]+);\s*\1\s*(<|<=|>|>=)\s*([^;]+);\s*\1(\+\+|--|\+=\s*\d+)\s*\)/);
    if (forI) {
      const rng = toPythonRange(`${forI[1]}=${forI[2]}`, `${forI[1]}${forI[3]}${forI[4]}`, forI[5]);
      if (rng) out.push(`${ind(indentLevel)}for ${rng.varName} in ${rng.range}:`);
      else out.push(`${ind(indentLevel)}# [manual review needed] for loop`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // for range-based
    const forRB = trimmed.match(/^for\s*\(\s*(?:auto|const\s+auto&?|int)\s+(\w+)\s*:\s*(\w+)\s*\)/);
    if (forRB) {
      out.push(`${ind(indentLevel)}for ${forRB[1]} in ${forRB[2]}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // while
    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${ind(indentLevel)}while ${convertExprCppToPy(wM[1])}:`); if (trimmed.endsWith('{')) indentLevel++; continue; }

    // if / else if / else
    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${ind(indentLevel)}if ${convertExprCppToPy(iM[1])}:`); if (trimmed.endsWith('{')) indentLevel++; continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${ind(indentLevel)}elif ${convertExprCppToPy(eiM[1])}:`); if (trimmed.endsWith('{')) indentLevel++; continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${ind(indentLevel)}else:`); if (trimmed.endsWith('{')) indentLevel++; continue; }

    // return
    const retM = trimmed.match(/^return\s+(.*);$/);
    if (retM && retM[1] !== '0') { out.push(`${ind(indentLevel)}return ${convertExprCppToPy(retM[1])}`); continue; }
    if (trimmed === 'return 0;' || trimmed === 'return;') continue;

    // Braces
    if (trimmed === '{') { indentLevel++; continue; }
    if (trimmed === '}' || trimmed === '};') { indentLevel = Math.max(0, indentLevel - 1); continue; }

    // break/continue
    if (trimmed === 'break;') { out.push(`${ind(indentLevel)}break`); continue; }
    if (trimmed === 'continue;') { out.push(`${ind(indentLevel)}continue`); continue; }

    // augmented assign
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);$/);
    if (augA) { out.push(`${ind(indentLevel)}${augA[1]} ${augA[2]} ${convertExprCppToPy(augA[3])}`); continue; }

    // i++ / i--
    if (/^\w+\+\+;$/.test(trimmed)) { out.push(`${ind(indentLevel)}${trimmed.replace('++;','')} += 1`); continue; }
    if (/^\w+--;$/.test(trimmed))   { out.push(`${ind(indentLevel)}${trimmed.replace('--;','')} -= 1`); continue; }

    // assign
    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);$/);
    if (assn) { out.push(`${ind(indentLevel)}${assn[1]} = ${convertExprCppToPy(assn[2])}`); continue; }

    out.push(`${ind(indentLevel)}${convertExprCppToPy(trimmed.replace(/;$/,''))}`);
  }

  return cleanLines(out).join('\n');
}

function convertExprCppToPy(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\bnullptr\b/g,'None');
  e = e.replace(/&&/g,'and').replace(/\|\|/g,'or').replace(/\b!\b/g,'not ');
  e = e.replace(/pow\(([^,]+),\s*([^)]+)\)/g,'$1 ** $2');
  e = e.replace(/to_string\(([^)]+)\)/g,'str($1)');
  e = e.replace(/stoi\(([^)]+)\)/g,'int($1)');
  e = e.replace(/stof\(([^)]+)\)/g,'float($1)');
  e = e.replace(/\.push_back\(([^)]+)\)/g,'.append($1)');
  e = e.replace(/\.size\(\)/g,'.__len__()');
  e = e.replace(/std::/g,'');
  e = e.replace(/endl/g,'');
  return e;
}

// ─── C++ → Java ───────────────────────────────────────────────────────────────

function cppToJava(code) {
  const lines = code.split('\n');
  const out = [];
  let className = 'Main';
  out.push(`public class ${className} {`);
  out.push('');

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (trimmed.startsWith('#include') || trimmed.startsWith('using namespace')) continue;
    if (trimmed === '') { out.push(''); continue; }

    if (trimmed.startsWith('//')) { out.push(`    ${indent}//${trimmed.slice(2)}`); continue; }

    // main
    if (/^int main\s*\(/.test(trimmed)) {
      out.push(`    ${indent}public static void main(String[] args) {`);
      continue;
    }

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\s*:\s*public\s+(\w+))?/);
    if (classDef) {
      const ext = classDef[2] ? ` extends ${classDef[2]}` : '';
      out.push(`    ${indent}public static class ${classDef[1]}${ext} {`);
      continue;
    }

    if (/^(public|private|protected):$/.test(trimmed)) continue;

    // Function
    const funcDef = trimmed.match(/^(\w[\w<>*]*)\s+(\w+)\s*\(([^)]*)\)\s*(?:const)?\s*\{?$/);
    if (funcDef && !['if','while','for'].includes(funcDef[2])) {
      const rtype = cppTypeToJava(funcDef[1]);
      const params = funcDef[3].split(',').filter(p=>p.trim()).map(p => {
        const ps = p.trim().split(/\s+/).filter(Boolean);
        if (ps.length >= 2) return `${cppTypeToJava(ps[0])} ${ps[ps.length-1].replace(/[*&]/g,'')}`;
        return p.trim();
      }).join(', ');
      out.push(`    ${indent}public static ${rtype} ${funcDef[2]}(${params}) {`);
      continue;
    }

    // Var decl
    const varD = trimmed.match(/^(?:int|double|float|string|bool|auto|char|long)\s+(\w+)(?:\s*=\s*(.+))?;$/);
    if (varD) {
      const type = cppTypeToJava(trimmed.split(/\s+/)[0]);
      const val = varD[2] ? convertExprCppToJava(varD[2]) : '';
      out.push(`    ${indent}${type} ${varD[1]}${val ? ' = ' + val : ''};`);
      continue;
    }

    // cout → System.out.println
    const coutM = trimmed.match(/^cout\s*<<\s*(.*?)\s*(?:<<\s*endl)?\s*;$/);
    if (coutM) {
      const parts = coutM[1].split('<<').map(p=>p.trim()).filter(p=>p && p!=='endl');
      const arg = parts.map(p=>convertExprCppToJava(p)).join(' + ');
      out.push(`    ${indent}System.out.println(${arg});`);
      continue;
    }

    // for
    const forI = trimmed.match(/^for\s*\(\s*(?:int|auto)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) { out.push(`    ${indent}for (int ${forI[1]} = ${forI[2].trim()}; ${forI[3].trim()}; ${forI[4].trim()}) {`); continue; }

    const forRB = trimmed.match(/^for\s*\(\s*(?:auto|const\s+auto&?|int)\s+(\w+)\s*:\s*(\w+)\s*\)\s*\{?$/);
    if (forRB) { out.push(`    ${indent}for (Object ${forRB[1]} : ${forRB[2]}) {`); continue; }

    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`    ${indent}while (${convertExprCppToJava(wM[1])}) {`); continue; }

    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`    ${indent}if (${convertExprCppToJava(iM[1])}) {`); continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`    ${indent}} else if (${convertExprCppToJava(eiM[1])}) {`); continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`    ${indent}} else {`); continue; }

    const retM = trimmed.match(/^return\s+(.*);$/);
    if (retM && retM[1] !== '0') { out.push(`    ${indent}return ${convertExprCppToJava(retM[1])};`); continue; }
    if (trimmed === 'return 0;' || trimmed === 'return;') continue;

    if (trimmed === '{') { out.push(`    ${indent}{`); continue; }
    if (trimmed === '}' || trimmed === '};') { out.push(`    ${indent}}`); continue; }

    if (trimmed === 'break;')    { out.push(`    ${indent}break;`); continue; }
    if (trimmed === 'continue;') { out.push(`    ${indent}continue;`); continue; }

    if (/^\w+\+\+;$/.test(trimmed)||/^\w+--;$/.test(trimmed)) { out.push(`    ${indent}${trimmed}`); continue; }

    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);$/);
    if (augA) { out.push(`    ${indent}${augA[1]} ${augA[2]} ${convertExprCppToJava(augA[3])};`); continue; }

    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);$/);
    if (assn) { out.push(`    ${indent}${assn[1]} = ${convertExprCppToJava(assn[2])};`); continue; }

    out.push(`    ${indent}${convertExprCppToJava(trimmed)}`);
  }

  out.push('}');
  return cleanLines(out).join('\n');
}

function cppTypeToJava(t) {
  const map = { int:'int', long:'long', double:'double', float:'float', bool:'boolean', string:'String', void:'void', char:'char', auto:'var' };
  return map[t] || t;
}

function convertExprCppToJava(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\btrue\b/g,'true').replace(/\bfalse\b/g,'false').replace(/\bnullptr\b/g,'null');
  e = e.replace(/pow\(([^,]+),\s*([^)]+)\)/g,'Math.pow($1, $2)');
  e = e.replace(/to_string\(([^)]+)\)/g,'String.valueOf($1)');
  e = e.replace(/stoi\(([^)]+)\)/g,'Integer.parseInt($1)');
  e = e.replace(/\.push_back\(([^)]+)\)/g,'.add($1)');
  e = e.replace(/\.size\(\)/g,'.size()');
  e = e.replace(/std::/g,'');
  e = e.replace(/endl/g,'""');
  return e;
}

// ─── C++ → JavaScript ─────────────────────────────────────────────────────────

function cppToJs(code) {
  const lines = code.split('\n');
  const out = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (trimmed.startsWith('#include') || trimmed.startsWith('using namespace')) continue;
    if (trimmed === '') { out.push(''); continue; }
    if (trimmed.startsWith('//')) { out.push(`${indent}//${trimmed.slice(2)}`); continue; }

    if (/^(public|private|protected):$/.test(trimmed)) continue;

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\s*:\s*public\s+(\w+))?/);
    if (classDef) {
      const ext = classDef[2] ? ` extends ${classDef[2]}` : '';
      out.push(`${indent}class ${classDef[1]}${ext} {`);
      continue;
    }

    // main
    if (/^int main\s*\(/.test(trimmed)) { out.push(`${indent}function main() {`); continue; }

    // Function
    const funcDef = trimmed.match(/^(\w[\w<>*]*)\s+(\w+)\s*\(([^)]*)\)\s*(?:const)?\s*\{?$/);
    if (funcDef && !['if','while','for'].includes(funcDef[2])) {
      const params = funcDef[3].split(',').filter(p=>p.trim()).map(p => {
        const ps = p.trim().split(/\s+/);
        return ps[ps.length-1].replace(/[*&]/g,'');
      }).filter(Boolean).join(', ');
      out.push(`${indent}function ${funcDef[2]}(${params}) {`);
      continue;
    }

    // Var decl
    const varD = trimmed.match(/^(?:int|double|float|string|bool|auto|char|long)\s+(\w+)(?:\s*=\s*(.+))?;$/);
    if (varD) {
      const val = varD[2] ? convertExprCppToJs(varD[2]) : 'undefined';
      out.push(`${indent}let ${varD[1]} = ${val};`);
      continue;
    }

    // cout
    const coutM = trimmed.match(/^cout\s*<<\s*(.*?)\s*(?:<<\s*endl)?\s*;$/);
    if (coutM) {
      const parts = coutM[1].split('<<').map(p=>p.trim()).filter(p=>p && p!=='endl');
      const arg = parts.length === 1 ? convertExprCppToJs(parts[0]) : toTemplateLiteral(parts.map(p=>convertExprCppToJs(p)).join(' + '));
      out.push(`${indent}console.log(${arg});`);
      continue;
    }

    // for i
    const forI = trimmed.match(/^for\s*\(\s*(?:int|auto)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) { out.push(`${indent}for (let ${forI[1]} = ${forI[2].trim()}; ${forI[3].trim()}; ${forI[4].trim()}) {`); continue; }

    const forRB = trimmed.match(/^for\s*\(\s*(?:auto|const\s+auto&?|int)\s+(\w+)\s*:\s*(\w+)\s*\)\s*\{?$/);
    if (forRB) { out.push(`${indent}for (let ${forRB[1]} of ${forRB[2]}) {`); continue; }

    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${indent}while (${convertExprCppToJs(wM[1])}) {`); continue; }

    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${indent}if (${convertExprCppToJs(iM[1])}) {`); continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${indent}} else if (${convertExprCppToJs(eiM[1])}) {`); continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${indent}} else {`); continue; }

    const retM = trimmed.match(/^return\s+(.*);$/);
    if (retM && retM[1] !== '0') { out.push(`${indent}return ${convertExprCppToJs(retM[1])};`); continue; }
    if (trimmed === 'return 0;' || trimmed === 'return;') continue;

    if (trimmed === '{') { out.push(`${indent}{`); continue; }
    if (trimmed === '}' || trimmed === '};') { out.push(`${indent}}`); continue; }
    if (trimmed === 'break;') { out.push(`${indent}break;`); continue; }
    if (trimmed === 'continue;') { out.push(`${indent}continue;`); continue; }

    if (/^\w+\+\+;$/.test(trimmed)||/^\w+--;$/.test(trimmed)) { out.push(`${indent}${trimmed}`); continue; }

    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);$/);
    if (augA) { out.push(`${indent}${augA[1]} ${augA[2]} ${convertExprCppToJs(augA[3])};`); continue; }

    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);$/);
    if (assn) { out.push(`${indent}${assn[1]} = ${convertExprCppToJs(assn[2])};`); continue; }

    out.push(`${indent}${convertExprCppToJs(trimmed.replace(/;$/,''))};`);
  }

  if (code.includes('int main')) out.push('\nmain();');
  return cleanLines(out).join('\n');
}

function convertExprCppToJs(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\btrue\b/g,'true').replace(/\bfalse\b/g,'false').replace(/\bnullptr\b/g,'null');
  e = e.replace(/pow\(([^,]+),\s*([^)]+)\)/g,'Math.pow($1, $2)');
  e = e.replace(/to_string\(([^)]+)\)/g,'String($1)');
  e = e.replace(/stoi\(([^)]+)\)/g,'parseInt($1)');
  e = e.replace(/\.push_back\(([^)]+)\)/g,'.push($1)');
  e = e.replace(/\.size\(\)/g,'.length');
  e = e.replace(/std::/g,'');
  e = e.replace(/endl/g,'""');
  return e;
}

// ─── JavaScript → Python ──────────────────────────────────────────────────────

function jsToPython(code) {
  const lines = code.split('\n');
  const out = [];
  let indentLevel = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === '') { out.push(''); continue; }
    if (trimmed.startsWith('//')) { out.push(`${ind(indentLevel)}#${trimmed.slice(2)}`); continue; }
    if (trimmed === 'use strict;' || trimmed === "'use strict';") continue;

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classDef) {
      const parent = classDef[2] ? `(${classDef[2]})` : '';
      out.push(`${ind(indentLevel)}class ${classDef[1]}${parent}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // constructor
    const ctorM = trimmed.match(/^constructor\s*\(([^)]*)\)\s*\{?$/);
    if (ctorM) {
      const params = parseJsParams(ctorM[1]);
      out.push(`${ind(indentLevel)}def __init__(self${params ? ', ' + params : ''}):`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // Method (inside class — no function keyword)
    const methDef = trimmed.match(/^(\w+)\s*\(([^)]*)\)\s*\{?$/) ;
    if (methDef && methDef[1] !== 'if' && methDef[1] !== 'while' && methDef[1] !== 'for' && methDef[1] !== 'catch') {
      const params = parseJsParams(methDef[2]);
      out.push(`${ind(indentLevel)}def ${methDef[1]}(self${params ? ', ' + params : ''}):`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // function declaration
    const funcDef = trimmed.match(/^(?:function|async function)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (funcDef) {
      const params = parseJsParams(funcDef[2]);
      out.push(`${ind(indentLevel)}def ${funcDef[1]}(${params}):`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // const/let/var arrow function
    const arrowDef = trimmed.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?([^)]*)\)?\s*=>\s*\{?(.*)$/);
    if (arrowDef) {
      const fname = arrowDef[1];
      const params = parseJsParams(arrowDef[2]);
      const body = arrowDef[3].trim();
      if (body && !trimmed.endsWith('{')) {
        out.push(`${ind(indentLevel)}def ${fname}(${params}):`);
        out.push(`${ind(indentLevel + 1)}return ${convertExprJsToPy(body.replace(/;$/,''))}`);
      } else {
        out.push(`${ind(indentLevel)}def ${fname}(${params}):`);
        if (trimmed.endsWith('{')) indentLevel++;
      }
      continue;
    }

    // console.log
    const logM = trimmed.match(/^console\.log\((.*)\);?$/);
    if (logM) {
      let arg = logM[1].trim();
      // Template literal → f-string
      const tlM = arg.match(/^`(.*)`$/s);
      if (tlM) {
        const fs = tlM[1].replace(/\$\{([^}]+)\}/g, '{$1}');
        out.push(`${ind(indentLevel)}print(f"${fs}")`);
      } else {
        out.push(`${ind(indentLevel)}print(${convertExprJsToPy(arg)})`);
      }
      if (checkNextDedent(lines, indentLevel)) { /* handled below */ }
      continue;
    }

    // for (let i = ...)
    const forI = trimmed.match(/^for\s*\(\s*(?:let|var|const)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) {
      const rng = toPythonRange(`${forI[1]}=${forI[2]}`, `${forI[3]}`, forI[4]);
      if (rng) out.push(`${ind(indentLevel)}for ${rng.varName} in ${rng.range}:`);
      else out.push(`${ind(indentLevel)}# [manual review needed] for loop`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // for (let x of arr)
    const forOf = trimmed.match(/^for\s*\(\s*(?:let|var|const)\s+(\w+)\s+of\s+(.+)\)\s*\{?$/);
    if (forOf) {
      out.push(`${ind(indentLevel)}for ${forOf[1]} in ${convertExprJsToPy(forOf[2])}:`);
      if (trimmed.endsWith('{')) indentLevel++;
      continue;
    }

    // while / if / else if / else
    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${ind(indentLevel)}while ${convertExprJsToPy(wM[1])}:`); if(trimmed.endsWith('{')) indentLevel++; continue; }
    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${ind(indentLevel)}if ${convertExprJsToPy(iM[1])}:`); if(trimmed.endsWith('{')) indentLevel++; continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${ind(indentLevel)}elif ${convertExprJsToPy(eiM[1])}:`); if(trimmed.endsWith('{')) indentLevel++; continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${ind(indentLevel)}else:`); if(trimmed.endsWith('{')) indentLevel++; continue; }

    // return
    const retM = trimmed.match(/^return\s+(.*);?$/);
    if (retM) { out.push(`${ind(indentLevel)}return ${convertExprJsToPy(retM[1].replace(/;$/,''))}`); continue; }

    // variable declaration
    const varD = trimmed.match(/^(?:let|const|var)\s+(\w+)\s*=\s*(.+);?$/);
    if (varD) {
      out.push(`${ind(indentLevel)}${varD[1]} = ${convertExprJsToPy(varD[2].replace(/;$/,''))}`);
      continue;
    }

    // augmented assign / i++ / i--
    if (trimmed.match(/^\w+\+\+;?$/)) { out.push(`${ind(indentLevel)}${trimmed.replace(/\+\+;?/,'')} += 1`); continue; }
    if (trimmed.match(/^\w+--;?$/))   { out.push(`${ind(indentLevel)}${trimmed.replace(/--;?/,'')} -= 1`); continue; }
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);?$/);
    if (augA) { out.push(`${ind(indentLevel)}${augA[1]} ${augA[2]} ${convertExprJsToPy(augA[3].replace(/;$/,''))}`); continue; }

    // assign
    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);?$/);
    if (assn && !trimmed.includes('==')) { out.push(`${ind(indentLevel)}${assn[1]} = ${convertExprJsToPy(assn[2].replace(/;$/,''))}`); continue; }

    // braces
    if (trimmed === '{') { indentLevel++; continue; }
    if (trimmed === '}' || trimmed === '};') { indentLevel = Math.max(0, indentLevel - 1); continue; }

    if (trimmed === 'break;' || trimmed === 'break') { out.push(`${ind(indentLevel)}break`); continue; }
    if (trimmed === 'continue;' || trimmed === 'continue') { out.push(`${ind(indentLevel)}continue`); continue; }

    out.push(`${ind(indentLevel)}${convertExprJsToPy(trimmed.replace(/;$/,''))}`);
  }

  return cleanLines(out).join('\n');
}

function parseJsParams(str) {
  return str.split(',').map(p => p.trim().replace(/\s*=\s*.+$/,'')).filter(Boolean).join(', ');
}

function checkNextDedent(lines, level) { return false; }

function convertExprJsToPy(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\bnull\b/g,'None').replace(/\bundefined\b/g,'None');
  e = e.replace(/&&/g,'and').replace(/\|\|/g,'or').replace(/(?<![!=<>])!(?!=)/g,'not ');
  e = e.replace(/===?/g,'==').replace(/!==?/g,'!=');
  e = e.replace(/Math\.pow\(([^,]+),\s*([^)]+)\)/g,'$1 ** $2');
  e = e.replace(/Math\.abs\(([^)]+)\)/g,'abs($1)');
  e = e.replace(/Math\.sqrt\(([^)]+)\)/g,'$1 ** 0.5');
  e = e.replace(/Math\.floor\(([^)]+)\)/g,'int($1)');
  e = e.replace(/Math\.ceil\(([^)]+)\)/g,'math.ceil($1)');
  e = e.replace(/\.push\(([^)]+)\)/g,'.append($1)');
  e = e.replace(/\.length\b/g,'.length /* use len() */');
  e = e.replace(/\.toUpperCase\(\)/g,'.upper()').replace(/\.toLowerCase\(\)/g,'.lower()');
  e = e.replace(/\.trim\(\)/g,'.strip()');
  e = e.replace(/parseInt\(([^)]+)\)/g,'int($1)');
  e = e.replace(/parseFloat\(([^)]+)\)/g,'float($1)');
  e = e.replace(/String\(([^)]+)\)/g,'str($1)');
  // template literal → f-string
  e = e.replace(/`([^`]*)`/g,(_, inner) => {
    const fs = inner.replace(/\$\{([^}]+)\}/g,'{$1}');
    return `f"${fs}"`;
  });
  return e;
}

// ─── JavaScript → Java ────────────────────────────────────────────────────────

function jsToJava(code) {
  const lines = code.split('\n');
  const out = [];
  out.push('public class Main {');
  out.push('');

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const indent = '    ' + indentOf(line);

    if (trimmed === '' || trimmed === 'use strict;' || trimmed === "'use strict';") { out.push(''); continue; }
    if (trimmed.startsWith('//')) { out.push(`${indent}//${trimmed.slice(2)}`); continue; }

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classDef) {
      const ext = classDef[2] ? ` extends ${classDef[2]}` : '';
      out.push(`${indent}public static class ${classDef[1]}${ext} {`);
      continue;
    }

    // constructor
    const ctorM = trimmed.match(/^constructor\s*\(([^)]*)\)\s*\{?$/);
    if (ctorM) {
      const params = ctorM[1].split(',').filter(p=>p.trim()).map(p=>`Object ${p.trim().replace(/\s*=.*$/,'')}`).join(', ');
      out.push(`${indent}public Main(${params}) {`);
      continue;
    }

    // function
    const funcDef = trimmed.match(/^(?:function|async function)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (funcDef) {
      const params = funcDef[2].split(',').filter(p=>p.trim()).map(p=>`Object ${p.trim().replace(/\s*=.*$/,'')}`).join(', ');
      out.push(`${indent}public static Object ${funcDef[1]}(${params}) {`);
      continue;
    }

    // arrow function
    const arrowDef = trimmed.match(/^(?:const|let|var)\s+(\w+)\s*=\s*\(?([^)]*)\)?\s*=>\s*\{?(.*)$/);
    if (arrowDef) {
      const params = arrowDef[2].split(',').filter(p=>p.trim()).map(p=>`Object ${p.trim()}`).join(', ');
      const body = arrowDef[3].trim();
      out.push(`${indent}public static Object ${arrowDef[1]}(${params}) {`);
      if (body && !trimmed.endsWith('{')) out.push(`${indent}    return ${convertExprJsToJava(body.replace(/;$/,''))};`);
      continue;
    }

    // console.log
    const logM = trimmed.match(/^console\.log\((.*)\);?$/);
    if (logM) {
      let arg = logM[1].trim();
      const tlM = arg.match(/^`(.*)`$/s);
      if (tlM) {
        const parts = [];
        tlM[1].replace(/([^$]+)|\$\{([^}]+)\}/g, (_, lit, expr) => {
          if (lit) parts.push(`"${lit}"`);
          else parts.push(expr);
        });
        arg = parts.join(' + ');
      } else {
        arg = convertExprJsToJava(arg);
      }
      out.push(`${indent}System.out.println(${arg});`);
      continue;
    }

    // for i / for of
    const forI = trimmed.match(/^for\s*\(\s*(?:let|var|const)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) { out.push(`${indent}for (int ${forI[1]} = ${forI[2].trim()}; ${forI[3].trim()}; ${forI[4].trim()}) {`); continue; }
    const forOf = trimmed.match(/^for\s*\(\s*(?:let|var|const)\s+(\w+)\s+of\s+(.+)\)\s*\{?$/);
    if (forOf) { out.push(`${indent}for (Object ${forOf[1]} : ${convertExprJsToJava(forOf[2])}) {`); continue; }

    // while / if / else if / else
    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${indent}while (${convertExprJsToJava(wM[1])}) {`); continue; }
    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${indent}if (${convertExprJsToJava(iM[1])}) {`); continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${indent}} else if (${convertExprJsToJava(eiM[1])}) {`); continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${indent}} else {`); continue; }

    // return
    const retM = trimmed.match(/^return\s+(.*);?$/);
    if (retM) { out.push(`${indent}return ${convertExprJsToJava(retM[1].replace(/;$/,''))};`); continue; }

    // variable
    const varD = trimmed.match(/^(?:let|var)\s+(\w+)\s*=\s*(.+);?$/);
    if (varD) { const type = inferType(varD[2],'java'); out.push(`${indent}${type === 'auto' ? 'Object' : type} ${varD[1]} = ${convertExprJsToJava(varD[2].replace(/;$/,''))};`); continue; }
    const constD = trimmed.match(/^const\s+(\w+)\s*=\s*(.+);?$/);
    if (constD) { const type = inferType(constD[2],'java'); out.push(`${indent}final ${type === 'auto' ? 'Object' : type} ${constD[1]} = ${convertExprJsToJava(constD[2].replace(/;$/,''))};`); continue; }

    // braces
    if (trimmed === '{') { out.push(`${indent}{`); continue; }
    if (trimmed === '}' || trimmed === '};') { out.push(`${indent}}`); continue; }
    if (trimmed === 'break;' || trimmed === 'break') { out.push(`${indent}break;`); continue; }
    if (trimmed === 'continue;' || trimmed === 'continue') { out.push(`${indent}continue;`); continue; }

    if (/^\w+\+\+;?$/.test(trimmed)) { out.push(`${indent}${trimmed.replace(/;?$/,';')}`); continue; }
    if (/^\w+--;?$/.test(trimmed))   { out.push(`${indent}${trimmed.replace(/;?$/,';')}`); continue; }
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);?$/);
    if (augA) { out.push(`${indent}${augA[1]} ${augA[2]} ${convertExprJsToJava(augA[3].replace(/;$/,''))};`); continue; }
    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);?$/) ;
    if (assn && !trimmed.includes('==')) { out.push(`${indent}${assn[1]} = ${convertExprJsToJava(assn[2].replace(/;$/,''))};`); continue; }

    out.push(`${indent}${convertExprJsToJava(trimmed.replace(/;?$/,''))};`);
  }

  out.push('}');
  return cleanLines(out).join('\n');
}

function convertExprJsToJava(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/===?/g,'==').replace(/!==?/g,'!=');
  e = e.replace(/\.push\(([^)]+)\)/g,'.add($1)');
  e = e.replace(/\.length\b/g,'.length()');
  e = e.replace(/parseInt\(([^)]+)\)/g,'Integer.parseInt($1)');
  e = e.replace(/parseFloat\(([^)]+)\)/g,'Double.parseDouble($1)');
  e = e.replace(/String\(([^)]+)\)/g,'String.valueOf($1)');
  e = e.replace(/`([^`]*)`/g,(_, inner) => {
    const parts = [];
    inner.replace(/([^$]+)|\$\{([^}]+)\}/g, (_m, lit, expr2) => {
      if (lit) parts.push(`"${lit}"`);
      else parts.push(expr2);
    });
    return parts.join(' + ');
  });
  return e;
}

// ─── JavaScript → C++ ─────────────────────────────────────────────────────────

function jsToCpp(code) {
  const lines = code.split('\n');
  const out = [];
  out.push('#include <iostream>');
  out.push('#include <string>');
  out.push('#include <vector>');
  out.push('using namespace std;');
  out.push('');

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (trimmed === '' || trimmed === 'use strict;' || trimmed === "'use strict';") { out.push(''); continue; }
    if (trimmed.startsWith('//')) { out.push(`${indent}//${trimmed.slice(2)}`); continue; }

    // Class
    const classDef = trimmed.match(/^class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classDef) {
      const ext = classDef[2] ? ` : public ${classDef[2]}` : '';
      out.push(`${indent}class ${classDef[1]}${ext} {`);
      out.push(`${indent}public:`);
      continue;
    }

    // constructor
    const ctorM = trimmed.match(/^constructor\s*\(([^)]*)\)\s*\{?$/);
    if (ctorM) {
      const params = ctorM[1].split(',').filter(p=>p.trim()).map(p=>`auto ${p.trim().replace(/\s*=.*/,'')}`).join(', ');
      out.push(`${indent}Main(${params}) {`);
      continue;
    }

    // function
    const funcDef = trimmed.match(/^(?:function|async function)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (funcDef) {
      const fname = funcDef[1];
      const params = funcDef[2].split(',').filter(p=>p.trim()).map(p=>`auto ${p.trim().replace(/\s*=.*/,'')}`).join(', ');
      out.push(`${indent}auto ${fname}(${params}) {`);
      continue;
    }

    // arrow function
    const arrowDef = trimmed.match(/^(?:const|let|var)\s+(\w+)\s*=\s*\(?([^)]*)\)?\s*=>\s*\{?(.*)$/);
    if (arrowDef) {
      const params = arrowDef[2].split(',').filter(p=>p.trim()).map(p=>`auto ${p.trim()}`).join(', ');
      out.push(`${indent}auto ${arrowDef[1]} = [&](${params}) {`);
      continue;
    }

    // console.log
    const logM = trimmed.match(/^console\.log\((.*)\);?$/);
    if (logM) {
      let arg = logM[1].trim();
      const tlM = arg.match(/^`(.*)`$/s);
      if (tlM) {
        const parts = [];
        tlM[1].replace(/([^$]+)|\$\{([^}]+)\}/g,(_m,lit,expr)=>{
          if (lit) parts.push(`"${lit}"`);
          else parts.push(convertExprJsToCpp(expr));
        });
        out.push(`${indent}cout << ${parts.join(' << ')} << endl;`);
      } else {
        out.push(`${indent}cout << ${convertExprJsToCpp(arg)} << endl;`);
      }
      continue;
    }

    // for i / for of
    const forI = trimmed.match(/^for\s*\(\s*(?:let|var|const)\s+(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*\{?$/);
    if (forI) { out.push(`${indent}for (int ${forI[1]} = ${forI[2].trim()}; ${forI[3].trim()}; ${forI[4].trim()}) {`); continue; }
    const forOf = trimmed.match(/^for\s*\(\s*(?:let|var|const)\s+(\w+)\s+of\s+(.+)\)\s*\{?$/);
    if (forOf) { out.push(`${indent}for (auto ${forOf[1]} : ${convertExprJsToCpp(forOf[2])}) {`); continue; }

    // while / if / else if / else
    const wM = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
    if (wM) { out.push(`${indent}while (${convertExprJsToCpp(wM[1])}) {`); continue; }
    const iM = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
    if (iM) { out.push(`${indent}if (${convertExprJsToCpp(iM[1])}) {`); continue; }
    const eiM = trimmed.match(/^(?:\}\s*)?else if\s*\((.+)\)\s*\{?$/);
    if (eiM) { out.push(`${indent}} else if (${convertExprJsToCpp(eiM[1])}) {`); continue; }
    if (/^(?:\}\s*)?else\s*\{?$/.test(trimmed)) { out.push(`${indent}} else {`); continue; }

    const retM = trimmed.match(/^return\s+(.*);?$/);
    if (retM) { out.push(`${indent}return ${convertExprJsToCpp(retM[1].replace(/;$/,''))};`); continue; }

    const varD = trimmed.match(/^(?:let|var)\s+(\w+)\s*=\s*(.+);?$/);
    if (varD) { out.push(`${indent}auto ${varD[1]} = ${convertExprJsToCpp(varD[2].replace(/;$/,''))};`); continue; }
    const constD = trimmed.match(/^const\s+(\w+)\s*=\s*(.+);?$/);
    if (constD) { out.push(`${indent}const auto ${constD[1]} = ${convertExprJsToCpp(constD[2].replace(/;$/,''))};`); continue; }

    if (trimmed === '{') { out.push(`${indent}{`); continue; }
    if (trimmed === '}' || trimmed === '};') { out.push(`${indent}}`); continue; }
    if (trimmed === 'break;' || trimmed === 'break') { out.push(`${indent}break;`); continue; }
    if (trimmed === 'continue;' || trimmed === 'continue') { out.push(`${indent}continue;`); continue; }

    if (/^\w+\+\+;?$/.test(trimmed)) { out.push(`${indent}${trimmed.replace(/;?$/,';')}`); continue; }
    if (/^\w+--;?$/.test(trimmed))   { out.push(`${indent}${trimmed.replace(/;?$/,';')}`); continue; }
    const augA = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+);?$/);
    if (augA) { out.push(`${indent}${augA[1]} ${augA[2]} ${convertExprJsToCpp(augA[3].replace(/;$/,''))};`); continue; }
    const assn = trimmed.match(/^(\w+)\s*=\s*(.+);?$/);
    if (assn && !trimmed.includes('==')) { out.push(`${indent}${assn[1]} = ${convertExprJsToCpp(assn[2].replace(/;$/,''))};`); continue; }

    out.push(`${indent}${convertExprJsToCpp(trimmed.replace(/;?$/,''))};`);
  }

  if (code.match(/\bfunction\s+main\b/) || code.match(/^function main/m)) out.push('\nmain();');
  return cleanLines(out).join('\n');
}

function convertExprJsToCpp(expr) {
  if (!expr) return '';
  let e = expr.trim();
  e = e.replace(/\btrue\b/g,'true').replace(/\bfalse\b/g,'false').replace(/\bnull\b/g,'nullptr').replace(/\bundefined\b/g,'nullptr');
  e = e.replace(/===?/g,'==').replace(/!==?/g,'!=');
  e = e.replace(/Math\.pow\(([^,]+),\s*([^)]+)\)/g,'pow($1, $2)');
  e = e.replace(/Math\.abs\(([^)]+)\)/g,'abs($1)');
  e = e.replace(/Math\.sqrt\(([^)]+)\)/g,'sqrt($1)');
  e = e.replace(/\.push\(([^)]+)\)/g,'.push_back($1)');
  e = e.replace(/\.length\b/g,'.size()');
  e = e.replace(/parseInt\(([^)]+)\)/g,'stoi($1)');
  e = e.replace(/parseFloat\(([^)]+)\)/g,'stof($1)');
  e = e.replace(/String\(([^)]+)\)/g,'to_string($1)');
  e = e.replace(/\.toUpperCase\(\)/g,'/* toUpperCase */');
  e = e.replace(/\.toLowerCase\(\)/g,'/* toLowerCase */');
  e = e.replace(/\.trim\(\)/g,'/* trim */');
  return e;
}

// ─── Dispatch table ───────────────────────────────────────────────────────────

const TRANSLATORS = {
  python_java:       pythonToJava,
  python_cpp:        pythonToCpp,
  python_javascript: pythonToJs,
  java_python:       javaToPickython,
  java_cpp:          javaToCpp,
  java_javascript:   javaToJs,
  cpp_python:        cppToPython,
  cpp_java:          cppToJava,
  cpp_javascript:    cppToJs,
  javascript_python: jsToPython,
  javascript_java:   jsToJava,
  javascript_cpp:    jsToCpp,
};

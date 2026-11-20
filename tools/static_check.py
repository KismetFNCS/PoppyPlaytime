"""Static checker for the single-file build. Usage: python3 tools/static_check.py index.html"""
import pathlib, re, shutil, subprocess, sys, tempfile

html = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
fails, notes = [], []

def need(cond, msg):
    if not cond:
        fails.append(msg)

text = html.strip()
need(text.startswith('<!DOCTYPE html>'), 'file does not start with <!DOCTYPE html>')
need(text.endswith('</html>'), 'file does not end with </html>')
for banned in ['TODO', 'FIXME', '// ...', '/* ... */', '// unchanged', '// rest of', 'coming soon', 'placeholder', '<!-- etc']:
    need(banned not in html, 'banned string: ' + banned)
need(not re.search(r'<script[^>]+src=', html), 'external script')
need(not re.search(r'<link[^>]+stylesheet', html), 'external stylesheet')
need(not re.search(r'''(src|href)=["']https?://|url\(\s*["']?https?://|@import''', html), 'external URL')

required = ['requestAnimationFrame', 'window.__TEST__', 'window.__TEST_FIDELITY__', 'function runAll',
            'function setState', 'function resetGame', 'LIGHTING CONTRACT', 'MATERIAL & TEXTURE CONTRACT',
            'SCALE & COMPOSITION CONTRACT', 'UI CONTRACT', 'FEEL TARGETS', 'REFERENCE ANCHORS',
            'DEPTH_TEST', 'COMPILE_STATUS', 'LINK_STATUS', 'webglcontextlost', 'experimental-webgl',
            'touch-action', 'overscroll-behavior', 'pointerdown', 'pointercancel', 'preventDefault',
            'localStorage', 'AudioContext', "'blur'"]
for token in required:
    need(token in html, 'missing: ' + token)

def body(name):
    m = re.search(r'\nfunction\s+' + name + r'\s*\([^)]*\)\s*\{', html)
    if not m:
        return None
    i, depth = m.end(), 1
    while i < len(html) and depth:
        depth += {'{': 1, '}': -1}.get(html[i], 0)
        i += 1
    return html[m.end():i - 1]

hot = [(r'console\.', 'console call'), (r'\bnew\s+\w', 'allocation with new'),
       (r'\.(map|filter|slice|concat)\(', 'array-allocating call'),
       (r'getImageData|texImage2D|querySelector|getElementById', 'upload or DOM lookup')]
for fn in ['update', 'render']:
    src = body(fn)
    need(src is not None, fn + '() not found')
    for pattern, why in hot if src else []:
        need(not re.search(pattern, src), why + ' inside ' + fn + '()')

need(not re.search(r'RampToValueAtTime\(\s*0(\.0+)?\s*,', html), 'exponential ramp to 0')
need('dt > 0.1' in html or 'Math.min(dt, 0.1)' in html or 'Math.min(0.1' in html, 'dt clamp not found')
assigns = re.findall(r'(?<![\w.])state\s*=(?!=)', html)
need(len(assigns) <= 2, 'state assigned in %d places; only its declaration and setState may' % len(assigns))

lines = html.splitlines()
for n, line in enumerate(lines, 1):
    if re.match(r'\s*//\s*Source:', line):
        need(re.search(r'\[(SAMPLED|ESTIMATED|ASSUMED)', line), 'untagged Source line %d' % n)
comment_hex = set(h.lower() for l in lines if l.strip().startswith('//') for h in re.findall(r'#[0-9a-fA-F]{6}\b', l))
code_hex = set(h.lower() for l in lines if not l.strip().startswith('//') for h in re.findall(r'#[0-9a-fA-F]{6}\b', l))
untraced = sorted(code_hex - comment_hex)
need(not untraced, 'hex colors not documented in a contract block: ' + ', '.join(untraced))
notes.append('%d lines, %d contract colors, %d sound calls' % (len(lines), len(comment_hex), len(re.findall(r"\bsfx\('", html))))

node = shutil.which('node')
for i, script in enumerate(re.findall(r'<script>([\s\S]*?)</script>', html)):
    if not node:
        notes.append('node not found: syntax check skipped')
        break
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(script)
    r = subprocess.run([node, '--check', f.name], capture_output=True, text=True)
    need(r.returncode == 0, 'syntax error in script block %d: %s' % (i, r.stderr.strip()[:400]))

print('\n'.join(['STATIC CHECK: ' + ('PASS' if not fails else '%d FAILURE(S)' % len(fails))] + ['  FAIL ' + f for f in fails] + ['  note ' + n for n in notes]))
sys.exit(1 if fails else 0)

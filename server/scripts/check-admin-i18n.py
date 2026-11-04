"""Lists panel text missing from admin/js/i18n-en.js. Run from the project root:
python server/scripts/check-admin-i18n.py
A value inserted by ${...} shows as {}. Technical strings may appear: ignore them."""
import glob
import json
import re

ATTR = re.compile(r'''(?:placeholder|title|aria-label|label)=["']([^"']*)["']''')
TAG = re.compile(r'<[^<>]*>')
SKIP = re.compile(r'^(&|\.|/|\.\./|#|\[|\?)|^[a-z]+\[|\.webp|\bdata-|:not\(|^[a-z-]+ [a-z.#-]+$|^[.a-z-]+,|\{\}/|/\{\}|^image/|^application/|^text/|^en-|^pt-|^Africa/|^[a-z]+=|^rgba|^(customer|trip)\.|^SHA-256')


def template(src, i, out):
    buf = []
    while i < len(src):
        c = src[i]
        if c == '\\':
            buf.append(src[i + 1])
            i += 2
        elif c == '`':
            return i + 1, ''.join(buf)
        elif src.startswith('${', i):
            i = scan(src, out, i + 2, True)
            buf.append('{}')
        else:
            buf.append(c)
            i += 1
    return i, ''.join(buf)


def scan(src, out, i=0, in_expr=False):
    depth = 0
    while i < len(src):
        c = src[i]
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = len(src) if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i)
            i = len(src) if j < 0 else j + 2
        elif c in '\'"':
            j, buf = i + 1, []
            while j < len(src) and src[j] != c and src[j] != '\n':
                if src[j] == '\\':
                    j += 1
                buf.append(src[j])
                j += 1
            out.append(''.join(buf))
            i = j + 1
        elif c == '`':
            i, text = template(src, i + 1, out)
            out.append(text)
        elif c == '/' and re.match(r'[=(,:!&|?{};\s]', src[i - 1] if i else ' ') and re.match(r'/[^/\s*]', src[i:i + 2]):
            m = re.match(r'/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\n\\])+/[a-z]*', src[i:])
            i += m.end() if m else 1
        else:
            if in_expr and c == '{':
                depth += 1
            elif in_expr and c == '}':
                if depth == 0:
                    return i + 1
                depth -= 1
            i += 1
    return i


def visible(lit):
    """(text, shown): text between tags is certainly on screen; a plain string may be code."""
    if '<' in lit and '>' in lit:
        return [(t, True) for t in ATTR.findall(lit) + TAG.split(lit)]
    return [(lit, '{}' in lit)]


def wanted(item):
    s, shown = item
    s = re.sub(r'\s+', ' ', s).strip()
    t = s.replace('{}', '').strip(' ·:-,.()/')
    if len(t) < 2 or not re.search(r'[A-Za-zÀ-ÿ]{2}', s) or SKIP.search(s):
        return None
    if re.search(r'[;{}]\s*$|=>|\bvar\(|bx-|https?:|\.js$|\.css$|\.html|^[A-Z_]+$|^\d', t):
        return None
    # Single lowercase words are often code, unless they sit in visible text
    if not shown and re.search(r'^[a-z_]+$|^[a-z]+[-_][a-z_-]+$|^[a-z]+([A-Z][a-z]+)+$', t):
        return None
    if re.search(r'^[a-z]+[-_][a-z_-]+$|^[a-z]+([A-Z][a-z]+)+$', t):
        return None
    if re.search(r'[<>]|\bclass=|\bstyle=|^[a-z-]+:\s|^\$|^\[|^:|\$\{|=\"', t):
        return None
    return s


strings = set()
for f in glob.glob('admin/js/*.js') + glob.glob('admin/js/views/*.js'):
    if f.replace('\\', '/').endswith(('i18n.js', 'i18n-en.js')):
        continue
    found = []
    scan(open(f, encoding='utf-8').read(), found)
    for lit in found:
        strings.update(filter(None, map(wanted, visible(lit))))
page = re.sub(r'<script.*?</script>|<style.*?</style>', '', open('admin/index.html', encoding='utf-8').read(), flags=re.S)
strings.update(filter(None, map(wanted, visible(page))))

text = open('admin/js/i18n-en.js', encoding='utf-8').read()
known = set(json.loads(text[text.index('export default') + 15:text.rindex('}') + 1]))
same = {'English', 'Português'}
missing = sorted(s for s in strings if s not in known and s not in same)
print('\n'.join(missing))
print(f'{len(known)} translated, {len(missing)} to check')

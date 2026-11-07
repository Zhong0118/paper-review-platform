"""Versioned official source files; business requests never fetch external websites."""
import csv
import hashlib
import json
import re
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parents[3] / 'data' / 'official'
FIELDS = ('code', 'name', 'province', 'city', 'authority', 'level', 'kind', 'source_version')


def convert_institutions(path: Path, kind: str) -> list[dict]:
    if path.stat().st_size > 5_000_000:
        raise ValueError('source is too large')
    if kind not in {'REGULAR', 'ADULT'}:
        raise ValueError('unknown institution kind')
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            if tuple(reader.fieldnames or ()) != FIELDS:
                raise ValueError('unexpected CSV headers')
            rows = list(reader)
    else:
        if path.suffix.lower() == '.xls':
            import xlrd
            book = xlrd.open_workbook(path)
            sheet = book.sheet_by_index(0)
            raw = [sheet.row_values(i) for i in range(sheet.nrows)]
        elif path.suffix.lower() == '.xlsx':
            from openpyxl import load_workbook
            book = load_workbook(path, read_only=True, data_only=False)
            try:
                raw = list(book.worksheets[0].values)
            finally:
                book.close()
        else:
            raise ValueError('expected CSV/XLS/XLSX')
        rows, province = [], ''
        if not any('学校标识码' in row for row in raw[:5]):
            raise ValueError('missing official headers')
        for row in raw:
            head = str(row[0] or '')
            area = re.fullmatch(r'(.+?)[（(]\d+所[）)]', head)
            if area:
                province = area[1]
            if not (isinstance(row[0], (int, float)) or head.isdigit()):
                continue
            code = str(int(row[2])) if isinstance(row[2], (int, float)) else str(row[2]).strip()
            rows.append(dict(zip(FIELDS, (code, str(row[1]).strip(), province,
                str(row[4]).strip() if kind == 'REGULAR' else '', str(row[3]).strip(),
                str(row[5]).strip() if kind == 'REGULAR' else '', kind, '2026'))))
    seen = set()
    for row in rows:
        if row['code'] in seen:
            raise ValueError('duplicate institution code')
        seen.add(row['code'])
        if not re.fullmatch(r'\d{10}', row['code']) or not row['name'] or not row['province'] or row['kind'] != kind:
            raise ValueError('invalid institution row')
        if any(not isinstance(v, str) or len(v) > 128 or v.startswith(('=', '+', '@')) for v in row.values()):
            raise ValueError('invalid cell')
    if not rows:
        raise ValueError('empty institution source')
    return rows


def convert_disciplines(path: Path) -> list[dict]:
    from pypdf import PdfReader
    content = '\n'.join(page.extract_text() for page in PdfReader(path).pages)
    rows, category, category_name = {}, '', ''
    for line in content.splitlines():
        group = re.fullmatch(r'(\d{2})\s+(.+)', line.strip())
        if group:
            category, category_name = group.groups()
        item = re.match(r'^(\d{4})\s+([^（*]+)', line.strip())
        if item:
            code, name = item.groups()
            rows[code] = dict(code=code, name=name.strip(), category_code=category,
                              category_name=category_name, kind='PROFESSIONAL' if int(code[2]) >= 5 else 'ACADEMIC', source_version='2022')
    # The official PDF embeds three professional categories in academic notes.
    for item in re.finditer(r'(?m)^(\d{4})\s+([^（\n]+)（([^）]+)）', content):
        codes = re.findall(r'代码为\s*(\d{4})', item[3])
        for code in codes:
            parent = rows[item[1]]
            rows[code] = {**parent, 'code': code, 'kind': 'PROFESSIONAL'}
    if len(rows) != 184:
        raise ValueError('2022 source must contain 184 categories including embedded codes')
    return sorted(rows.values(), key=lambda row: row['code'])


def official_bundle() -> dict:
    manifest = json.loads((SOURCE_DIR / 'manifest.json').read_text())
    for entry in manifest['files']:
        path = SOURCE_DIR / entry['file']
        if path.parent != SOURCE_DIR or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('official snapshot hash mismatch')
    with (SOURCE_DIR / 'disciplines-2022.csv').open(encoding='utf-8', newline='') as stream:
        disciplines = list(csv.DictReader(stream))
    institutions = []
    for name, kind in [('institutions-regular-2026.csv', 'REGULAR'), ('institutions-adult-2026.csv', 'ADULT')]:
        institutions.extend(convert_institutions(SOURCE_DIR / name, kind))
    if len({r['code'] for r in institutions}) != len(institutions):
        raise ValueError('duplicate institution code across sources')
    return {'disciplines': disciplines, 'institutions': institutions, 'sources': manifest['sources'],
            'snapshot': hashlib.sha256((SOURCE_DIR / 'manifest.json').read_bytes()).hexdigest()}

# -*- coding: utf-8 -*-
"""
把内置期刊库导出成站点用的查询数据：
  site/data/journals.json   前端查询用（数组格式，体积最小）
  site/data/journals.csv    供下载（Excel 可直接打开）

用法：
  python scripts/build-site-data.py --db scripts/jcr.db --medline scripts/J_Medline.txt

--db 只用于取学科类别（cat）；没有 jcr.db 时可以省略，cat 留空。
"""
import argparse
import csv
import io
import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'data', 'journal-if.js')
OUT_JSON = os.path.join(ROOT, 'site', 'data', 'journals.json')
OUT_CSV = os.path.join(ROOT, 'site', 'data', 'journals.csv')

ENTRY = re.compile(
    r'^\s*"([^"]+)"\s*:\s*\{\s*if\s*:\s*([0-9.]+)\s*,\s*q\s*:\s*"([^"]*)"\s*,'
    r'\s*name\s*:\s*"([^"]*)"\s*,\s*cn\s*:\s*(null|[1-4])\s*,\s*top\s*:\s*([01])\s*\}')


def normalize_key(raw):
    s = str(raw or '').lower().strip()
    s = re.sub(r'^[^a-z]+', '', s)
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = s.replace('.', '')
    return re.sub(r'\s+', ' ', s).strip()


def norm_issn(v):
    v = re.sub(r'[^0-9X]', '', str(v or '').upper())
    return v if re.fullmatch(r'[0-9X]{8}', v) else ''


def pretty_issn(raw):
    """8 位纯数字转 XXXX-XXXX，方便页面上照抄"""
    d = norm_issn(raw)
    if not d:
        return ''
    return '%s-%s' % (d[:4], d[4:])


def load_lib():
    out = []
    for line in io.open(LIB, encoding='utf-8'):
        m = ENTRY.match(line)
        if m:
            out.append({
                'key': m.group(1), 'if': float(m.group(2)), 'q': m.group(3),
                'name': m.group(4),
                'cn': None if m.group(5) == 'null' else int(m.group(5)),
                'top': int(m.group(6)),
            })
    return out


def load_nlm(path):
    """key(MedAbbr 归一化) -> (MedAbbr, 展示用 ISSN)"""
    idx, cur = {}, {}

    def flush(c):
        abbr = (c.get('MedAbbr') or '').strip()
        if not abbr:
            return
        k = normalize_key(abbr)
        if not k or k in idx:
            return
        p = ''
        for one in re.split(r'[,\s]+', (c.get('ISSN (Print)') or '').strip()):
            if norm_issn(one):
                p = pretty_issn(one)
                break
        if not p:
            for one in re.split(r'[,\s]+', (c.get('ISSN (Online)') or '').strip()):
                if norm_issn(one):
                    p = pretty_issn(one)
                    break
        idx[k] = (abbr, p)

    for line in io.open(path, encoding='utf-8', errors='replace'):
        line = line.rstrip('\n')
        if line.startswith('-----'):
            flush(cur)
            cur = {}
            continue
        if ': ' in line:
            k, v = line.split(': ', 1)
            cur[k.strip()] = v
    flush(cur)
    return idx


def load_categories(db):
    """ISSN -> 学科名（取该刊最优分区对应的那个学科）"""
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    cat = {}
    best = {}
    for r in con.execute('SELECT * FROM JCR2025'):
        ids = [norm_issn(r['ISSN']), norm_issn(r['EISSN'])]
        qs = []
        for i in range(1, 7):
            q = str(r['IF Quartile(2025)_%d' % i] or '').strip()
            sc = str(r['Category_%d' % i] or '').strip()
            if q in ('Q1', 'Q2', 'Q3', 'Q4') and sc:
                qs.append((q, sc))
        if not qs:
            continue
        bq = sorted(qs)[0]
        for i in ids:
            if i and (i not in best or bq < best[i]):
                best[i] = bq
                cat[i] = bq[1]
    con.close()
    return cat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--medline', default=os.path.join(ROOT, 'scripts', 'J_Medline.txt'))
    ap.add_argument('--db')
    args = ap.parse_args()

    if not os.path.exists(args.medline):
        sys.exit('找不到 NLM 期刊表：%s' % args.medline)

    lib = load_lib()
    nlm = load_nlm(args.medline)
    cat = load_categories(args.db) if args.db and os.path.exists(args.db) else {}
    if not cat:
        print('未提供 --db，学科类别留空')

    rows = []
    for e in lib:
        abbr, issn = nlm.get(e['key'], ('', ''))
        c = cat.get(norm_issn(issn), '') if issn else ''
        rows.append([e['key'], abbr, e['name'], issn, e['if'], e['q'],
                     e['cn'], e['top'], c])

    rows.sort(key=lambda r: (-r[4], r[2].lower()))

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    text = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
    io.open(OUT_JSON, 'w', encoding='utf-8', newline='\n').write(text)
    print('写入 %s（%.1f KB，%d 条）'
          % (OUT_JSON, len(text.encode('utf-8')) / 1024.0, len(rows)))

    with io.open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['缩写键', 'PubMed缩写', '期刊全称', 'ISSN', '影响因子',
                    'JCR分区', '中科院大类', '中科院Top', '学科类别'])
        for r in rows:
            w.writerow([r[0], r[1], r[2], r[3], '%g' % r[4], r[5],
                        '' if r[6] is None else r[6],
                        '是' if r[7] else '', r[8]])
    print('写入 %s（%.1f KB）'
          % (OUT_CSV, os.path.getsize(OUT_CSV) / 1024.0))

    miss_issn = sum(1 for r in rows if not r[3])
    miss_cat = sum(1 for r in rows if not r[8])
    print('无 ISSN：%d 条 · 无学科类别：%d 条' % (miss_issn, miss_cat))


if __name__ == '__main__':
    main()

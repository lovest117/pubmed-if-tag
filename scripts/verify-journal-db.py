# -*- coding: utf-8 -*-
"""
校验 data/journal-if.js 与数据源是否逐条一致。

两种数据源都支持：
  1) jcr.db（ShowJCR 发行包，含 JCR2025 / FQBJCR2025）
       python scripts/verify-journal-db.py --db scripts/jcr.db --medline scripts/J_Medline.txt
  2) 两份 Excel（不需要 jcr.db，适合拿到新的年度表时先交叉核对）
       python scripts/verify-journal-db.py ^
         --jcr-xlsx "2026年度JCR期刊名单（完整版）.xlsx" ^
         --cas-xlsx "2025中科院期刊分区表excel完整版.xlsx" ^
         --medline scripts/J_Medline.txt

判定：
  值不一致（IF / JCR 分区 / 中科院分区 / Top）→ 报错并列出，退出码 1
  仅库有 → 同名同刊视作兼容别名（正常），无同名的单独统计
"""
import argparse
import csv
import io
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'journal-if.js')
Q_ORDER = {'Q1': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4}

SMALL = {'of', 'and', 'the', 'for', 'in', 'on', 'at', 'to', 'by', 'as', 'or',
         'with', 'from', 'a', 'an', 'into', 'upon', 'via', 'vs'}
ACRONYMS = {
    'DNA', 'RNA', 'MRNA', 'SIRNA', 'MIRNA', 'LNCRNA', 'AIDS', 'HIV', 'HBV', 'HCV', 'HPV',
    'BMJ', 'JAMA', 'PNAS', 'EMBO', 'JCI', 'JNCI', 'JACC', 'JCO', 'CCR', 'CML', 'CLL',
    'AML', 'ALL', 'EGFR', 'HER2', 'BRAF', 'KRAS',
    'PLOS', 'PLoS', 'IEEE', 'ACS', 'MDPI', 'BMC', 'NPG', 'SSRN', 'MMWR', 'CDC', 'NIH',
    'NCI', 'FDA', 'WHO', 'NMR',
}

ENTRY = re.compile(
    r'^\s*"([^"]+)"\s*:\s*\{\s*if\s*:\s*([0-9.]+)\s*,\s*q\s*:\s*"([^"]*)"\s*,'
    r'\s*name\s*:\s*"([^"]*)"\s*,\s*cn\s*:\s*(null|[1-4])\s*,\s*top\s*:\s*([01])\s*\}')


def normalize_key(raw):
    s = str(raw or '').lower().strip()
    s = re.sub(r'^[^a-z]+', '', s)
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = s.replace('.', '')
    return re.sub(r'\s+', ' ', s).strip()


def normalize_name(raw):
    s = str(raw or '').lower().strip()
    s = s.replace('&amp;', 'and').replace('&', 'and')
    return re.sub(r'[^a-z0-9]+', '', s)


def norm_issn(v):
    v = re.sub(r'[^0-9X]', '', str(v or '').upper())
    return v if re.fullmatch(r'[0-9X]{8}', v) else ''


def parse_if(v):
    s = str(v or '').strip().replace('<', '').replace('>', '').replace(',', '')
    if not s or s.upper() in ('N/A', 'NA', '-'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def titlecase(s):
    def cap(w):
        return w[0].upper() + w[1:].lower() if w else w

    parts = [p for p in re.split(r'\s+', str(s or '').strip()) if p]
    out = []
    for i, w in enumerate(parts):
        if '-' in w:
            out.append('-'.join(cap(x) for x in w.split('-') if x))
            continue
        core = re.sub(r'[^A-Za-z]', '', w)
        low = core.lower()
        if i > 0 and low in SMALL:
            out.append(low)
        elif core.upper() in ACRONYMS:
            out.append(w)
        else:
            out.append(cap(w))
    return ' '.join(out)


def load_nlm(path):
    nlm, cur = {}, {}

    def flush(c):
        if c.get('MedAbbr') and c.get('JournalTitle'):
            rec = (c['MedAbbr'].strip(), c['JournalTitle'].strip())
            for field in ('ISSN (Print)', 'ISSN (Online)'):
                for one in re.split(r'[,\s]+', c.get(field, '').strip()):
                    i = norm_issn(one)
                    if i:
                        nlm.setdefault(i, rec)

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
    return nlm


def load_db(path):
    out = {}
    for line in io.open(path, encoding='utf-8'):
        m = ENTRY.match(line)
        if m:
            out[m.group(1)] = {
                'if': float(m.group(2)), 'q': m.group(3), 'name': m.group(4),
                'cn': None if m.group(5) == 'null' else int(m.group(5)),
                'top': int(m.group(6)),
            }
    return out


def build_from_db(db, nlm):
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    fqb, fqb_name = {}, {}
    for r in con.execute('SELECT * FROM FQBJCR2025'):
        m = re.match(r'([1-4])', str(r['大类分区'] or '').strip())
        rec = {'cn': int(m.group(1)) if m else None,
               'top': 1 if str(r['Top'] or '').strip() == '是' else 0}
        fqb_name.setdefault(normalize_name(r['Journal']), []).append(rec)
        for one in re.split(r'/', str(r['ISSN/EISSN'] or '')):
            i = norm_issn(one)
            if i:
                fqb.setdefault(i, rec)

    out = {}
    for r in con.execute('SELECT * FROM JCR2025'):
        issn, eissn = norm_issn(r['ISSN']), norm_issn(r['EISSN'])
        rec = nlm.get(issn) or nlm.get(eissn)
        if not rec:
            continue
        key = normalize_key(rec[0])
        if not key or len(key) > 60 or '"' in key:
            continue
        jif = parse_if(r['IF(2025)'])
        if jif is None:
            continue
        qs = [str(r['IF Quartile(2025)_%d' % i] or '').strip() for i in range(1, 7)]
        qs = [x for x in qs if x in Q_ORDER]
        q = sorted(qs)[0] if qs else ''
        f = fqb.get(issn) or fqb.get(eissn)
        if not f:
            hits = fqb_name.get(normalize_name(r['Journal']), [])
            if len(hits) == 1:
                f = hits[0]
        item = {'if': jif, 'q': q, 'name': titlecase(r['Journal']) or rec[1],
                'cn': (f or {}).get('cn'), 'top': (f or {}).get('top', 0)}
        if key in out and out[key]['if'] >= jif:
            continue
        out[key] = item
    con.close()
    return out


def build_from_xlsx(jcr_xlsx, cas_xlsx, nlm):
    from openpyxl import load_workbook
    cas, cas_raw = {}, {}
    wb = load_workbook(cas_xlsx, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    # 中科院表：第 2 行表头，Journal / 分区 / Top 在 6-8 列
    for row in ws.iter_rows(min_row=3, values_only=True):
        if len(row) < 8 or not row[5]:
            continue
        m = re.match(r'([1-4])', str(row[6] or '').strip())
        rec = (int(m.group(1)) if m else None,
               1 if str(row[7] or '').strip() == '是' else 0)
        cas.setdefault(normalize_name(row[5]), []).append(rec)
        cas_raw[str(row[5]).strip()] = rec
    wb.close()

    out = {}
    wb = load_workbook(jcr_xlsx, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if len(row) < 9 or not row[1]:
            continue
        issn, eissn = norm_issn(row[3]), norm_issn(row[4])
        rec = nlm.get(issn) or nlm.get(eissn)
        if not rec:
            continue
        key = normalize_key(rec[0])
        if not key or len(key) > 60 or '"' in key:
            continue
        jif = parse_if(row[7])
        if jif is None:
            continue
        q = str(row[8] or '').strip().upper()
        q = q if q in Q_ORDER else ''
        hits = cas.get(normalize_name(row[1]), [])
        c = hits[0] if len(hits) == 1 else cas_raw.get(str(row[1]).strip(), (None, 0))
        item = {'if': jif, 'q': q, 'name': titlecase(row[1]), 'cn': c[0], 'top': c[1]}
        if key in out and out[key]['if'] >= jif:
            continue
        out[key] = item
    wb.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--jcr-xlsx')
    ap.add_argument('--cas-xlsx')
    ap.add_argument('--medline', default=os.path.join(ROOT, 'scripts', 'J_Medline.txt'))
    ap.add_argument('--out', default=DB_PATH)
    args = ap.parse_args()

    if not os.path.exists(args.out):
        sys.exit('找不到库文件：%s' % args.out)
    if not os.path.exists(args.medline):
        sys.exit('找不到 NLM 期刊表：%s' % args.medline)

    nlm = load_nlm(args.medline)
    if args.db:
        expect = build_from_db(args.db, nlm)
        src = 'jcr.db'
    elif args.jcr_xlsx and args.cas_xlsx:
        expect = build_from_xlsx(args.jcr_xlsx, args.cas_xlsx, nlm)
        src = 'Excel'
    else:
        sys.exit('指定 --db，或同时指定 --jcr-xlsx 与 --cas-xlsx')

    cur = load_db(args.out)
    print('库 %s：%d 条 · 由 %s 重建：%d 条' % (os.path.basename(args.out), len(cur), src, len(expect)))

    names = {normalize_name(v['name']) for v in expect.values()}
    missing = [k for k in cur if k not in expect]
    alias = [k for k in missing if normalize_name(cur[k]['name']) in names]
    orphan = [k for k in missing if k not in alias]
    value_diff = [(k, cur[k], expect[k]) for k in cur if k in expect and cur[k] != expect[k]]
    by_field = {'if': 0, 'q': 0, 'cn': 0, 'top': 0}
    for _, a, b in value_diff:
        for f in by_field:
            if a[f] != b[f]:
                by_field[f] += 1

    print('仅库有：%d（其中同名同刊的兼容别名 %d，无同名 %d）· 仅源有：%d · 值不一致：%d'
          % (len(missing), len(alias), len(orphan), len([k for k in expect if k not in cur]), len(value_diff)))
    if value_diff:
        print('  差异字段分布：%s' % by_field)
    for rec in value_diff[:20]:
        print('  值不一致 %s：库 %s / 源 %s' % (rec[0], rec[1], rec[2]))
    for k in orphan[:20]:
        print('  无同名条目 %s：%s' % (k, cur[k]))

    # 用 Excel 校验时，中科院表没有 ISSN，只能按刊名匹配，会比库少匹配一批刊；
    # 源侧 cn 为空而库有值，属于源信息不足，不算冲突。IF / JCR 分区必须严格一致，
    # 中科院侧只在双方都有值时才比对分区与 Top
    hard, soft = [], []
    for k, a, b in value_diff:
        bad = a['if'] != b['if'] or a['q'] != b['q']
        if a['cn'] is not None and b['cn'] is not None:
            bad = bad or a['cn'] != b['cn'] or a['top'] != b['top']
        (hard if bad else soft).append(k)
    ok = not hard if src == 'Excel' else not value_diff
    if soft:
        print('  其中 %d 条仅因源侧缺中科院分区（cn 空）而不同，按源信息不足处理' % len(soft))
    print('结论：' + ('库与数据源一致' if ok else '存在不一致，见上')
          + ('（Excel 模式：IF / JCR 分区严格比对，中科院分区仅比对双方都有值的条目）'
             if src == 'Excel' else ''))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

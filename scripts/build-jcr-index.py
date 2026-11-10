# -*- coding: utf-8 -*-
"""
生成反馈自动入库用的轻量索引：scripts/jcr_index.csv

为什么单独做一份：
    GitHub Action 收到反馈时要立刻知道这本刊的 IF 与分区，但 jcr.db 有 16 MB、
    NLM 表有 9 MB，都进了 gitignore，Action 里现下太慢。
    这份索引只保留「缩写键 / 全称 / IF / 分区」几列，随仓库提交。

范围：JCR 2025 全表中所有 Q1–Q4 期刊（不只 Q1–Q2），
      反馈命中 Q3/Q4 时也能如实回复分区，而不是报「查不到」。

用法（仓库根执行）：
    python scripts/build-jcr-index.py
"""
import argparse, csv, io, os, re, sqlite3, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEF_DB = os.path.join(ROOT, 'scripts', 'jcr.db')
DEF_NLM = os.path.join(ROOT, 'scripts', 'J_Medline.txt')
OUT = os.path.join(ROOT, 'scripts', 'jcr_index.csv')

SMALL = {'of', 'and', 'the', 'for', 'in', 'on', 'at', 'to', 'by', 'as', 'or',
         'with', 'from', 'a', 'an', 'into', 'upon', 'via', 'vs'}
ACRONYMS = {
    'DNA', 'RNA', 'MRNA', 'SIRNA', 'MIRNA', 'LNCRNA', 'AIDS', 'HIV', 'HBV', 'HCV', 'HPV',
    'BMJ', 'JAMA', 'PNAS', 'EMBO', 'JCI', 'JNCI', 'JACC', 'JCO', 'CCR', 'CML', 'CLL',
    'AML', 'ALL', 'EGFR', 'HER2', 'BRAF', 'KRAS',
    'PLOS', 'PLoS', 'IEEE', 'ACS', 'MDPI', 'BMC', 'NPG', 'SSRN', 'MMWR', 'CDC', 'NIH',
    'NCI', 'FDA', 'WHO', 'NMR',
}


def normalize_key(raw):
    s = str(raw or '').lower().strip()
    s = re.sub(r'^[^a-z]+', '', s)
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = s.replace('.', '')
    return re.sub(r'\s+', ' ', s).strip()


def norm_issn(v):
    v = re.sub(r'[^0-9X]', '', str(v or '').upper())
    return v if re.fullmatch(r'[0-9X]{8}', v) else ''


def parse_if(v):
    if v is None:
        return None
    s = str(v).strip().replace('<', '').replace('>', '').replace(',', '')
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=DEF_DB)
    ap.add_argument('--medline', default=DEF_NLM)
    args = ap.parse_args()

    for p in (args.db, args.medline):
        if not os.path.exists(p):
            sys.exit('缺少数据源：%s\n见 build-journal-db.py 开头的说明。' % p)

    # NLM：ISSN -> (缩写, 全称)
    nlm, cur = {}, {}
    def flush(c):
        if c.get('MedAbbr') and c.get('JournalTitle'):
            rec = (c['MedAbbr'].strip(), c['JournalTitle'].strip())
            for field in ('ISSN (Print)', 'ISSN (Online)'):
                for one in re.split(r'[,\s]+', c.get(field, '').strip()):
                    i = norm_issn(one)
                    if i:
                        nlm.setdefault(i, rec)
    for line in io.open(args.medline, encoding='utf-8', errors='replace'):
        line = line.rstrip('\n')
        if line.startswith('-----'):
            flush(cur); cur = {}; continue
        if ': ' in line:
            k, v = line.split(': ', 1)
            cur[k.strip()] = v
    flush(cur)

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row

    # 中科院分区
    fqb = {}
    for r in con.execute('SELECT "ISSN/EISSN", "大类分区", "Top" FROM FQBJCR2025'):
        m = re.match(r'([1-4])', str(r['大类分区'] or '').strip())
        rec = (int(m.group(1)) if m else '', 1 if str(r['Top'] or '').strip() == '是' else 0)
        for one in re.split(r'/', str(r['ISSN/EISSN'] or '')):
            i = norm_issn(one)
            if i:
                fqb.setdefault(i, rec)

    Q_ORDER = {'Q1': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4}
    seen = {}
    for r in con.execute('SELECT * FROM JCR2025'):
        issn, eissn = norm_issn(r['ISSN']), norm_issn(r['EISSN'])
        rec = nlm.get(issn) or nlm.get(eissn)
        if not rec:
            continue
        key = normalize_key(rec[0])
        if not key or len(key) > 60:
            continue
        jif = parse_if(r['IF(2025)'])
        if jif is None:
            continue
        qs = [str(r['IF Quartile(2025)_%d' % i] or '').strip() for i in range(1, 7)]
        qs = [x for x in qs if x in Q_ORDER]
        if not qs:
            continue
        best = sorted(qs)[0]
        f = fqb.get(issn) or fqb.get(eissn) or ('', 0)
        # 同一缩写命中多本刊时保留分区更好的
        if key in seen and Q_ORDER[seen[key][3]] <= Q_ORDER[best]:
            continue
        seen[key] = (rec[0], titlecase(r['Journal']) or rec[1], jif, best, f[0], f[1])
    con.close()

    # 现有库里的兼容别名也补进来：反馈命中时应回「库里已有」
    db_path = os.path.join(ROOT, 'data', 'journal-if.js')
    if os.path.exists(db_path):
        entry_re = re.compile(r'^\s*"([^"]+)"\s*:\s*\{\s*if\s*:\s*([0-9.]+)\s*,\s*q\s*:\s*"([^"]*)"\s*,\s*name\s*:\s*"([^"]*)"\s*,\s*cn\s*:\s*(null|[1-4])\s*,\s*top\s*:\s*([01])\s*\}\s*,?\s*$')
        added = 0
        for line in io.open(db_path, encoding='utf-8'):
            m = entry_re.match(line)
            if not m:
                continue
            key = m.group(1)
            if key in seen:
                continue
            seen[key] = (key, m.group(4), float(m.group(2)), m.group(3),
                         '' if m.group(5) == 'null' else int(m.group(5)),
                         int(m.group(6)))
            added += 1
        print('从现有库补入别名 %d 条' % added)

    rows = sorted(seen.items(), key=lambda kv: kv[0])
    with io.open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['key', 'abbr', 'name', 'if', 'q', 'cn', 'top'])
        for key, (abbr, name, jif, q, cn, top) in rows:
            w.writerow([key, abbr, name, '%g' % jif, q, cn, top])

    dist = {}
    for _, v in rows:
        dist[v[3]] = dist.get(v[3], 0) + 1
    print('写入 %s：%d 条，%.1f KB' % (OUT, len(rows), os.path.getsize(OUT) / 1024.0))
    print('分区分布：' + ' / '.join('%s %d' % (q, dist[q]) for q in sorted(dist)))


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
用 JCR 2025 + 中科院分区表 2025 + NLM 缩写表，重建 data/journal-if.js

用法（仓库根执行）：
    python scripts/build-journal-db.py

数据源（需先准备到 scripts/ 目录，已 gitignore）：
    1) jcr.db —— ShowJCR 发行包解出的 SQLite，含表 JCR2025 / FQBJCR2025
       https://github.com/hitfyd/ShowJCR/releases  （ShowJCR.7z，用 py7zr 解压）
    2) J_Medline.txt —— NLM 期刊表（含 MedAbbr 与 ISSN）
       curl -L -o scripts/J_Medline.txt https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt

收录口径：
    JCR 2025 全表中能在 NLM 表按 ISSN 查到 PubMed 缩写的期刊（即 PubMed 实际会出现的刊）。
    缩写键直接取 MedAbbr，与页面引用行完全一致；同时带出中科院 2025 大类分区与 Top 标记。
"""
import argparse, io, json, os, re, sqlite3, shutil, sys, tempfile, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEF_DB = os.path.join(ROOT, 'scripts', 'jcr.db')
DEF_NLM = os.path.join(ROOT, 'scripts', 'J_Medline.txt')
OUT = os.path.join(ROOT, 'data', 'journal-if.js')

SMALL = {'of', 'and', 'the', 'for', 'in', 'on', 'at', 'to', 'by', 'as', 'or',
         'with', 'from', 'a', 'an', 'into', 'upon', 'via', 'vs'}


def normalize_key(raw):
    """与 content.js 的 normalizeJournalName 保持一致"""
    s = str(raw or '').lower().strip()
    s = re.sub(r'^[^a-z]+', '', s)
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = s.replace('.', '')
    return re.sub(r'\s+', ' ', s).strip()


def normalize_name(raw):
    s = str(raw or '').lower().strip().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
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


ACRONYMS = {
    'DNA', 'RNA', 'MRNA', 'SIRNA', 'MIRNA', 'LNCRNA', 'AIDS', 'HIV', 'HBV', 'HCV', 'HPV',
    'BMJ', 'JAMA', 'PNAS', 'EMBO', 'JCI', 'JNCI', 'JACC', 'JCO', 'CCR', 'CML', 'CLL',
    'AML', 'ALL', 'EGFR', 'HER2', 'BRAF', 'KRAS',
    'PLOS', 'PLoS', 'IEEE', 'ACS', 'MDPI', 'BMC', 'NPG', 'SSRN', 'MMWR', 'CDC', 'NIH',
    'NCI', 'FDA', 'WHO', 'NMR',
}


def titlecase(s):
    """JCR 刊名为全大写，转成正常大小写；已知缩写词（DNA、JAMA 等）保持原样"""
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
    """ISSN -> (MedAbbr, JournalTitle)"""
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
            flush(cur); cur = {}; continue
        if ': ' in line:
            k, v = line.split(': ', 1)
            cur[k.strip()] = v
    flush(cur)
    return nlm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=DEF_DB)
    ap.add_argument('--medline', default=DEF_NLM)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    for p in (args.db, args.medline):
        if not os.path.exists(p):
            sys.exit('缺少数据源：%s\n见本脚本开头的下载说明。' % p)

    nlm = load_nlm(args.medline)
    print('NLM 期刊记录: %d' % len(nlm))

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row

    # ---------- 中科院分区表 2025 ----------
    fqb = {}
    for r in con.execute('SELECT * FROM FQBJCR2025'):
        ids = [norm_issn(x) for x in re.split(r'/', str(r['ISSN/EISSN'] or ''))]
        m = re.match(r'([1-4])', str(r['大类分区'] or '').strip())
        rec = {
            'cn': int(m.group(1)) if m else None,
            'top': 1 if str(r['Top'] or '').strip() == '是' else 0,
        }
        for i in ids:
            if i:
                fqb.setdefault(i, rec)
    print('中科院分区表 2025: %d 个 ISSN' % len(fqb))

    # ---------- JCR 2025 ----------
    new, conflicts = {}, []
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

        # 多学科时取最好分区
        qs = [str(r['IF Quartile(2025)_%d' % i] or '').strip() for i in range(1, 7)]
        qs = [x for x in qs if re.fullmatch(r'Q[1-4]', x)]
        q = sorted(qs)[0] if qs else ''

        f = fqb.get(issn) or fqb.get(eissn) or {}
        item = {
            'if': jif,
            'q': q,
            'name': titlecase(r['Journal']) or rec[1],
            'cn': f.get('cn'),
            'top': f.get('top', 0),
        }
        if key in new:
            conflicts.append((key, new[key]['name'], item['name']))
            if jif > new[key]['if']:
                new[key] = item
            continue
        new[key] = item
    con.close()

    # ---------- 继承旧库的兼容别名键 ----------
    inherited = 0
    if os.path.exists(args.out):
        old_src = io.open(args.out, encoding='utf-8').read()
        by_name = {}
        for k, v in new.items():
            by_name.setdefault(normalize_name(v['name']), k)
        old_keys = re.findall(r'"([^"]+)":\s*\{([^}]*)\}', old_src)
        for key, body in old_keys:
            nk = normalize_key(key)
            if nk in new:
                continue
            m = re.search(r'name:\s*"([^"]+)"', body)
            if not m:
                continue
            tgt = by_name.get(normalize_name(m.group(1)))
            if tgt:
                new[nk] = dict(new[tgt])   # 内联副本，避免二次跳转
                inherited += 1
        print('继承旧库别名键: %d（旧库共 %d 键）' % (inherited, len(old_keys)))

    print('JCR 命中: %d 条' % len(new))
    if conflicts:
        print('缩写冲突 %d 组（保留 IF 较高者）:' % len(conflicts))
        for c in conflicts[:5]:
            print('   ', c)

    # ---------- 写文件 ----------
    backup = os.path.join(tempfile.gettempdir(), 'pif-journal-if.bak')
    if os.path.exists(args.out):
        shutil.copyfile(args.out, backup)

    def num(v):
        if v is None:
            return 'null'
        return '%.10g' % v if isinstance(v, float) else str(v)

    lines = [
        '/**',
        ' * Pubmed IF Tag - 内置期刊数据库',
        ' * 数据来源：2025 Journal Citation Reports（JCR，2026-06-17 发布）',
        ' *           中国科学院文献情报中心《期刊分区表》2025 升级版（大类分区 / Top）',
        ' * 期刊缩写：NLM J_Medline 的 MedAbbr，与 PubMed 引用行一致',
        ' * 字段: { if: 影响因子, q: JCR分区, name: 期刊全称, cn: 中科院大类分区(1-4，无则 null), top: 中科院Top }',
        ' * 由 scripts/build-journal-db.py 生成，请勿手工编辑',
        ' */',
        'const JOURNAL_IF_DB = {',
    ]
    for k in sorted(new):
        v = new[k]
        lines.append('  "%s": { if: %s, q: "%s", name: "%s", cn: %s, top: %d },'
                     % (k.replace('"', "'"), num(v['if']), v['q'],
                        (v['name'] or k).replace('"', "'"), num(v['cn']), v['top']))
    lines += [
        '};',
        '',
        '// 暴露给 content script 使用',
        "if (typeof window !== 'undefined') {",
        '  window.JOURNAL_IF_DB = JOURNAL_IF_DB;',
        '}',
        '',
    ]
    text = '\n'.join(lines)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with io.open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

    qq = collections.Counter(v['q'] for v in new.values())
    cc = collections.Counter(v['cn'] for v in new.values())
    print('写入 %s（%.1f KB，%d 条）· 上版备份 %s'
          % (args.out, len(text.encode('utf-8')) / 1024.0, len(new), backup))
    print('JCR 分区:', dict(qq))
    print('中科院大类:', dict(cc))
    print('中科院 Top:', sum(1 for v in new.values() if v['top']))


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
生成反馈自动入库用的轻量索引：scripts/jcr_index.csv

为什么要单独做一份：
    GitHub Action 收到反馈时需要立刻知道这本期刊的 IF 与分区，但 JCR 全表
    有 3 MB、NLM 表有 9 MB，都进了 gitignore，Action 里现下太慢。
    这份索引只保留「PubMed 缩写 / 全称 / IF / 分区」四样，约 400 KB，随仓库提交。

范围：医学与生命科学学科的全部 Q1–Q4（不是只 Q1–Q2），
      因为反馈里出现 Q3/Q4 时要能明确回复「不在收录范围」，而不是报「查不到」。

用法（仓库根执行）：
    python scripts/build-jcr-index.py

数据源与 build-journal-db.py 相同，缺失时按那个脚本开头的命令下载。
"""
import io, csv, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JCR = os.path.join(ROOT, 'scripts', 'jcr_2023_wos.csv')
NLM = os.path.join(ROOT, 'scripts', 'J_Medline.txt')
OUT = os.path.join(ROOT, 'scripts', 'jcr_index.csv')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader

# 复用构建脚本里的学科表与规范化函数，避免两处口径漂移
builder = SourceFileLoader('builder', os.path.join(ROOT, 'scripts', 'build-journal-db.py'))


def load_builder():
    """只取常量与函数，不执行构建主体（构建主体在模块顶层，会写文件）"""
    src = io.open(builder.get_filename(), 'r', encoding='utf-8').read()
    head = src.split('# ---------- NLM')[0]
    ns = {'__file__': builder.get_filename(), '__name__': 'builder_head'}
    exec(compile(head, builder.get_filename(), 'exec'), ns)
    return ns


def main():
    for path in (JCR, NLM):
        if not os.path.exists(path):
            sys.exit('缺少数据源：%s\n见 build-journal-db.py 开头的下载命令。' % path)

    ns = load_builder()
    parse_tuple = ns['parse_tuple']
    normalize_key = ns['normalize_key']
    titlecase = ns['titlecase']
    MED = ns['MED_CATEGORIES']

    # ---------- NLM：ISSN -> (PubMed 缩写, 正式刊名) ----------
    nlm = {}
    cur = {}
    with io.open(NLM, 'r', encoding='utf-8', errors='replace', newline='') as f:
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('-------'):
                if cur.get('MedAbbr') and cur.get('JournalTitle'):
                    rec = (cur['MedAbbr'].strip(), cur['JournalTitle'].strip())
                    for field in ('ISSN (Print)', 'ISSN (Online)'):
                        for one in re.split(r'[,\s]+', cur.get(field, '').strip()):
                            if one:
                                nlm.setdefault(one.upper(), rec)
                cur = {}
                continue
            if ': ' in line:
                k, v = line.split(': ', 1)
                cur[k.strip()] = v

    Q_ORDER = {'Q1': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4}
    seen = {}
    with io.open(JCR, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            if not any(c.upper() in MED for c in parse_tuple(r['category'])):
                continue
            best = None
            for q in parse_tuple(r['jif_quartile']):
                q = q.upper().replace(' ', '')
                if q in Q_ORDER and (best is None or Q_ORDER[q] < Q_ORDER[best]):
                    best = q
            if not best:
                continue
            try:
                jif = float(r['impact_factor_2023'])
            except (TypeError, ValueError):
                continue
            if not any(e.upper() in ('SCIE', 'SSCI') for e in parse_tuple(r['edition'])):
                continue
            rec = None
            for iss in (r['issn'], r['e_issn']):
                if iss and nlm.get(iss.strip().upper()):
                    rec = nlm[iss.strip().upper()]
                    break
            if not rec:
                continue
            key = normalize_key(rec[0])
            if not key or len(key) > 60:
                continue
            # 同一缩写命中多本刊时保留分区更好的那本
            if key in seen and Q_ORDER[seen[key][3]] <= Q_ORDER[best]:
                continue
            seen[key] = (rec[0], titlecase(r['journal_name']) or rec[1], jif, best)

    # 现有库里有些条目来自早期手工积累（不在 JCR 索引里），也补进来：
    # 反馈命中它们时应回「库里已有」，而不是「查不到」
    db_path = os.path.join(ROOT, 'data', 'journal-if.js')
    if os.path.exists(db_path):
        entry_re = re.compile(
            r'^\s*"([^"]+)"\s*:\s*\{\s*if\s*:\s*([0-9.]+)\s*,\s*q\s*:\s*"([^"]*)"\s*,\s*name\s*:\s*"([^"]*)"\s*\}\s*,?\s*$')
        added_from_db = 0
        with io.open(db_path, 'r', encoding='utf-8') as f:
            for line in f:
                m = entry_re.match(line)
                if not m:
                    continue
                key = m.group(1)
                if key in seen:
                    continue
                seen[key] = (key, m.group(4), float(m.group(2)), m.group(3))
                added_from_db += 1
        print('从现有库补入 %d 条（手工积累、不在 JCR 索引里）' % added_from_db)


    rows = sorted(seen.items(), key=lambda kv: kv[0])
    with io.open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['key', 'abbr', 'name', 'if', 'q'])
        for key, (abbr, name, jif, q) in rows:
            w.writerow([key, abbr, name, '%g' % jif, q])
    size = os.path.getsize(OUT)
    dist = {}
    for _, (_, _, _, q) in rows:
        dist[q] = dist.get(q, 0) + 1
    print('写入 %s：%d 条，%.1f KB' % (OUT, len(rows), size / 1024.0))
    print('分区分布：' + ' / '.join('%s %d' % (q, dist[q]) for q in sorted(dist)))


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
用 JCR 2023 全表 + NLM 期刊缩写表，重建 data/journal-if.js

用法（仓库根执行）：
    python scripts/build-journal-db.py

数据源（首次使用需先下载到 scripts/ 目录，两个文件已 gitignore）：
    1) JCR 2023 全表（21,848 行，含 IF 与 JIF 分区）
       curl -L -H "Accept: application/vnd.github.raw" ^
         -o scripts/jcr_2023_wos.csv ^
         https://api.github.com/repos/vallenderlab/journalanalysis/contents/data/jcr_2023_wos.csv?ref=main
    2) NLM 期刊表（含 PubMed 缩写 MedAbbr 与 ISSN）
       curl -L -o scripts/J_Medline.txt https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt

收录口径：
    医学与生命科学学科（见 MED_CATEGORIES）中 JCR 分区为 Q1/Q2 的期刊，
    且需能在 NLM 表中查到 PubMed 缩写（否则页面上的缩写无法命中）。
    同一期刊属多个学科时取最好分区（与 LetPub 等工具一致）。
"""
import io, csv, re, ast, shutil, os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JCR = os.path.join(ROOT, 'scripts', 'jcr_2023_wos.csv')
NLM = os.path.join(ROOT, 'scripts', 'J_Medline.txt')
DB = os.path.join(ROOT, 'data', 'journal-if.js')


def parse_tuple(s):
    """JCR CSV 的多值列存成 Python 元组字符串，如 "('Q1', 'Q2')"，单值时为裸串"""
    s = (s or '').strip()
    if not s:
        return []
    if s.startswith('('):
        try:
            v = ast.literal_eval(s)
            return [str(x).strip() for x in (v if isinstance(v, tuple) else (v,))]
        except (ValueError, SyntaxError):
            return [x.strip().strip("'\"") for x in s.strip('()').split(',')]
    return [s.strip().strip("'\"")]


def normalize_key(raw):
    """与 content.js 的 normalizeJournalName 保持一致"""
    s = raw.lower().strip()
    s = re.sub(r'^[^a-z]+', '', s)
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = s.replace('.', '')
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


SMALL = {'of', 'and', 'the', 'for', 'in', 'on', 'at', 'to', 'by', 'as', 'or',
         'with', 'from', 'a', 'an', 'into', 'upon', 'via', 'vs'}


def titlecase(s):
    """JCR 刊名为全大写，转成正常大小写；短缩写（AIDS、DNA 等）保持大写"""
    def cap(w):
        return w[0].upper() + w[1:].lower() if w else w

    parts = [p for p in re.split(r'\s+', s.strip()) if p]
    out = []
    for i, w in enumerate(parts):
        if '-' in w:
            out.append('-'.join(cap(x) for x in w.split('-') if x))
            continue
        core = re.sub(r'[^A-Za-z]', '', w)
        if i > 0 and core.lower() in SMALL:
            out.append(core.lower())
        elif core.isupper() and 1 < len(core) <= 4:
            out.append(w)
        else:
            out.append(cap(w))
    return ' '.join(out)


MED_CATEGORIES = {x.strip().upper() for x in '''
MEDICINE, GENERAL & INTERNAL
MEDICINE, LEGAL
MEDICINE, RESEARCH & EXPERIMENTAL
CARDIAC & CARDIOVASCULAR SYSTEMS
CLINICAL NEUROLOGY
CRITICAL CARE MEDICINE
EMERGENCY MEDICINE
PRIMARY HEALTH CARE
DENTISTRY, ORAL SURGERY & MEDICINE
DERMATOLOGY
ENDOCRINOLOGY & METABOLISM
GASTROENTEROLOGY & HEPATOLOGY
GERIATRICS & GERONTOLOGY
HEMATOLOGY
IMMUNOLOGY
INFECTIOUS DISEASES
MEDICAL ETHICS
MEDICAL INFORMATICS
MEDICAL LABORATORY TECHNOLOGY
NEUROIMAGING
NEUROSCIENCES
NURSING
OBSTETRICS & GYNECOLOGY
ONCOLOGY
OPHTHALMOLOGY
ORTHOPEDICS
OTORHINOLARYNGOLOGY
PATHOLOGY
PEDIATRICS
PERIPHERAL VASCULAR DISEASE
PHARMACOLOGY & PHARMACY
PSYCHIATRY
PUBLIC, ENVIRONMENTAL & OCCUPATIONAL HEALTH
RADIOLOGY, NUCLEAR MEDICINE & MEDICAL IMAGING
REHABILITATION
RESPIRATORY SYSTEM
RHEUMATOLOGY
SURGERY
TOXICOLOGY
TRANSPLANTATION
TROPICAL MEDICINE
UROLOGY & NEPHROLOGY
ANESTHESIOLOGY
ANATOMY & MORPHOLOGY
BIOCHEMISTRY & MOLECULAR BIOLOGY
BIOPHYSICS
BIOTECHNOLOGY & APPLIED MICROBIOLOGY
CELL BIOLOGY
GENETICS & HEREDITY
MICROBIOLOGY
PHYSIOLOGY
VIROLOGY
SPORT SCIENCES
HEALTH CARE SCIENCES & SERVICES
HEALTH POLICY & SERVICES
SUBSTANCE ABUSE
PSYCHOLOGY, BIOLOGICAL
PSYCHOLOGY, CLINICAL
PSYCHOLOGY, DEVELOPMENTAL
CHEMISTRY, MEDICINAL
NUTRITION & DIETETICS
INTEGRATIVE & COMPLEMENTARY MEDICINE
ANDROLOGY
AUDIOLOGY & SPEECH-LANGUAGE PATHOLOGY
BEHAVIORAL SCIENCES
SOCIAL SCIENCES, BIOMEDICAL
ERGONOMICS
DEVELOPMENTAL BIOLOGY
REPRODUCTIVE BIOLOGY
BIOLOGY
MATHEMATICAL & COMPUTATIONAL BIOLOGY
MYCOLOGY
PARASITOLOGY
VETERINARY SCIENCES
MULTIDISCIPLINARY SCIENCES
'''.strip().split('\n')}

for path in (JCR, NLM):
    if not os.path.exists(path):
        sys.exit('缺少数据源：%s\n见本脚本开头的下载命令。' % path)

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

print('NLM 期刊记录: %d' % len(nlm))

# ---------- 现有库 ----------
ENTRY_RE = re.compile(
    r'^\s*"([^"]+)"\s*:\s*\{\s*if\s*:\s*([0-9.]+)\s*,\s*q\s*:\s*"([^"]*)"\s*,\s*name\s*:\s*"([^"]*)"\s*\}\s*,?\s*$')
old = {}
if os.path.exists(DB):
    with io.open(DB, 'r', encoding='utf-8') as f:
        for line in f:
            m = ENTRY_RE.match(line)
            if m:
                old[m.group(1)] = {'if': float(m.group(2)), 'q': m.group(3), 'name': m.group(4)}
print('现有库: %d 条' % len(old))

# ---------- JCR 过滤 ----------
Q_ORDER = {'Q1': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4}
new = {}
skip = {'cat': 0, 'q': 0, 'ed': 0, 'nlm': 0, 'bad': 0}
with io.open(JCR, encoding='utf-8-sig', newline='') as f:
    for r in csv.DictReader(f):
        if not any(c.upper() in MED_CATEGORIES for c in parse_tuple(r['category'])):
            skip['cat'] += 1
            continue
        best = None
        for q in parse_tuple(r['jif_quartile']):
            q = q.upper().replace(' ', '')
            if q in Q_ORDER and (best is None or Q_ORDER[q] < Q_ORDER[best]):
                best = q
        if best not in ('Q1', 'Q2'):
            skip['q'] += 1
            continue
        try:
            jif = float(r['impact_factor_2023'])
        except (TypeError, ValueError):
            skip['bad'] += 1
            continue
        if not any(e.upper() in ('SCIE', 'SSCI') for e in parse_tuple(r['edition'])):
            skip['ed'] += 1
            continue
        rec = None
        for iss in (r['issn'], r['e_issn']):
            if iss and nlm.get(iss.strip().upper()):
                rec = nlm[iss.strip().upper()]
                break
        if not rec:
            skip['nlm'] += 1
            continue
        key = normalize_key(rec[0])
        if not key or len(key) > 60 or '"' in key:
            continue
        if key in new and jif < new[key]['if']:
            continue
        new[key] = {'if': jif, 'q': best, 'name': titlecase(r['journal_name']) or rec[1]}

print('JCR 命中: %d 条（跳过：非医学类 %d / 非 Q1-Q2 %d / 非 SCIE %d / 无 NLM 缩写 %d / 数值异常 %d）'
      % (len(new), skip['cat'], skip['q'], skip['ed'], skip['nlm'], skip['bad']))

merged = dict(old)
pre_existing = [k for k in new if k in old]
changed = [k for k in pre_existing if (old[k]['if'], old[k]['q']) != (new[k]['if'], new[k]['q'])]
for k, v in new.items():
    merged[k] = v
print('JCR 条目中已在库内 %d 条（其中 %d 条数值有变）· 全新收录 %d 条 · 合计 %d 条'
      % (len(pre_existing), len(changed), len(new) - len(pre_existing), len(merged)))

# 备份到仓库外的临时目录，避免污染扩展目录（release.ps1 会校验打包文件清单）
backup = os.path.join(tempfile.gettempdir(), 'pif-journal-if.bak')
shutil.copyfile(DB, backup)

lines = [
    '/**',
    ' * Pubmed IF Tag - 内置期刊影响因子数据库',
    ' * 数据来源：2023 Journal Citation Reports (JCR，2024 年 6 月发布)',
    ' *   收录范围：医学与生命科学类学科 Q1-Q2 期刊（多学科时取最好分区）',
    ' *   键名：NLM J_Medline 的 PubMed 缩写（MedAbbr）规范化后的形式，与引用行一致',
    ' * 字段: { if: 影响因子, q: JCR分区(Q1-Q4), name: 期刊全称 }',
    ' * 由 scripts/build-journal-db.py 生成，请勿手工整理以免引入重复键',
    ' */',
    'const JOURNAL_IF_DB = {',
]
keys = sorted(merged.keys())
for i, k in enumerate(keys):
    v = merged[k]
    name = v['name'].replace('"', "'").strip() or k
    lines.append('  "%s": { if: %g, q: "%s", name: "%s" }%s'
                 % (k, v['if'], v['q'], name, ',' if i < len(keys) - 1 else ''))
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
with io.open(DB, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)
print('写入 %s（%.1f KB，%d 条）；上一版备份在 %s'
      % (DB, len(text.encode('utf-8')) / 1024.0, len(merged), backup))

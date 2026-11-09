#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从反馈 Issue 中取期刊名，自动查 IF 与分区并写入 data/journal-if.js

设计原则：只信用户给的「期刊名」这一个信息。
    IF 和分区一律用 scripts/jcr_index.csv 查表决定，用户填的一概不信，
    所以即使有人故意把 Q4 报成 Q1，也污染不了库里的数据。

支持三种输入：PubMed 缩写（Nat Commun）、带点/带括号的写法（J. Neurosci.）、期刊全称。

输出（写入 $GITHUB_OUTPUT 供 workflow 使用）：
    status  = added / exists / out_of_scope / miss
    key / name / if / q / abbr / matched / reason
"""
import csv
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, 'data', 'journal-if.js')
INDEX_PATH = os.path.join(ROOT, 'scripts', 'jcr_index.csv')


def normalize_key(raw):
    """与 content.js 的 normalizeJournalName 保持一致"""
    s = (raw or '').lower().strip()
    s = re.sub(r'^[^a-z]+', '', s)
    s = re.sub(r'\s*\([^)]*\)\s*$', '', s)
    s = s.replace('.', '')
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def pick_section(body, keywords):
    """按 '### 标题' 分段，取标题命中关键词那一节的第一个有效内容行"""
    parts = re.split(r'^###\s*', body, flags=re.M)
    for part in parts[1:]:
        head, _, rest = part.partition('\n')
        if not any(k in head for k in keywords):
            continue
        for line in rest.splitlines():
            s = line.strip()
            if not s:
                continue
            if s.startswith('<!--') or s.startswith('-') or s.startswith('（') or s.startswith('('):
                continue
            if s.startswith('_No response_'):
                continue
            return s
    return ''


def out(pairs):
    path = os.environ.get('GITHUB_OUTPUT')
    if not path:
        for k, v in pairs:
            print('%s=%s' % (k, v))
        return
    with open(path, 'a', encoding='utf-8') as fh:
        for k, v in pairs:
            fh.write('%s=%s\n' % (k, ''.join(str(v).splitlines())))


def done(status, reason='', **kw):
    pairs = [('status', status), ('reason', reason)]
    for k in ('key', 'name', 'q', 'abbr', 'matched'):
        pairs.append((k, kw.get(k, '')))
    pairs.append(('if', kw.get('ifv', '')))
    out(pairs)
    print('[%s] %s' % (status, reason or 'ok'))
    sys.exit(0)


def load_index():
    rows = {}
    with io.open(INDEX_PATH, 'r', encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f):
            rows[r['key']] = {
                'key': r['key'],
                'abbr': r['abbr'],
                'name': r['name'],
                'if': float(r['if']),
                'q': r['q'],
            }
    return rows


def match(raw, index):
    """依次尝试：缩写精确 / 全称 / 去空格 / 前缀包含"""
    k = normalize_key(raw)
    if not k:
        return None, ''

    if k in index:
        return index[k], 'abbr'

    low = ' '.join(raw.lower().split())
    for row in index.values():
        if row['name'].lower() == low:
            return row, 'name'

    k2 = k.replace(' ', '')
    for row in index.values():
        if row['key'].replace(' ', '') == k2:
            return row, 'abbr-nospace'

    if len(k) >= 5:
        for row in index.values():
            other = row['key']
            shorter = min(len(k), len(other))
            if shorter < 5 or shorter < max(len(k), len(other)) * 0.75:
                continue
            if k.startswith(other) or other.startswith(k):
                return row, 'fuzzy'
    return None, ''


def main():
    body = os.environ.get('ISSUE_BODY', '') or ''
    if not body.strip():
        done('miss', 'Issue 内容为空')

    raw = pick_section(body, ['期刊名称', '期刊缩写', '期刊名', 'journal', 'Journal'])
    if not raw:
        # 兜底：整篇里找第一行像期刊名的
        for line in body.splitlines():
            s = line.strip()
            if s and not s.startswith('###') and not s.startswith('-') and 3 <= len(s) <= 80:
                raw = s
                break
    raw = (raw or '').strip().lstrip('>').strip().rstrip('.')
    if not raw:
        done('miss', '没能从反馈里找到期刊名')
    if len(raw) > 100:
        done('miss', '期刊名过长')

    index = load_index()
    row, how = match(raw, index)
    if not row:
        done('miss', '期刊库里没有「%s」，需要人工核对（可能是新刊或缩写写法不同）' % raw, matched=raw)

    if row['q'] not in ('Q1', 'Q2'):
        done('out_of_scope',
             '「%s」是 %s，不在收录范围（库里只收 Q1–Q2，Q3/Q4 不显示标签）'
             % (row['name'], row['q']),
             key=row['key'], name=row['name'], q=row['q'], abbr=row['abbr'], matched=how)

    # 读库，判重
    with io.open(DB_PATH, 'r', encoding='utf-8') as fh:
        text = fh.read()
    if re.search(r'^\s*"' + re.escape(row['key']) + r'"\s*:', text, flags=re.M):
        done('exists', '库里已有「%s」（%s，IF %g）' % (row['name'], row['q'], row['if']),
             key=row['key'], name=row['name'], q=row['q'], abbr=row['abbr'], matched=how)

    display = (row['abbr'] or row['name']).replace('"', "'")
    entry = '  "%s": { if: %g, q: "%s", name: "%s" },\n' % (
        row['key'], row['if'], row['q'], row['name'].replace('"', "'"))

    idx = text.rfind('};')
    if idx == -1:
        done('miss', '数据文件结构异常，找不到对象结尾')
    head = text[:idx].rstrip()
    if not head.endswith(','):
        head += ','
    new_text = head + '\n' + entry + text[idx:]
    # 行尾保持 LF
    with io.open(DB_PATH, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(new_text)

    done('added', '已补录「%s」IF %g（%s）' % (row['name'], row['if'], row['q']),
         key=row['key'], name=row['name'], ifv=('%g' % row['if']), q=row['q'],
         abbr=display, matched=how)


if __name__ == '__main__':
    main()

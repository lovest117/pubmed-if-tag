#!/usr/bin/env python3
# 从 Issue 内容解析期刊信息，追加到 Pubmed-IF-Tag/data/journal-if.js
# 供 .github/workflows/auto-add-journal.yml 调用
import os
import re
import sys

DB_PATH = 'Pubmed-IF-Tag/data/journal-if.js'


def pick_section(body, keywords):
    """按 '### 标题' 分段，返回标题含关键词的那一节的第一个有效内容行"""
    parts = re.split(r'^###\s*', body, flags=re.M)
    for part in parts[1:]:
        head, _, rest = part.partition('\n')
        if not any(k in head for k in keywords):
            continue
        for line in rest.splitlines():
            s = line.strip()
            if not s:
                continue
            if s.startswith('<!--') or s.startswith('---'):
                continue
            if s.startswith('（') or s.startswith('('):
                continue
            return s
    return ''


def fail(reason):
    print('跳过：' + reason)
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as fh:
        fh.write('key=\n')
    sys.exit(0)


def main():
    body = os.environ.get('ISSUE_BODY', '') or ''
    if '###' not in body:
        fail('Issue 内容不是反馈模板格式')

    raw_name = pick_section(body, ['缩写', '期刊名'])
    raw_if = pick_section(body, ['影响因子', 'IF'])
    raw_q = pick_section(body, ['分区'])
    raw_link = pick_section(body, ['链接', 'PMID'])

    # 期刊缩写清洗
    name = raw_name.strip().lstrip('>').strip().rstrip('.')
    if not name or len(name) > 80:
        fail('期刊缩写缺失或过长')
    if '"' in name or '\n' in name:
        fail('期刊缩写含非法字符')

    # 影响因子清洗
    if_match = re.search(r'\d+(?:\.\d+)?', raw_if.replace(',', '.'))
    if not if_match:
        fail('影响因子不是数字')
    if_value = float(if_match.group())
    if if_value <= 0 or if_value > 300:
        fail('影响因子超出合理范围')

    # 分区清洗
    q_match = re.search(r'Q\s*([1-4])', raw_q.upper())
    if not q_match:
        fail('分区需为 Q1-Q4')
    q_value = 'Q' + q_match.group(1)

    key = ' '.join(name.lower().split())

    # 读库
    with open(DB_PATH, 'r', encoding='utf-8') as fh:
        text = fh.read()

    if re.search(r'^\s*"' + re.escape(key) + r'"\s*:', text, flags=re.M):
        fail('数据库中已存在该期刊（键 ' + key + '）')

    entry = '  "%s": { if: %s, q: "%s", name: "%s" },\n' % (
        key,
        ('%g' % if_value),
        q_value,
        name.replace('"', "'"),
    )

    # 插到对象最后一个 '};' 之前；最后一条若没有尾逗号需先补上
    idx = text.rfind('};')
    if idx == -1:
        fail('数据文件结构异常，找不到对象结尾')
    head = text[:idx].rstrip()
    if not head.endswith(','):
        head += ','
    new_text = head + '\n' + entry + text[idx:]

    with open(DB_PATH, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(new_text)

    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as fh:
        fh.write('key=%s\n' % key)
        fh.write('name=%s\n' % name)
        fh.write('if=%s\n' % ('%g' % if_value))
        fh.write('q=%s\n' % q_value)
        fh.write('link=%s\n' % raw_link.replace('\n', ' ')[:200])

    print('已补录：%s | IF %g | %s' % (name, if_value, q_value))


if __name__ == '__main__':
    main()

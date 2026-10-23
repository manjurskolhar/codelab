#!/usr/bin/env python3
"""Rebuild CodeLab's ICD-10-CM code book (public/icd10cm.json) from the CDC/NCHS Tabular List XML.

Download the ICD-10-CM "Tabular List" XML for the new fiscal year from the CDC (NCHS) ICD-10-CM files page,
unzip it, then run:
    python3 tools/build-codebook.py icd10cm_tabular_2027.xml "ICD-10-CM Tabular List, FY2027 (October 1, 2026)"
and restart the server. No other software is needed.
"""
import xml.etree.ElementTree as ET, json, sys, os
if len(sys.argv) < 3:
    sys.exit(__doc__)
src, label = sys.argv[1], sys.argv[2]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'icd10cm.json')
root = ET.parse(src).getroot()
NOTE_TAGS = {'inclusionTerm': 'inc', 'includes': 'incl', 'excludes1': 'x1', 'excludes2': 'x2', 'codeFirst': 'cf',
             'useAdditionalCode': 'ua', 'codeAlso': 'ca', 'notes': 'n', 'sevenChrNote': 's7n'}
nodes = []
def notes_of(el):
    o = {}
    for tag, key in NOTE_TAGS.items():
        for t in el.findall(tag):
            o.setdefault(key, []).extend([(x.text or '').strip() for x in t.findall('note')])
    s7 = el.find('sevenChrDef')
    if s7 is not None:
        o['s7'] = [[e.get('char'), (e.text or '').strip()] for e in s7.findall('extension')]
    return o
def walk(el, parent):
    n = {'c': el.findtext('name').strip(), 'd': el.findtext('desc').strip(), 'p': parent}
    n.update(notes_of(el))
    kids = el.findall('diag')
    if not kids: n['leaf'] = 1
    nodes.append(n)
    for k in kids: walk(k, n['c'])
for ch in root.findall('chapter'):
    cid = 'ch' + ch.findtext('name').strip()
    n = {'c': cid, 'd': ch.findtext('desc').strip(), 'p': None, 'k': 'ch'}; n.update(notes_of(ch)); nodes.append(n)
    for sec in ch.findall('section'):
        sid = 'sec:' + sec.get('id')
        s = {'c': sid, 'd': (sec.findtext('desc') or '').strip(), 'p': cid, 'k': 'sec'}; s.update(notes_of(sec)); nodes.append(s)
        for d in sec.findall('diag'): walk(d, sid)
json.dump({'version': label, 'nodes': nodes}, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'Wrote {out}: {len(nodes)} entries, {sum(1 for n in nodes if n.get("leaf"))} codes without subdivisions.')

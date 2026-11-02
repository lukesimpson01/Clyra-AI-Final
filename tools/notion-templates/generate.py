"""Turns the extracted Notion templates (out/*.json) into public/notes/js/template-notion-data.js.

Usage (from this folder, after run_all.py): python3 generate.py [out-dir] [target-file]
Keeps the 50 richest templates, tidies names, gives each a category and group, drops runs of empty paragraphs."""
import glob, json, os, re, sys
from collections import Counter

out_dir = sys.argv[1] if len(sys.argv) > 1 else 'out'
target = sys.argv[2] if len(sys.argv) > 2 else '../../public/notes/js/template-notion-data.js'

def flat(blocks):
    n = 0
    for b in blocks:
        n += 1 + flat(b.get('children', []))
        for c in b.get('columns', []) or []: n += flat(c)
    return n

def tidy(blocks):
    """Collapse runs of empty paragraphs, drop leading/trailing ones, and clean columns and children."""
    out = []
    for b in blocks:
        if b.get('type') == 'columns':
            b['columns'] = [tidy(c) for c in b['columns']]
            if not any(b['columns']): continue
        if b.get('children'): b['children'] = tidy(b['children'])
        if b.get('type') == 'callout' and not b.get('text') and not b.get('children'): continue
        empty = b.get('type') == 'text' and not b.get('text')
        if empty and (not out or (out[-1].get('type') == 'text' and not out[-1].get('text'))): continue
        out.append(b)
    while out and out[-1].get('type') == 'text' and not out[-1].get('text'): out.pop()
    return out

specs = []
for f in sorted(glob.glob(os.path.join(out_dir, '*.json'))):
    if f.endswith('_done.json'): continue
    s = json.load(open(f)); s['slug'] = os.path.basename(f)[:-5]; s['blocks'] = tidy(s['blocks']); specs.append(s)
# The 50 chosen from everything extracted: the strongest structure and the widest range of real uses.
# (match the start of the template's name in Notion's library, category, optional display name)
CURATED = [
    ("Business Model Canvas", "Work"), ("Sales Operation CRM", "Work", "Sales CRM"), ("Content Planner Marketing", "Work", "Content Planner"), ("Gantt Chart", "Work"),
    ("Candidate Pipeline Tracker", "Work"), ("Client Follow-Up Tracker", "Work"), ("Invoice Tracker", "Money"), ("Employee Leave", "Work", "Employee Leave Tracker"),
    ("Company Research Database", "Work"), ("Beta Tester Tracker", "Work"), ("Agency Client Portal", "Work", "Client Portal"), ("Media Project Planner", "Work"),
    ("Class Notes: Student Study", "Notes", "Class Notes"), ("Psychology Student Hub", "Study"), ("Thesis & Dissertation Planner", "Study"), ("Master's Application Dashboard", "Study", "Application Dashboard"),
    ("GPA Calculator & Grade Tracker", "Study", "GPA Calculator"), ("Exam Cram Dashboard", "Study"), ("Final Grade Calculator", "Study"), ("Flashcards", "Study"),
    ("My Student Hub", "Study", "Student Hub"), ("School Calendar", "Study"), ("Scholarship Application Tracker", "Study"), ("Glossary 2.0", "Notes", "Glossary"), ("Story Plot Outline", "Writing"),
    ("Personal Journal", "Personal"), ("Family Budget Planner", "Money"), ("1-3-5 Rule Daily Planner", "Planning", "Daily Planner"), ("Travel Planner All in 1", "Personal", "Travel Planner"),
    ("Plan Your Trip", "Personal", "Trip Planner"), ("Group Trip Planner", "Personal"), ("Savings Tracker & Finance Goals", "Money", "Savings Tracker"), ("Spending Tracker & Budget Planner", "Money", "Spending Tracker"),
    ("Budget Tracker: Monthly", "Money", "Budget Tracker"), ("2027 Life Planner", "Planning", "Life Planner"), ("Doctor Appointment Planner", "Personal"), ("Time Blocking + Weekly", "Planning", "Time Blocking Planner"),
    ("Quarterly Habits tracker", "Personal", "Habit Tracker"), ("Simple Habit Tracker", "Personal"), ("Affirmation & Gratitude Log", "Personal"), ("Savings Challenge", "Money"),
    ("Apartment Hunting & Moving", "Personal", "Moving Checklist"), ("75 Medium Challenge", "Personal"), ("Travel Packing List", "Personal"), ("Simple Daily Planner", "Planning"),
    ("Weekly Planner & To-do list", "Planning", "Weekly Planner"), ("Finance Tracker | Budget", "Money", "Finance Tracker"), ("Festival Organizer System", "Work", "Event Planner"),
    ("Calorie & Meal Tracker", "Personal"), ("Weekly Task Manager", "Planning"),
]
# A fitting emoji per template when the original has none that we can use (first keyword that matches wins).
EMOJI_BY_NAME = [('canvas', '🧩'), ('crm', '🤝'), ('content', '📅'), ('gantt', '📊'), ('candidate', '🧑‍💼'), ('follow-up', '📞'), ('invoice', '🧾'), ('leave', '🏖️'), ('company', '🔎'), ('beta', '🧪'),
                 ('client portal', '🗂️'), ('media', '🎬'), ('class notes', '📓'), ('psychology', '🧠'), ('thesis', '🎓'), ('application', '📮'), ('gpa', '🧮'), ('cram', '📚'), ('final grade', '💯'),
                 ('flashcards', '🃏'), ('student hub', '🏫'), ('school calendar', '🗓️'), ('scholarship', '🎖️'), ('glossary', '📖'), ('plot', '✍️'), ('journal', '📔'), ('family', '🏡'),
                 ('daily planner', '☀️'), ('travel planner', '✈️'), ('trip', '🧳'), ('savings challenge', '🐷'), ('savings', '🏦'), ('spending', '💳'), ('budget', '💰'), ('life planner', '🧭'),
                 ('doctor', '🩺'), ('time blocking', '⏱️'), ('habit', '✅'), ('gratitude', '🙏'), ('moving', '📦'), ('challenge', '💪'), ('packing', '🎒'), ('weekly planner', '🗓️'),
                 ('finance', '📈'), ('event', '🎪'), ('calorie', '🥗'), ('task manager', '☑️')]
def emoji_for(name, cat):
    n = name.lower()
    for key, value in EMOJI_BY_NAME:
        if key in n: return value
    return EMOJI[cat]

GROUP = {'Notes': 'School', 'Study': 'School', 'Writing': 'School', 'Work': 'Work', 'Planning': 'Life', 'Money': 'Life', 'Personal': 'Life'}
EMOJI = {'Notes': '📝', 'Study': '🎓', 'Work': '💼', 'Planning': '🗓️', 'Writing': '✍️', 'Money': '💰', 'Personal': '🌿'}

def clean_text(blocks):
    """Drop blocks that carry raw attachment ids or other leftovers of the source's images and files."""
    out = []
    for b in blocks:
        if 'attachment:' in (b.get('text') or '') or '‣' in (b.get('text') or ''): continue
        if b.get('children'): b['children'] = clean_text(b['children'])
        if b.get('columns'): b['columns'] = [clean_text(c) for c in b['columns']]
        out.append(b)
    return out

def real_emoji(value):
    return bool(value) and len(value) <= 8 and not re.search(r'[A-Za-z0-9/:_.\\-]', value)

result, used = [], set()
for entry in CURATED:
    match, cat = entry[0].lower(), entry[1]
    hits = [s for s in specs if s['source']['name'].strip().lower().startswith(match)]
    if not hits:
        print('NOT FOUND', entry[0]); continue
    s = max(hits, key=lambda s: flat(s['blocks']) + 10 * len(s['databases']))
    s['blocks'] = tidy(clean_text(s['blocks']))
    name = entry[2] if len(entry) > 2 else re.split(r'\s+[—–|:]\s+', s['source']['name'].strip())[0].strip()
    name = re.sub(r'^\d{4}\s+', '', name); name = name[0].upper() + name[1:]
    emoji = s.get('emoji') if real_emoji(s.get('emoji')) else emoji_for(name, cat)
    desc = re.split(r'(?<=[.!?])\s', s['source']['desc'].replace('\n', ' ').strip())[0][:130]
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'); base, i = slug, 2
    while slug in used: slug = f'{base}-{i}'; i += 1
    used.add(slug)
    result.append({'id': slug, 'name': name, 'emoji': emoji, 'category': cat, 'group': GROUP[cat], 'desc': desc, 'blocks': s['blocks'], 'databases': s['databases'], 'by': s['source'].get('made_by', 'community')})

header = ("/* The fifty most popular free templates in Notion's library, rebuilt for Clyra Notes.\n\n"
          "   Each was read from its public preview: the layout (columns, callouts, headings, checklists), the databases it embeds with\n"
          "   their properties, sample rows and views (table, board, gallery, list, calendar). Marketing copy and long prose were left out\n"
          "   and dates were moved to land around today. Generated by tools/notion-templates; do not edit by hand. */\n")
open(target, 'w').write(header + 'export const NOTION_TOP = ' + json.dumps(result, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(result), Counter(r['category'] for r in result))

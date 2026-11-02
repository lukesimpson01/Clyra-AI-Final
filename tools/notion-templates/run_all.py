import json,re,sys,traceback
from extract import clone
T=json.load(open('/tmp/notion_templates.json'))
by={re.sub(r'\s+',' ',t['name']).strip().lower():t for t in T}
WANT=["Weekly Planner","Simple Habit Tracker","Habit Tracker","Weekly Task Manager","Expense & Budget Tracker","Simple Expense Tracker","Weekly Schedule By Hours","YouTube Video Script Outline","NoFi - Personal Finance and Budgeting","University Planner","Simple University Homepage","Uni hub","School Calendar","School Notes","Exam Planner","Final Grade Calculator","Basic Daily Planner","Test Revision Planner","Pomodoro Tracker","Flashcards","Exam Cram Dashboard","Job Application Tracker","Assignment Tracker","Movie & TV Show Tracker","Garden Seed to Harvest Tracker","Story Plot Outline","Subscription Tracker & Analytics Dashboard","Cornell Notes","Lecture Note with Tabs","GPA Calculator & Grade Tracker","Thesis & Dissertation Planner","Club Member Database","Trip Planner: Itinerary, Budget","Travel Bucket List","Calorie & Meal Tracker","Recipe Book","Client Follow-Up Tracker","Invoice Tracker","Social media calendar","Blog Content Management","Gantt Chart","Simple Kanban Board","Scrum Board","New Hire Onboarding Checklist","People Directory","Candidate Pipeline Tracker","Sales Playbook","Business Model Canvas","Apartment Hunting & Moving Checklist","Pros and cons","Ultimate Weekly Journal","Savings Challenge","Scholarship Application Tracker","Simple Budget & Finance Tracker","Affirmation & Gratitude Log","Company Research Database","Employee Leave","Master's Application Dashboard"]
def find(w):
    k=w.lower()
    if k in by: return by[k]
    for n,t in by.items():
        if n.startswith(k): return t
    for n,t in by.items():
        if k in n: return t
    return None
done=[]
for w in WANT:
    t=find(w)
    if not t: print('MISSING',w,flush=True); continue
    try:
        spec,sc=clone(t['url'])
        spec['source']={'name':t['name'].strip(),'slug':t['slug'],'made_by':t['made_by'],'desc':t['desc'][:200]}
        json.dump(spec,open(f"out/{t['slug']}.json",'w'))
        print('OK',w,'|',spec['name'],'score',sc,'blocks',len(spec['blocks']),'dbs',len(spec['databases']),flush=True)
        done.append(t['slug'])
    except Exception as e:
        print('FAIL',w,repr(e)[:120],flush=True)
json.dump(done,open('out/_done.json','w'))

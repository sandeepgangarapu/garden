#!/usr/bin/env python3
"""One-time classic-page migration. Generated JSON is now the source of truth.
Edit data/plants.json and data/guides.json directly after migration; rerunning this
script replaces them. Uses only the Python standard library.
"""
import html
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / '_reference'
source = (REF / 'classic-garden.html').read_text()
data = json.loads((REF / 'data.json').read_text())

def plain(s):
    s = html.unescape(s)
    s = re.sub(r'''<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>''',
               lambda m: re.sub(r'<[^>]+>', '', m[2]) + ' (' + m[1] + ')', s, flags=re.I | re.S)
    return re.sub(r'</?[A-Za-z][^>]*>', '', s).strip()

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', plain(s).lower()).strip('-')

def js_rows(text):
    return [json.loads(re.sub(r'([{,])([a-zA-Z]+):', r'\1"\2":', line.strip().rstrip(',')))
            for line in text.splitlines() if line.strip()]

orn = js_rows((REF / 'orn_raw.txt').read_text())
ids = {p['id']: slug(re.sub(r'\s*\(.*', '', p['crop']).split('/')[0]) for p in data['plants']}
plants = []
for p in data['plants']:
    care_keys = [('Start method', 'startMethod'), ('Sow indoors', 'sowIndoor'), ('Plant out', 'transplantOut'),
                 ('Direct sow', 'directSow'), ('Harvest', 'harvestWindow'), ('Time to harvest', 'daysToHarvest'),
                 ('Spacing', 'spacing'), ('Water', 'waterNote'), ('Germination', 'germTempF'), ('Heat mat', 'heatMatNote')]
    plants.append(dict(id=ids[p['id']], name=plain(re.sub(r'\s*\(.*', '', p['crop'])),
        localName=plain((re.findall(r'\(([^)]*)\)', p['crop']) or [''])[0]), variety=plain(p['varieties']),
        kind='vegetable', life='overwinter' if ids[p['id']] in ('garlic', 'shallots') else 'annual',
        area='front' if p['yard'].startswith('Front') else 'back', category=plain(p['category']), sun=plain(p['sun']),
        timeline=p['timeline'], care=[dict(label=k, value=plain(p[v])) for k,v in care_keys if p.get(v) and not p[v].lower().startswith('n/a')],
        traits=[plain(t) for t in dict.fromkeys(p['traits'] + p['careFlags'])], ease=dict(start=p['easeStart'],grow=p['easeGrow']),
        heatMat=p['heatMat'], tip=plain(p['notes'])))
for p in orn:
    keys=[('Sun','sun'),('Soil / pH','soilPH'),('Water','water'),('Size','size'),('Bloom','bloomTime'),('Prune','prune'),('Feed','feed')]
    plants.append(dict(id=slug(p['name']),name=plain(p['name']),localName='',variety=plain(p['type']),kind='ornamental',life='perennial',
        area='ornamental', category=plain(p['zoneName']),sun=plain(p['sun']), timeline=p['timeline'],
        care=[dict(label=k,value=plain(p[v])) for k,v in keys if p.get(v) and p[v]!='n/a'],traits=[plain(t) for t in p['careFlags']],
        ease=None,heatMat=None,tip=plain(p['note'])))
# Same aliases and group mapping as split_chores.py, with its nine hand fixes.
alias={}
for p in data['plants']:
    base=re.sub(r'\s*\(.*','',p['crop']).strip()
    for name in [base]+re.findall(r'\(([^)]*)\)',p['crop']):
        for part in re.split(r'[/,]',name): alias[part.strip().lower()]=ids[p['id']]
alias.update({'pepper':'peppers','scallion':'bunching-onion','scallions':'bunching-onion','cilantro':'coriander','sunflower':'sunflowers',
 'pole bean':'pole-beans','bean':'pole-beans','beans':'pole-beans','pea':'peas','lauki':'bottlegourd','karela':'bitter-gourd','turai':'ridgegourd',
 'beets':'beet','carrots':'carrot','tomatoes':'tomato','marigolds':'marigold','roselle':'roselle','gongura':'roselle',
 'cucumbers':'cucumber','radishes':'radish','shallot':'shallots'})
groups={'gourds':['bottlegourd','ridgegourd','bitter-gourd'],'brassicas':['cabbage','cauliflower','kohlrabi'],
 'front heat-lovers':['eggplant','okra','peppers','tomatillo','tomato'],'heat-lovers':['eggplant','okra','peppers','tomatillo','tomato']}
fix={'Garlic scapes':['garlic'],'Sunflower heads':['sunflowers'],'Fall brassica transplants':['cabbage','cauliflower','kohlrabi'],
 'Fall greens seedlings':['lettuce','spinach','arugula','sorrel','coriander','fenugreek'],
 'Fall greens':['lettuce','spinach','arugula','sorrel','coriander','fenugreek'],
 'Overwinter crops':['spinach','bunching-onion','sorrel'],'Backyard':['area:back'],'New seedlings':['area:vegetables']}

def resolve(head):
    if head in fix: return fix[head]
    h=head.lower()
    yards={'front':'area:front','backyard':'area:back','both yards':'area:vegetables','front drip':'area:front','backyard drip':'area:back'}
    for k,v in yards.items():
        if h.startswith(k) and ('drip' in h or 'yards' in h or k=='front' and 'feeders' not in h and 'heat' not in h): return [v]
    found=[]
    for k,v in groups.items():
        if k in h: found+=v
    for t in re.split(r',|&|\band\b|\(|\)|;',h):
        t=re.sub(r'\b(seedlings?|spring|fall|crop|front|backyard|heavy feeders|starts?)\b','',t).strip()
        pid=alias.get(t) or alias.get(t.rstrip('s'))
        if pid: found.append(pid)
    return list(dict.fromkeys(found))

TYPES={'Start seeds indoors (heat mat)':'start','Direct sow / succession sow':'sow','Harden off & transplant out':'plant',
 'Watering':'water','Feed & mulch':'feed','Trellis / train / prune / pollinate':'train','Slug & pest patrol':'pests',
 'Harvest':'harvest','Soil prep / cover crop / cleanup':'soil'}
tasks=[]
unmapped=[]
used=Counter()
months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
def add(month,typ,ps,lead,text):
    if not ps: unmapped.append((month,lead,text)); return
    # IDs derive only from the original text, not the eventual filtered display.
    base=f'{months[month]}-{typ}-{slug(lead or text)[:78]}'
    used[base]+=1
    task_id=base+(f'-{used[base]}' if used[base]>1 else '')
    tasks.append(dict(id=task_id,month=month,type=typ,plants=ps,lead=plain(lead),text=plain(text)))
for mi,m in enumerate(data['chores']):
    for c in m['chores']:
        for it in c['items']:
            lead,body=it.split(' — ',1) if ' — ' in it else ('',it)
            add(mi,TYPES[c['category']],resolve(lead or body),lead,body)
veg_count=len(tasks)
kw=[('rose','roses'),('hydrangea','hydrangea'),('blueberr','blueberry'),('rhododendron','rhododendron'),('azalea','azalea'),('camellia','camellia'),
 ('hosta','hosta'),('peony','peony'),('shasta','shasta-daisy'),('hollyhock','hollyhock'),('tulip','tulips'),('hyacinth','hyacinth'),('barberry','japanese-barberry')]
mc=re.search(r'monthChores:\[(.*?)\n \]',source,re.S).group(1)
orn_months=[json.loads(row.strip().rstrip(',')) for row in mc.strip().splitlines() if row.strip()]
assert len(orn_months)==12
for mi,items in enumerate(orn_months):
    for it in items:
        text=plain(it); low=text.lower(); ps=[]
        if 'acid-lovers' in low: ps+=['rhododendron','azalea','camellia','blueberry']
        if 'bulbs' in low: ps+=['tulips','hyacinth']
        ps += [pid for k,pid in kw if k in low]
        # General ornamental maintenance is scoped to the ornamental area.
        ps=list(dict.fromkeys(ps)) or ['area:ornamental']
        typ='prune' if 'prune' in low else 'feed' if ('feed' in low or 'mulch' in low) else 'plant' if 'plant' in low else 'care'
        add(mi,typ,ps,'',text)
known={p['id'] for p in plants}
areas={'area:front','area:back','area:vegetables','area:ornamental'}
bad={x for t in tasks for x in t['plants'] if x not in known|areas}
assert not unmapped, f'Unmapped chores: {unmapped}'
assert not bad, f'Unknown plants: {bad}'
assert veg_count==248, f'Expected 248 vegetable chores, got {veg_count}'
assert len(plants)==45 and len(known)==45
assert len({t['id'] for t in tasks})==len(tasks)
assert all(len(p['timeline'])==12 for p in plants)

def sentences(t):
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+(?=["(]?[A-Z0-9])',plain(t).strip('"')) if s.strip()]
keys=[('heatMatGuide','Heat mat'),('seedStartingBasics','Seed starting'),('slugStrategy','Slugs'),('companionAndPests','Companions & pests'),
 ('trellisGuide','Trellis & arch'),('wateringSummary','Watering by month'),('rotationPlan','Crop rotation')]
guides=[dict(id=slug(title),title=title,items=sentences(data['synth'][key])) for key,title in keys]
guides.append(dict(id='top-tips',title='Top Tips',items=[s for t in data['synth']['topTips'] for s in sentences(t)]))
zones=js_rows(re.search(r' zones:\[(.*?)\n \]',source,re.S).group(1))
for z in zones: guides.append(dict(id='zone-'+z['id'].lower(),title=plain(z['name']),items=[plain(z['tag'])]+sentences(z['site'])))
(ROOT/'data').mkdir(exist_ok=True)
for name,value in [('plants',dict(version=1,plants=plants,tasks=tasks)),('guides',dict(guides=guides))]:
    (ROOT/'data'/f'{name}.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(f'Library: {len(plants)} plants (32 vegetables/herbs + 13 ornamentals)')
print(f'Jobs: {veg_count} vegetable + {len(tasks)-veg_count} ornamental across 12 months = {len(tasks)} total')
print(f'Guides: {len(guides)} (7 care + Top Tips + 4 zones)')
print('Validation: 0 unmapped chores; 0 unknown plant ids; unique stable ids; 12-month timelines')

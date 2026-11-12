#!/usr/bin/env python3
"""Remove platform-specific claims from localized store copy with Gemini."""
import argparse, fcntl, importlib.util, json, os, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('store',ROOT/'scripts/gemini-store.py'); store=importlib.util.module_from_spec(spec);spec.loader.exec_module(store)
r=store.review
STATE=ROOT/'.l10n/store-platform'
LINUX=re.compile(r'linux|линукс|لينوكس|לינוקס|लिनक्स|লিনাক্স|લિનક્સ|ලිනක්ස්|லினக்ஸ்|ਲੀਨਕਸ',re.I)

def parse_result(text,codes,brand):
    for start,char in enumerate(text):
        if char!='{':continue
        try:
            value,_=json.JSONDecoder().raw_decode(text[start:])
            if not isinstance(value,dict) or set(value)!=set(codes):continue
            for code in codes:
                item=value[code]
                if not isinstance(item,dict) or set(item)!={'short','intro'}:raise ValueError(f'{code}: fields')
                if not all(isinstance(item[k],str) and item[k].strip() and '\n' not in item[k] for k in item):raise ValueError(f'{code}: blank or multiline')
                if len(item['short'].encode('utf-16-le'))//2>132:raise ValueError(f'{code}: short too long')
                if brand not in item['intro']:raise ValueError(f'{code}: brand missing')
                if any(LINUX.search(item[k]) for k in item):raise ValueError(f'{code}: Linux remains')
            return value
        except (ValueError,TypeError):continue
    raise ValueError('Eksiksiz, geçerli yanıt bulunamadı')

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--group-size',type=int,default=10);ap.add_argument('--clear-uncertain',action='store_true');ap.add_argument('--languages');args=ap.parse_args()
    if not 1<=args.group_size<=10:ap.error('Grup 1–10 arası olmalı')
    STATE.mkdir(parents=True,exist_ok=True);r.STATE.mkdir(parents=True,exist_ok=True)
    with open(r.STATE/'run.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('Başka çeviri işlemi çalışıyor.')
        pending=STATE/'uncertain.json'
        if pending.exists():
            if not args.clear_uncertain:raise SystemExit('Önceki istek belirsiz; Gemini konuşmasını kontrol edin.')
            pending.unlink()
        meta=r.read(ROOT/'locales/languages.json')['languages'];brand=r.read(ROOT/'locales/invariants.json')['app.name'];source=r.read(ROOT/'store-assets/source.json')
        codes=args.languages.split(',') if args.languages else r.read(ROOT/'locales/gemini-priority.json')
        if len(codes)!=len(set(codes)) or any(c not in meta or c=='tr' for c in codes):ap.error('Geçersiz dil')
        statefile=STATE/'completed.json';history=r.read(statefile) if statefile.exists() else {}
        def current(c):
            d=r.read(ROOT/f'locales/{c}/translation.json');text=(ROOT/f'store-assets/descriptions/{c}.txt').read_text(encoding='utf-8');return {'short':d['manifest.appDescription'],'long':text}
        def fingerprint(c):return r.digest({'source':source,'brand':brand,'current':current(c)})
        codes=[c for c in codes if history.get(c)!=fingerprint(c)];queue=[codes[i:i+args.group_size] for i in range(0,len(codes),args.group_size)];fail=[]
        while queue:
            group=queue.pop(0);old={c:current(c) for c in group};before={c:fingerprint(c) for c in group}
            prompt=('Revise the following extension store texts in their existing languages. For each target language, remove all references to Linux or any operating system or browser exclusivity. Do not claim compatibility with any particular operating system or browser. Keep the meaning and product features, keep natural grammar, and keep the exact product name '+brand+' in intro. Return ONLY JSON mapping each language code to exactly {"short": "...", "intro": "..."}. Both must be one line, short <=132 UTF-16 units. Input: '+json.dumps({'languages':{c:meta[c]['label'] for c in group},'texts':{c:{'short':old[c]['short'],'intro':old[c]['long'].split('\n\n',1)[0]} for c in group}},ensure_ascii=False))
            print('İstek:',', '.join(group),flush=True);r.write(pending,{'languages':group,'before':before});response=r.draft_text({'prompt':prompt,'provider':'gemini'})['response']
            try:result=parse_result(response,group,brand)
            except ValueError as exc:
                r.write(STATE/('invalid-'+ '-'.join(group)+'.json'),{'languages':group,'response':response,'error':str(exc)});pending.unlink();print('Yanıt geçersiz:',str(exc),flush=True)
                if len(group)>1:
                    mid=len(group)//2;queue[0:0]=[group[:mid],group[mid:]]
                else:fail.extend(group)
                continue
            if any(fingerprint(c)!=before[c] for c in group):raise RuntimeError('Dosya değişti; işlem durduruldu.')
            for c in group:
                f=ROOT/f'locales/{c}/translation.json';d=r.read(f);d['manifest.appDescription']=result[c]['short'];r.write(f,d)
                file=ROOT/f'store-assets/descriptions/{c}.txt';parts=old[c]['long'].split('\n\n',1)
                if len(parts)!=2:raise RuntimeError(f'{c}: açıklama bölümleri beklenen biçimde değil')
                tmp=file.with_suffix('.tmp');tmp.write_text(result[c]['intro'].strip()+'\n\n'+parts[1],encoding='utf-8');os.replace(tmp,file)
            subprocess.run(['node','scripts/build-locales.mjs'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
            store.update_toolkit_state(group);history.update({c:fingerprint(c) for c in group});r.write(statefile,history);pending.unlink();print('Güncellendi:',', '.join(group),flush=True)
        if fail:raise SystemExit('Tamamlanamayan diller: '+', '.join(fail))
if __name__=='__main__':main()

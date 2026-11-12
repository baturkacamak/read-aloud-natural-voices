#!/usr/bin/env python3
"""Translate store title, summary and listing in groups using Gemini."""
import argparse, fcntl, hashlib, importlib.util, json, os, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('gemini_review', ROOT/'scripts/gemini-review.py')
review = importlib.util.module_from_spec(spec); spec.loader.exec_module(review)
STATE = ROOT/'.l10n/store-translation'
OUTPUT = ROOT/'store-assets/descriptions'

def validate(result, group, brand):
    if not isinstance(result, dict) or set(result) != set(group): raise ValueError('Dil kodları eksik veya fazla')
    for code, item in result.items():
        if not isinstance(item, dict) or set(item) != {'title','short','long'}: raise ValueError(f'{code}: alanlar eksik veya fazla')
        if any(not isinstance(item[k], str) or not item[k].strip() for k in item): raise ValueError(f'{code}: boş metin')
        for key, limit in [('title',45),('short',132)]:
            if len(item[key].encode('utf-16-le')) // 2 > limit: raise ValueError(f'{code}: {key} {limit} karakteri aşıyor')
        if len(item['long']) < 250 or len(item['long']) > 16000: raise ValueError(f'{code}: uzun açıklama boyutu geçersiz')
        if brand not in item['long']: raise ValueError(f'{code}: ürün adı korunmadı')

def parse_listing(text, group, brand):
    # Gemini may wrap JSON in prose or a UI-generated code block label.
    try:
        value = review.parse(text)
        validate(value, group, brand)
        return value
    except (ValueError, TypeError):
        for index, char in enumerate(text):
            if char != '{': continue
            try:
                value, _ = json.JSONDecoder().raw_decode(text[index:])
                validate(value, group, brand)
                return value
            except (ValueError, TypeError):
                continue
        raise ValueError('Yanıtta tüm diller için geçerli JSON bulunamadı')

def update_toolkit_state(codes):
    path = ROOT/'.l10n/state.json'
    if not path.exists(): return
    state = review.read(path)
    source = review.read(ROOT/'locales/tr/translation.json')
    for code in codes:
        catalog = review.read(ROOT/f'locales/{code}/translation.json')
        for key in ('manifest.appName', 'manifest.actionTitle', 'manifest.appDescription'):
            entry = state.get('entries', {}).get(f'{code}:/{key}')
            if entry is not None:
                entry['sourceHash'] = hashlib.sha256(source[key].encode()).hexdigest()
                entry['valueHash'] = hashlib.sha256(catalog[key].encode()).hexdigest()
    review.write(path, state)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--languages',help='Virgülle ayrılmış dil kodları')
    parser.add_argument('--group-size',type=int,default=10)
    parser.add_argument('--max-batches',type=int,default=0)
    parser.add_argument('--clear-uncertain',action='store_true')
    args=parser.parse_args()
    if not 1 <= args.group_size <= 10: parser.error('Grup boyutu 1–10 olmalı')
    STATE.mkdir(parents=True,exist_ok=True); OUTPUT.mkdir(parents=True,exist_ok=True); review.STATE.mkdir(parents=True,exist_ok=True)
    lock=open(review.STATE/'run.lock','w')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit('Başka bir Gemini çeviri işlemi çalışıyor.')
    pending=STATE/'uncertain.json'
    if pending.exists():
        if not args.clear_uncertain: raise SystemExit('Önceki istek belirsiz. Gemini konuşmasını kontrol edip --clear-uncertain kullanın.')
        pending.unlink()
    source=review.read(ROOT/'store-assets/source.json'); brand=review.read(ROOT/'locales/invariants.json')['app.name']; meta=review.read(ROOT/'locales/languages.json')['languages']
    codes=args.languages.split(',') if args.languages else review.read(ROOT/'locales/gemini-priority.json')
    if len(set(codes))!=len(codes) or any(c not in meta or c=='tr' for c in codes): parser.error('Geçersiz dil kodu')
    historyfile=STATE/'completed.json';history=review.read(historyfile) if historyfile.exists() else {}
    def fingerprint(c):
        cat=review.read(ROOT/f'locales/{c}/translation.json'); path=OUTPUT/f'{c}.txt'
        return review.digest({'source':source,'brand':brand,'title':cat['manifest.appName'],'short':cat['manifest.appDescription'],'long':path.read_text(encoding='utf-8') if path.exists() else None})
    codes=[c for c in codes if history.get(c)!=fingerprint(c)]
    failures=[];done=0
    queue=[codes[offset:offset+args.group_size] for offset in range(0,len(codes),args.group_size)]
    while queue:
        group=queue.pop(0)
        before={c:fingerprint(c) for c in group}
        prompt=('Translate this extension store listing from Turkish to each listed target language. Return ONLY valid JSON: an object mapping each code to an object with exactly "title", "short", "long" strings. Translate the title naturally and descriptively; title <=45 UTF-16 characters, short <=132 UTF-16 characters. Translate the entire long description faithfully; retain paragraphs and bullets. Preserve the exact product name '+brand+' in the long description. Do not invent features, omit information, or include explanations. Target languages and source: '+json.dumps({'languages':{c:meta[c]['label'] for c in group},'source':source},ensure_ascii=False))
        print('Mağaza isteği: '+', '.join(group),flush=True)
        review.write(pending,{'languages':group,'sourceHash':review.digest(source),'catalogs':before})
        response=review.draft_text({'prompt':prompt,'provider':'gemini'})['response']
        try: result=parse_listing(response,group,brand)
        except (ValueError,TypeError) as exc:
            review.write(STATE/('invalid-'+ '-'.join(group)+'.json'),{'languages':group,'error':str(exc),'response':response});pending.unlink();print('Yanıt doğrulanamadı:',str(exc),flush=True)
            if len(group)>1:
                middle=len(group)//2;queue[0:0]=[group[:middle],group[middle:]];print('Grup küçültülerek yeniden denenecek.',flush=True)
            else: failures.extend(group)
            continue
        if any(fingerprint(c)!=before[c] for c in group) or review.read(ROOT/'store-assets/source.json')!=source: raise RuntimeError('Kaynak veya hedef değişti; sonuç uygulanmadı.')
        review.write(STATE/'ready.json',{'languages':group,'result':result,'before':before})
        for c in group:
            file=ROOT/f'locales/{c}/translation.json';cat=review.read(file);cat['manifest.appName']=result[c]['title'];cat['manifest.actionTitle']=result[c]['title'];cat['manifest.appDescription']=result[c]['short'];review.write(file,cat)
            temp=OUTPUT/f'.{c}.tmp';temp.write_text(result[c]['long'].strip()+'\n',encoding='utf-8');os.replace(temp,OUTPUT/f'{c}.txt')
        subprocess.run(['node','scripts/build-locales.mjs'],cwd=ROOT,check=True)
        update_toolkit_state(group)
        history.update({c:fingerprint(c) for c in group});review.write(historyfile,history);(STATE/'ready.json').unlink();pending.unlink()
        print('Kaydedildi: '+', '.join(group),flush=True);done+=1
        if args.max_batches and done>=args.max_batches:break
    if failures:
        print('Tamamlanamayan diller: '+', '.join(failures),flush=True);raise SystemExit(1)
if __name__=='__main__':main()

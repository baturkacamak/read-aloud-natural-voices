#!/usr/bin/env python3
"""Translate the platform-neutral popup tagline without changing other UI strings."""
import argparse,fcntl,hashlib,importlib.util,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('store',ROOT/'scripts/gemini-store.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s);r=s.review
STATE=ROOT/'.l10n/neutral-taglines'

def parse_result(text,codes):
 for i,ch in enumerate(text):
  if ch!='{':continue
  try:
   d,_=json.JSONDecoder().raw_decode(text[i:])
   if not isinstance(d,dict) or set(d)!=set(codes):continue
   if all(isinstance(d[c],str) and 0<len(d[c])<=80 and '\n' not in d[c] and not re.search(r'linux|линукс|لينوكس|לינוקס|लिनक्स|লিনাক্স',d[c],re.I) for c in codes):return d
  except (ValueError,TypeError):continue
 raise ValueError('Geçerli dil eşleşmeleri bulunamadı')

def main():
 p=argparse.ArgumentParser();p.add_argument('--clear-uncertain',action='store_true');args=p.parse_args();STATE.mkdir(parents=True,exist_ok=True);r.STATE.mkdir(parents=True,exist_ok=True)
 with open(r.STATE/'run.lock','w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); pending=STATE/'uncertain.json'
  if pending.exists():
   if not args.clear_uncertain:raise SystemExit('Önceki istek belirsiz; Gemini konuşmasını kontrol edin.')
   pending.unlink()
  meta=r.read(ROOT/'locales/languages.json')['languages'];codes=r.read(ROOT/'locales/gemini-priority.json');historyfile=STATE/'completed.json';history=r.read(historyfile) if historyfile.exists() else {}
  def fingerprint(c):return r.digest(r.read(ROOT/f'locales/{c}/translation.json')['app.tagline'])
  codes=[c for c in codes if history.get(c)!=fingerprint(c)];queue=[codes[i:i+10] for i in range(0,len(codes),10)];failed=[]
  while queue:
   group=queue.pop(0);before={c:fingerprint(c) for c in group};prompt='Translate the short interface subtitle "Microsoft Edge natural voices" into each listed language. Keep Microsoft Edge exactly unchanged, avoid all operating system names and compatibility claims. Return ONLY JSON object mapping code to one short string, no explanations. '+json.dumps({c:meta[c]['label'] for c in group},ensure_ascii=False)
   print('Arayüz alt başlıkları:',', '.join(group),flush=True);r.write(pending,{'languages':group,'before':before});response=r.draft_text({'prompt':prompt,'provider':'gemini'})['response']
   try:
    result=parse_result(response,group)
    if any('Microsoft Edge' not in result[c] for c in group):raise ValueError('Microsoft Edge adı eksik')
   except ValueError as exc:
    r.write(STATE/('invalid-'+ '-'.join(group)+'.json'),{'languages':group,'response':response,'error':str(exc)});pending.unlink()
    if len(group)>1:
     mid=len(group)//2;queue[0:0]=[group[:mid],group[mid:]]
    else:failed.extend(group)
    continue
   if any(fingerprint(c)!=before[c] for c in group):raise RuntimeError('Katalog değişti.')
   for c in group:
    f=ROOT/f'locales/{c}/translation.json';d=r.read(f);d['app.tagline']=result[c];r.write(f,d)
   subprocess.run(['node','scripts/build-locales.mjs'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL);history.update({c:fingerprint(c) for c in group});r.write(historyfile,history);pending.unlink();print('Güncellendi:',', '.join(group),flush=True)
  if failed:raise SystemExit('Tamamlanamayanlar: '+', '.join(failed))
if __name__=='__main__':main()

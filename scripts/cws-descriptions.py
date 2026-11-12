#!/usr/bin/env python3
"""Preview or fill localized Chrome Web Store descriptions; never submit."""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT.parent / 'what-if-music-studio'
# Cantonese is not Mandarin, so never map yue to the zh_TW store listing.
STORE_CODES = {'he': ['iw', 'he'], 'no': ['no', 'nb'], 'pt': ['pt_BR', 'pt-BR', 'pt_br'],
               'zh': ['zh_CN', 'zh-CN', 'zh_cn'], 'tl': ['fil', 'tl'], 'prs': ['prs', 'fa-AF']}

def listings():
    languages = json.loads((ROOT/'locales/languages.json').read_text(encoding='utf-8'))['languages']
    for code in languages:
        file = ROOT/'store-assets/descriptions'/f'{code}.txt'
        if not file.is_file(): raise ValueError(f'{code}: mağaza açıklaması eksik')
        text = file.read_text(encoding='utf-8').strip()
        if not text or len(text.encode('utf-16-le'))//2 > 16000: raise ValueError(f'{code}: açıklama boş veya çok uzun')
        yield code, text

def valid_url(url):
    parsed=urlparse(url)
    return parsed.scheme=='https' and parsed.hostname in {'chrome.google.com','chromewebstore.google.com'} and '/webstore/devconsole/' in parsed.path and parsed.path.endswith('/edit')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Chrome Web Store geliştirici paneli edit adresi')
    parser.add_argument('--inspect', action='store_true', help='Panele bağlan ve alanları incele; değişiklik yapma')
    parser.add_argument('--apply', action='store_true', help='Açıklamaları taslak formuna doldur (yayınlamaz)')
    parser.add_argument('--languages', help='Yalnızca belirtilen dil kodları')
    parser.add_argument('--save-draft', action='store_true', help='Doğrulanan form değişikliklerini taslak olarak kaydet')
    args = parser.parse_args()
    if not valid_url(args.url): parser.error('Geçerli Chrome Web Store geliştirici paneli edit adresi gerekli')
    entries = list(listings())
    if args.languages:
        requested=args.languages.split(',')
        if len(requested)!=len(set(requested)) or any(c not in dict(entries) for c in requested): parser.error('Geçersiz dil kodu')
        entries=[item for item in entries if item[0] in requested]
    if not args.apply and not args.inspect:
        print(f'{len(entries)} açıklama hazır; yue, mağazada birebir Kantonca seçeneği doğrulanmadığı için atlanacak.')
        print('Bu deneme mağazayı açmaz. Forma yazmak için --apply kullanılır.')
        return
    from playwright.sync_api import sync_playwright
    sys.path.insert(0, str(STUDIO))
    from python_core.visual_worker import _edge_endpoint, _show_page
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(_edge_endpoint())
        ctx = browser.contexts[0]
        try:
            page=ctx.new_page()
            page.goto(args.url, wait_until='domcontentloaded', timeout=60000)
            _show_page(page, ctx)
            page.wait_for_timeout(3000)
            if 'accounts.google.com' in page.url or 'signin' in page.url or page.get_by_role('heading', name=re.compile(r'Choose an account|Bir hesap seçin|Sign in', re.I)).count():
                raise RuntimeError('Google oturumu bu profilde kullanılamıyor. Güvenli bir normal tarayıcı oturumuyla giriş gerekli; güvenlik uyarısı otomatik aşılamaz.')
            if args.inspect:
                print('Panel başlıkları:', page.locator('h1,h2,h3').all_inner_texts(), flush=True)
                print('Açılır liste sayısı:', page.get_by_role('combobox').count(), flush=True)
                print('Açılır listeler:', page.get_by_role('combobox').evaluate_all("els => els.map(e => ({label:e.getAttribute('aria-label'), value:e.value, text:e.innerText, outer:e.outerHTML.slice(0,600)}))"), flush=True)
                print('Metin alanları:', page.locator('textarea').evaluate_all("els => els.map(e => ({maxlength:e.maxLength, label:e.getAttribute('aria-label'), valueLength:e.value.length, outer:e.outerHTML.slice(0,400)}))"), flush=True)
                print('Giriş alanları:', page.locator('input:visible').evaluate_all("els => els.map(e => ({maxlength:e.maxLength, label:e.getAttribute('aria-label'), valueLength:e.value.length, outer:e.outerHTML.slice(0,350)}))"), flush=True)
                print('Sayfa düğmeleri:', page.get_by_role('button').all_inner_texts(), flush=True)
                page.get_by_role('combobox').first.click()
                opts=page.locator('li[data-value]:visible'); opts.first.wait_for(state='visible',timeout=10000)
                print('Mağaza dilleri:',opts.evaluate_all("els=>els.map(e=>({value:e.getAttribute('data-value'),label:e.innerText}))"),flush=True)
                page.keyboard.press('Escape')
                return
            dropdown=page.get_by_role('combobox').first
            dropdown.wait_for(state='visible',timeout=30000)
            unsupported=[]; updated=[]
            for code, description in entries:
                if code=='yue': unsupported.append(code); continue
                dropdown.click()
                options=page.locator('li[data-value]:visible')
                options.first.wait_for(state='visible',timeout=10000)
                if not options.count(): raise RuntimeError('Mağazanın dil listesi beklenen biçimde değil; işlem durduruldu.')
                values=options.evaluate_all("els => els.map(e => e.getAttribute('data-value'))")
                candidates=STORE_CODES.get(code,[code])
                selected=next((v for v in candidates if v in values),None)
                if selected is None:
                    unsupported.append(code);page.keyboard.press('Escape');continue
                label=options.nth(values.index(selected)).inner_text().strip()
                options.nth(values.index(selected)).click()
                page.wait_for_function("""(p) => document.querySelectorAll('[role="combobox"]')[0]?.innerText.includes(p)""", arg=label, timeout=10000)
                page.wait_for_timeout(1200)
                area=page.locator('textarea[maxlength="16000"]:visible')
                area.first.wait_for(state='visible',timeout=10000)
                if area.count()!=1: raise RuntimeError(f'{code}: açıklama alanı tek olarak bulunamadı; işlem durduruldu.')
                area.fill(description)
                if area.input_value()!=description: raise RuntimeError(f'{code}: metin doğrulanamadı.')
                print(f'Dolduruldu: {code} ({selected})',flush=True);updated.append(code)
            print(f'Formda doldurulan: {len(updated)}. Bulunamayan veya güvenli eşleştirilemeyen: {", ".join(unsupported) or "yok"}.',flush=True)
            if not updated: raise RuntimeError('Hiçbir dil doldurulmadı.')
            for code, description in entries:
                if code not in updated: continue
                dropdown.click()
                options=page.locator('li[data-value]:visible'); options.first.wait_for(state='visible',timeout=10000)
                values=options.evaluate_all("els => els.map(e => e.getAttribute('data-value'))")
                selected=next(v for v in STORE_CODES.get(code,[code]) if v in values)
                label=options.nth(values.index(selected)).inner_text().strip()
                options.nth(values.index(selected)).click()
                page.wait_for_function("""(p) => document.querySelectorAll('[role="combobox"]')[0]?.innerText.includes(p)""", arg=label, timeout=10000)
                page.wait_for_timeout(1200)
                if page.locator('textarea[maxlength="16000"]:visible').input_value()!=description:
                    raise RuntimeError(f'{code}: dil değiştirince açıklama korunmadı; taslak kaydedilmedi.')
            print('Dil değiştirerek açıklamalar doğrulandı.',flush=True)
            if args.save_draft:
                button=page.get_by_role('button',name=re.compile(r'Taslağı kaydet|Save draft',re.I)).first
                button.wait_for(state='visible',timeout=10000)
                if not button.is_enabled(): raise RuntimeError('Taslak kaydet düğmesi etkin değil.')
                button.click();page.wait_for_timeout(2000)
                print('Taslak kaydetme isteği gönderildi; durum panelden doğrulanmalı.',flush=True)
            else:
                print('Panelde değişiklikleri inceleyip kendin kaydet; betik yayınlama yapmaz.',flush=True)
                input('İncelemeyi tamamlayıp pencereyi kapatmak için Enter: ')

        finally: browser.close()
if __name__=='__main__':
    try: sys.exit(main() or 0)
    except Exception as exc:
        print(f'Hata: {exc}',file=sys.stderr);sys.exit(1)

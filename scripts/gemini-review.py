#!/usr/bin/env python3
"""Review locale catalogs with the What If Music Studio Gemini browser worker."""
import argparse, fcntl, hashlib, json, os, re, subprocess, sys, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STUDIO = Path(os.environ.get('GEMINI_STUDIO_DIR', ROOT.parent / 'what-if-music-studio'))
sys.path.insert(0, str(STUDIO))
from python_core import visual_worker as worker
from python_core.visual_accounts import AccountError, AccountPool, AccountStore

# This process uses the studio worker without changing its other workflows.
def draft_text(payload):
    if os.environ.get('BROWSER_AI_SERVICE') != '1':
        return worker.draft_text(payload)
    from browser_ai.client import request
    request_id = uuid.uuid4().hex
    # Record the ID before the service can receive the request.
    state_dir = ROOT / '.l10n' / 'browser-ai-service'
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = state_dir / 'last-request.json'
    fd = os.open(marker, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        json.dump({'id': request_id}, handle)
    print(f'Browser AI iş kimliği: {request_id}', flush=True)
    return request(request_id, {**payload, 'runtime_root': str(STUDIO.resolve())})

_original_ensure_pro = worker._ensure_pro
_original_draft_text = worker._draft_text
_force_fast = False

class TranslationAccountStore(AccountStore):
    """Keep quota status local to this run, independent of Studio's Pro state."""
    records = {}

    def load(self):
        original = super().load()
        return {'selection': original['selection'], 'indices': original['indices'], 'records': self.records}

    def update(self, index, kind, status, *, identity=None, retry_at=None):
        from datetime import datetime, timezone
        record = self.records.setdefault(str(index), {})
        if identity:
            if record.get('identity') and record['identity'] != identity:
                record.clear()
            record['identity'] = identity
        record[kind] = {'status': status, 'day': datetime.now(timezone.utc).date().isoformat()}
        if retry_at is not None:
            record[kind]['retry_at'] = retry_at

worker.AccountStore = TranslationAccountStore

PICKER = '[data-test-id="bard-mode-menu-button"] button, button[data-test-id="bard-mode-menu-button"]'
OPTIONS = '[role="menuitemradio"], [role="menuitem"], [role="option"], button.bard-mode-list-button, gem-menu-item[data-test-id^="bard-mode-option-"]'

def select_model(page, fast):
    picker = page.locator(PICKER).filter(visible=True).first
    try:
        picker.wait_for(state='visible', timeout=30000)
        match = re.compile(r'Flash|Fast|Hızlı' if fast else r'\bPro\b', re.I)
        if match.search(picker.inner_text()): return
        # The worker's background window can be outside the viewport.
        picker.evaluate('(element) => element.click()')
        options = page.locator(OPTIONS).filter(visible=True).filter(has_text=match)
        options.first.wait_for(state='visible', timeout=15000)
        candidates = [options.nth(i) for i in range(options.count())]
        if fast:
            candidates.sort(key=lambda option: bool(re.search(r'lite', option.inner_text(), re.I)))
        for option in candidates:
            label = option.inner_text()
            if option.is_enabled() and option.get_attribute('aria-disabled') != 'true' and not re.search(r'limit|quota|sınır|unavailable|kullanılamaz', label, re.I):
                option.evaluate('(element) => element.click()')
                page.wait_for_function("""fast => {
                    const el = document.querySelector('[data-test-id="bard-mode-menu-button"]');
                    return (fast ? /Flash|Fast|Hızlı/i : /\\bPro\\b/i).test(el?.innerText || '');
                }""", arg=fast, timeout=15000, polling=250)
                print('Gemini modeli seçildi: ' + ('Flash/Fast' if fast else 'Pro'), flush=True)
                return
        raise AccountError('unavailable', 'İstenen Gemini modeli kullanılamıyor.', scope='model')
    except AccountError:
        raise
    except Exception as exc:
        raise AccountError('unavailable', 'Gemini model seçimi doğrulanamadı.', scope='model') from exc

def ensure_fast(page):
    return select_model(page, True)

def ensure_translation_model(page):
    if _force_fast: return ensure_fast(page)
    try: return select_model(page, False)
    except AccountError as exc:
        if exc.code != 'unavailable': raise
        print('Gemini Pro kullanılamıyor; Flash/Fast deneniyor.', flush=True)
        page.keyboard.press('Escape')
        return ensure_fast(page)

def draft_with_fast_fallback(*args, **kwargs):
    global _force_fast
    try:
        return _original_draft_text(*args, **kwargs)
    except AccountError as exc:
        if exc.code != "quota": raise
        print("Gemini Pro kotası doldu; aynı hesapta Flash/Fast deneniyor.", flush=True)
        _force_fast = True
        try: return _original_draft_text(*args, **kwargs)
        finally: _force_fast = False

def draft_using_accounts(browser, prompt, reference=None, trace=None, *, after_account=None, selected_account=None):
    """Keep the Gemini conversation open if submission or reply is uncertain."""
    store = TranslationAccountStore()
    pool = AccountPool(store, 'text', lambda index: worker._prepare_account(browser, store, index))
    if isinstance(after_account, int) and not isinstance(after_account, bool) and after_account in pool.indices:
        pos = pool.indices.index(after_account) + 1
        pool.indices = pool.indices[pos:] + pool.indices[:pos]

    def attempt(account):
        page = worker._new_background_page(browser)
        preserve = False
        try:
            response = worker._draft_text(page, prompt, reference, account, trace)
            if selected_account is not None:
                selected_account.append(account['index'])
            return response
        except (worker.BrowserControlError, worker.TextReplyRetryPending):
            preserve = True
            print('İstek doğrulanamadı; Gemini sekmesi inceleme için açık bırakıldı.', flush=True)
            raise
        finally:
            if not preserve and not worker._is_verification_page(page):
                page.close()
    return str(pool.run(attempt))

_original_confirm = worker._confirm_submission_visible

def confirm_submission_unicode(page, editor, send, prompt, trace=None, *, keyboard=False):
    try:
        return _original_confirm(page, editor, send, prompt, trace, keyboard=keyboard)
    except worker.BrowserControlError:
        # Gemini may canonicalize combining characters when rendering a submitted turn.
        # Accept only the complete visible prompt, not a prefix or a response alone.
        matched = page.evaluate(r"""expected => {
            const normalize = text => (text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
            const editor = document.querySelector('rich-textarea [contenteditable="true"][role="textbox"]');
            if (normalize(editor?.innerText) === normalize(expected)) return false;
            return [...document.querySelectorAll('user-query')].some(query => {
                if (!query.getClientRects().length || query.getAttribute('aria-hidden') === 'true') return false;
                const lines = [...query.querySelectorAll('.query-text-line')];
                const text = lines.length ? lines.map(line => line.innerText).join('\n') : query.innerText;
                return normalize(text) === normalize(expected);
            });
        }""", prompt)
        if not matched: raise
        print('Gönderilen metin Unicode eşdeğerliğiyle doğrulandı.', flush=True)

worker._confirm_submission_visible = confirm_submission_unicode
worker._ensure_pro = ensure_translation_model
worker._draft_text = draft_with_fast_fallback
worker._draft_using_accounts = draft_using_accounts

STATE = ROOT / '.l10n' / 'gemini-review'
TOKEN = re.compile(r'\{\{\s*[^{}]+?\s*\}\}')
def read(path): return json.loads(path.read_text(encoding='utf-8'))
def digest(value): return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.gemini-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)
def parse(text):
    text = text.strip()
    for prefix in ('Gemini şunu dedi:', 'Gemini said:'):
        if text.startswith(prefix): text = text[len(prefix):].strip()
    if text.startswith('JSON\n'): text = text[5:].strip()
    if text.startswith('```'): text = re.sub(r'^```[^\n]*\n|\n```\s*$', '', text)
    return json.loads(text)
def validate(result, codes, source, keys, invariants):
    if not isinstance(result, dict) or set(result) != set(codes): raise ValueError('Unexpected language codes')
    for code in codes:
        values = result[code]
        if not isinstance(values, dict) or set(values) != set(keys): raise ValueError(f'{code}: unexpected keys')
        for key in keys:
            value = values[key]
            if not isinstance(value, str) or not value.strip(): raise ValueError(f'{code}/{key}: empty value')
            if sorted(TOKEN.findall(value)) != sorted(TOKEN.findall(source[key])): raise ValueError(f'{code}/{key}: placeholder mismatch')
            if key in invariants and value != invariants[key]: raise ValueError(f'{code}/{key}: invariant changed')
            if key == 'manifest.appDescription' and len(value.encode('utf-16-le')) // 2 > 132: raise ValueError(f'{code}/{key}: manifest description too long')

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--languages', help='Comma-separated language codes; defaults to all non-Turkish languages')
    ap.add_argument('--batch-size', type=int, default=500)
    ap.add_argument('--clear-uncertain', action='store_true', help='After checking the Gemini conversation, clear the pending request marker')
    ap.add_argument('--max-batches', type=int, default=0, help='Stop after this many successful requests (0: unlimited)')
    args = ap.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    lock = open(STATE/'run.lock', 'w')
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit('Another Gemini review is already running.')
    pending = STATE/'uncertain.json'
    if pending.exists():
        if not args.clear_uncertain: raise SystemExit('Previous request may have been sent. Check the Gemini conversation, then run with --clear-uncertain.')
        pending.unlink()
    if not 1 <= args.batch_size <= 1000: ap.error('batch size must be 1–1000')
    meta = read(ROOT/'locales/languages.json')['languages']; source = read(ROOT/'locales/tr/translation.json'); invariants = read(ROOT/'locales/invariants.json')
    priority = (ROOT/'locales/gemini-priority.json')
    codes = args.languages.split(',') if args.languages else read(priority)
    if not args.languages and (set(codes) != set(meta) - {'tr'} or len(codes) != len(set(codes))): raise ValueError('Priority list must contain every target language exactly once')
    if len(codes) != len(set(codes)) or any(c not in meta or c == 'tr' for c in codes): ap.error('Invalid or duplicate target language')
    historyfile = STATE/'completed.json'
    history = read(historyfile) if historyfile.exists() else {}
    codes = [c for c in codes if history.get(c) != digest({'source':source, 'catalog':read(ROOT/f'locales/{c}/translation.json')})]
    keys = list(source); completed = 0; failed = []
    for i in range(0, len(codes), 1):
        group = codes[i:i+1]; catalogs = {c: read(ROOT/f'locales/{c}/translation.json') for c in group}
        identity = digest({'source':source, 'catalogs':catalogs, 'group':group, 'batch':args.batch_size})
        statefile = STATE / ('-'.join(group)+'.json')
        state = read(statefile) if statefile.exists() else {}
        if state and state.get('identity') != identity: raise RuntimeError(f'{statefile}: source or catalog changed; inspect checkpoint before restarting')
        state = state or {'identity':identity, 'results':{c:{} for c in group}}
        for start in range(0, len(keys), args.batch_size):
            part = keys[start:start+args.batch_size]
            if all(all(k in state['results'][c] for k in part) for c in group): continue
            data = {'languages':{c:meta[c]['label'] for c in group}, 'source_turkish':{k:source[k] for k in part}, 'existing_translations':{c:{k:catalogs[c][k] for k in part} for c in group}, 'unchanged':{k:invariants[k] for k in part if k in invariants}}
            prompt = ('Review and correct these browser text-to-speech extension UI translations using the Turkish source and key context. Return ONLY one JSON object mapping each language code to an object with exactly the supplied keys and translated strings. Translate naturally for the specified language, not a related language. Preserve every {{placeholder}} exactly, punctuation and meaningful whitespace where needed. Preserve unchanged strings exactly. UI themes light/dark are colors; highlight off means disabled. Percent signs follow local conventions. manifest.appDescription must be at most 132 UTF-16 code units, concise but accurate. Do not add explanations. Input JSON:\n' + json.dumps(data, ensure_ascii=False))
            print(f'Request {group}: {start+1}-{start+len(part)}/{len(keys)}', flush=True)
            write(pending, {'languages':group, 'keys':part})
            response = draft_text({'prompt':prompt, 'provider':'gemini'})['response']
            try:
                result = parse(response); validate(result, group, source, part, invariants)
            except (ValueError, TypeError) as exc:
                failure_file = STATE / f'{group[0]}-invalid.json'
                write(failure_file, {'languages':group, 'keys':part, 'response':response, 'error':str(exc)})
                pending.unlink()
                failed.append(group[0])
                print(f'{group[0]}: Gemini geçerli çeviri döndürmedi; yanıt {failure_file} içinde. Sonraki dile geçiliyor.', flush=True)
                break
            for c in group: state['results'][c].update(result[c])
            write(statefile, state); pending.unlink(); completed += 1
            if args.max_batches and completed >= args.max_batches:
                print('Stopped at requested batch limit; checkpoint saved.', flush=True); return
        if group[0] in failed: continue
        # Do not overwrite files changed during the review.
        current = {c:read(ROOT/f'locales/{c}/translation.json') for c in group}
        if current != catalogs or read(ROOT/'locales/tr/translation.json') != source: raise RuntimeError('Catalog changed during review; no results applied')
        for c in group:
            state['results'][c]['manifest.actionTitle'] = state['results'][c]['manifest.appName']
            write(ROOT/f'locales/{c}/translation.json', state['results'][c])
        subprocess.run(['node','scripts/build-locales.mjs'], cwd=ROOT, check=True)
        statefile.unlink()
        done = STATE/'completed.json'; history = read(done) if done.exists() else {}; history.update({c:digest({'source':source, 'catalog':state['results'][c]}) for c in group}); write(done, history)
        print(f'Applied: {group}', flush=True)
    if failed:
        print('Tamamlanamayan diller: ' + ', '.join(failed) + '. Yeniden çalıştırınca tekrar denenir.', flush=True)
        raise SystemExit(1)
if __name__ == '__main__': main()

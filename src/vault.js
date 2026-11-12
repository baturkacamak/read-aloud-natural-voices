/** Extension-owned IndexedDB: document text and audio never enter sync storage. */
(() => {
  if (globalThis.SesliOkuVault) return;
  const i18n = globalThis.SesliOkuI18n;
  const t = (key, params, fallback) =>
    i18n ? i18n.t(key, params, fallback) : fallback ?? key;
  const LIMIT = 250 * 1024 * 1024;
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('sesli-oku-vault', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('exportCache')) request.result.createObjectStore('exportCache', { keyPath: 'id' });
      if (request.result.objectStoreNames.contains('books')) return;
      request.result.createObjectStore('books', { keyPath: 'id' });
      request.result.createObjectStore('parts', { keyPath: ['bookId', 'index'] });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  async function transaction(stores, mode, operation) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let value;
      tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(tx.error || new Error(t("vault.failed")));
      operation(tx, result => { value = result; });
    });
  }
  const get = id => transaction(['books'], 'readonly', (tx, done) => { tx.objectStore('books').get(id).onsuccess = event => done(event.target.result); });
  const list = () => transaction(['books'], 'readonly', (tx, done) => { tx.objectStore('books').getAll().onsuccess = event => done(event.target.result.map(({ chunks, ...metadata }) => metadata)); });
  const put = book => transaction(['books'], 'readwrite', (tx, done) => {
    const store=tx.objectStore('books');store.getAll().onsuccess=event=>{
      const used=event.target.result.filter(item=>item.id!==book.id).reduce((sum,item)=>sum+(item.size||0),0);
      if(used+(book.size||0)>LIMIT){tx.abort();return;}store.put(book);done(book);
    };
  });
  const remove = id => transaction(['books','parts'], 'readwrite', tx => { tx.objectStore('books').delete(id); tx.objectStore('parts').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER])); });
  const getPart = (id, index) => transaction(['parts'], 'readonly', (tx, done) => { tx.objectStore('parts').get([id,index]).onsuccess = event => done(event.target.result); });
  async function begin(value) {
    if (!Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > 5000) throw new Error(t("vault.invalidText"));
    const book = { id: crypto.randomUUID(), title: String(value.title || t('vault.untitled')).slice(0,250), url: String(value.url || ''),
      chunks: value.chunks.map(chunk => ({ text: String(chunk.text).slice(0,5000), heading: String(chunk.heading || '').slice(0,250) })),
      settings: value.settings, ownerTabId:value.ownerTabId, created: Date.now(), kind: value.kind === 'document' ? 'document' : 'audio', status: value.kind === 'document' ? 'ready' : 'working', size: 0, parts: 0 };
    await put(book); return book;
  }
  const putPart = async (id, index, part) => {
    if(typeof part.audio!=='string'||part.audio.length>20*1024*1024)throw new Error(t("vault.invalidPart"));
    await transaction(['books','parts'], 'readwrite', tx => {
      const store=tx.objectStore('books');store.getAll().onsuccess=event=>{
        const books=event.target.result;const book=books.find(item=>item.id===id);const size=Math.ceil(part.audio.length*.75);
        if(!book||book.status!=='working'||index!==book.parts||index>=book.chunks.length||books.reduce((sum,item)=>sum+(item.size||0),0)+size>LIMIT){tx.abort();return;}
        tx.objectStore('parts').put({bookId:id,index,audio:part.audio,boundaries:part.boundaries||[],sourceOffsets:part.sourceOffsets||[]});store.put({...book,size:book.size+size,parts:book.parts+1});
      };
    });
  };
  async function finish(id) { await transaction(['books'],'readwrite',(tx,done)=>{const store=tx.objectStore('books');store.get(id).onsuccess=event=>{const book=event.target.result;if(!book||book.parts!==book.chunks.length){tx.abort();return;}store.put({...book,status:'ready'});done({id});};});return {id}; }
  const exportGet = id => transaction(['exportCache'], 'readonly', (tx, done) => {
    tx.objectStore('exportCache').get(id).onsuccess = event => {
      const item = event.target.result;
      done(item && Date.now() - item.created < 7 * 86400000 ? item.part : null);
    };
  });
  const exportPut = (id, part) => transaction(['exportCache'], 'readwrite', tx => {
    if (typeof part.audio !== 'string' || part.audio.length > 20 * 1024 * 1024) throw new Error(t('vault.invalidPart'));
    const store = tx.objectStore('exportCache');
    store.getAll().onsuccess = event => {
      const items = event.target.result.filter(item => item.id !== id).sort((a,b) => b.created - a.created);
      let used = part.audio.length;
      for (const item of items) {
        used += item.part.audio.length;
        if (Date.now() - item.created >= 7 * 86400000 || used > 100 * 1024 * 1024) store.delete(item.id);
      }
      store.put({id, part, created: Date.now()});
    };
  });
  globalThis.SesliOkuVault = { exportGet, exportPut, get,list,put,remove,getPart,begin,putPart,finish };
})();

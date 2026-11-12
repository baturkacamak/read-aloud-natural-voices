/** Library administration shared by the popup, reader and worker. */
(() => {
  if (globalThis.SesliOkuTools) return;
  const i18n = globalThis.SesliOkuI18n;
  const t = (key, params, fallback) =>
    i18n ? i18n.t(key, params, fallback) : fallback ?? key;
  const library = globalThis.SesliOkuLibrary;
  const settings = globalThis.SesliOkuSettings;
  const schema = 'sesli-oku-backup';
  const skin = value => ['modern','win95','win98','xp','win7'].includes(value) ? value : 'modern';
  const mode = value => ['light','dark'].includes(value) ? value : 'original';
  function validateBackup(value) {
    if (!value || value.format !== schema || value.version !== 1 || !value.settings || !value.library) throw new Error(t("tools.invalidBackup"));
    if (JSON.stringify(value).length > 5*1024*1024) throw new Error(t("tools.backupTooLarge"));
    const saved = library.clean(value.library);
    for (const items of [saved.bookmarks,saved.queue]) for (const item of items) {
      const parsed=new URL(item.url);if(parsed.protocol==='chrome-extension:'&&parsed.pathname==='/src/reader.html'){const id=parsed.searchParams.get('book');if(!id||!/^[a-zA-Z0-9-]+$/.test(id))throw new Error(t("tools.invalidDocumentBookmark"));item.url=chrome.runtime.getURL('src/reader.html')+'?book='+id;}item.url = library.pageKey(item.url); item.title=String(item.title||item.url).slice(0,250);item.note=String(item.note||'').slice(0,3000);item.tags=library.tags(item.tags);
      if(item.anchor && (typeof item.anchor.quote!=='string'||item.anchor.quote.length>5000))throw new Error(t("tools.invalidBookmark"));
    }
    for(const rule of Object.values(saved.sites)){rule.settings=settings.normalize(rule.settings);rule.theme=skin(rule.theme);rule.colorMode=mode(rule.colorMode);}
    saved.queueRunning=false;saved.queueItemId=null;saved.queueTabId=null;saved.export=null;
    saved.queue=saved.queue.map(item=>({...item,status:'pending',error:''}));
    const profiles=Array.isArray(value.profiles)?value.profiles.slice(0,20).map(profile=>({id:String(profile.id||crypto.randomUUID()).slice(0,100),name:String(profile.name||t('tools.defaultProfile')).slice(0,40),settings:settings.normalize(profile.settings),theme:skin(profile.theme),colorMode:mode(profile.colorMode)})):[];
    return { settings:settings.normalize(value.settings), readingProfiles:profiles,appearanceTheme:skin(value.theme),appearanceMode:mode(value.colorMode),readingLibrary:saved };
  }
  async function backup() {
    const stored=await chrome.storage.local.get(['settings','readingProfiles','appearanceTheme','appearanceMode','readingLibrary']);
    const saved=library.clean(stored.readingLibrary);saved.queueRunning=false;saved.queueTabId=null;saved.queueItemId=null;saved.export=null;
    return {format:schema,version:1,created:new Date().toISOString(),settings:settings.normalize(stored.settings),profiles:stored.readingProfiles||[],theme:stored.appearanceTheme||'modern',colorMode:stored.appearanceMode||'original',library:saved};
  }
  async function restore(value) {
    const next=validateBackup(value);const stored=await chrome.storage.local.get(['readingLibrary','readingProfiles','syncJournal']);const current=library.clean(stored.readingLibrary);
    const merge=(a,b,max)=>[...new Map([...a,...b].map(item=>[item.id,item])).values()].slice(-max);
    // An explicit file restore is a new local edit, including records previously deleted on this device.
    for(const [url,page]of Object.entries(next.readingLibrary.pages))page.updated=Math.max(Date.now(),(Number(current.pages[url]?.updated)||0)+1,(Number(stored.syncJournal?.removedPages?.[url])||0)+1);
    for(const item of next.readingLibrary.bookmarks)item.updated=Math.max(Date.now(),(Number(current.bookmarks.find(old=>old.id===item.id)?.updated)||0)+1,(Number(stored.syncJournal?.removed?.[item.id])||0)+1);
    next.readingLibrary.pages={...current.pages,...next.readingLibrary.pages};next.readingLibrary.sites={...current.sites,...next.readingLibrary.sites};
    next.readingLibrary.bookmarks=merge(current.bookmarks,next.readingLibrary.bookmarks,300);next.readingLibrary.queue=merge(current.queue,next.readingLibrary.queue,50);
    next.readingProfiles=merge(stored.readingProfiles||[],next.readingProfiles,20);
    next.readingLibrary=library.clean(next.readingLibrary);
    await chrome.storage.local.set(next);return {message:t("tools.restored")};
  }
  function download(value) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=t('tools.backupFilename',{date:new Date().toISOString().slice(0,10)});a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function mount(root,{action,feedback,context}) {
    const area=root;const template=document.createElement('template');
    template.innerHTML=`<details data-library-group="management"><summary data-i18n="tools.sitesSummary">${t("tools.sitesSummary")}</summary><p class="site-status"></p><button type="button" class="pref-button" data-tool="siteSave" data-i18n="tools.siteSave">${t("tools.siteSave")}</button><ul class="site-list"></ul></details>
      <details data-library-group="documents"><summary data-i18n="tools.documentsSummary">${t("tools.documentsSummary")}</summary><div class="library-buttons"><button type="button" class="pref-button" data-tool="openReader" data-i18n="tools.openReader">${t("tools.openReader")}</button><button type="button" class="pref-button" data-tool="offlineSave" data-i18n="tools.offlineSave">${t("tools.offlineSave")}</button><button type="button" class="pref-button" data-tool="vaultRefresh" data-i18n="tools.vaultRefresh">${t("tools.vaultRefresh")}</button></div><p data-i18n="tools.offlineHint">${t("tools.offlineHint")}</p><ul class="vault-list"></ul></details>
      <details data-library-group="statistics" class="listening-statistics"><summary data-i18n="tools.statsSummary">${t("tools.statsSummary")}</summary><p class="stats-summary" role="status"></p><label><span data-i18n="tools.weeklyGoal">${t("tools.weeklyGoal")}</span><input type="number" min="0" max="6000" step="5" class="stats-goal" value="150"></label><div class="library-buttons"><button type="button" class="pref-button" data-tool="statsGoal" data-i18n="tools.statsGoal">${t("tools.statsGoal")}</button><button type="button" class="pref-button" data-tool="statsRefresh" data-i18n="tools.refresh">${t("tools.refresh")}</button><button type="button" class="pref-button" data-tool="statsClear" data-i18n="tools.statsClear">${t("tools.statsClear")}</button></div><progress class="stats-progress" max="150" value="0" aria-label="${t("tools.statsProgressLabel")}" data-i18n-aria-label="tools.statsProgressLabel"></progress><ul class="stats-days"></ul><p data-i18n="tools.statsHint">${t("tools.statsHint")}</p></details>
      <details data-library-group="management"><summary data-i18n="tools.syncSummary">${t("tools.syncSummary")}</summary><label class="pref-check"><input type="checkbox" class="sync-enabled"><span data-i18n="tools.syncEnable">${t("tools.syncEnable")}</span></label><p data-i18n="tools.syncHint">${t("tools.syncHint")}</p><p class="sync-status" role="status"></p><div class="library-buttons"><button type="button" class="pref-button" data-tool="syncNow" data-i18n="tools.syncNow">${t("tools.syncNow")}</button><button type="button" class="pref-button" data-tool="syncClear" data-i18n="tools.syncClear">${t("tools.syncClear")}</button></div></details>
      <details data-library-group="management"><summary data-i18n="tools.backupSummary">${t("tools.backupSummary")}</summary><div class="library-buttons"><button type="button" class="pref-button" data-tool="backup" data-i18n="tools.backupDownload">${t("tools.backupDownload")}</button><label class="pref-button"><span data-i18n="tools.backupMerge">${t("tools.backupMerge")}</span><input type="file" accept="application/json,.json" class="backup-file"></label></div><p data-i18n="tools.backupHint">${t("tools.backupHint")}</p></details>`;
    for(const detail of [...template.content.children])root.querySelector(`[data-library-panel="${detail.dataset.libraryGroup}"]`).append(detail);
    const onGroup=event=>{if(event.detail==='statistics'){area.querySelector('.listening-statistics').open=true;refreshStats().catch(error=>feedback(error.message));}if(event.detail==='documents')refreshVault().catch(error=>feedback(error.message));};
    root.addEventListener('library-group-change',onGroup);
    const makeButton=(label,operation,args)=>{const b=document.createElement('button');b.className='pref-button';b.type='button';b.textContent=label;b.addEventListener('click',()=>run(operation,args));return b;};
    async function refreshVault(){const result=await action('vaultList');const list=area.querySelector('.vault-list');list.replaceChildren();for(const item of result.books){if(item.status!=='ready')continue;const row=document.createElement('li');const text=document.createElement('span');text.textContent=`${t(item.kind==='audio'?'tools.vaultAudio':'tools.vaultDocument')} · ${item.title}${item.size?' · '+(item.size/1024/1024).toFixed(1)+' MB':''}`;row.append(text,makeButton(t('library.open'),'bookOpen',{id:item.id}),makeButton(t('library.remove'),'bookRemove',{id:item.id}));list.append(row);}if(!list.children.length)list.textContent=t('tools.vaultEmpty');}
    async function refreshStats(args={}){const result=await action('stats',args);const value=result.stats;const minutes=n=>Math.round(n/60);area.querySelector('.stats-summary').textContent=[t('tools.statsToday',{minutes:minutes(value.today.seconds),count:value.today.completed.length}),t('tools.statsWeek',{minutes:minutes(value.weekSeconds),count:value.weekCompleted})].join(' · ');if(document.activeElement!==area.querySelector('.stats-goal')&&!root.getRootNode().activeElement?.matches?.('.stats-goal'))area.querySelector('.stats-goal').value=value.weeklyGoal;const progress=area.querySelector('.stats-progress');progress.max=value.weeklyGoal||1;progress.value=Math.min(value.weeklyGoal,value.weekSeconds/60);progress.hidden=!value.weeklyGoal;const list=area.querySelector('.stats-days');list.replaceChildren();for(const [date,day]of Object.entries(value.days).sort().slice(-7).reverse()){const row=document.createElement('li');row.textContent=t('tools.statsDay',{date,minutes:minutes(day.seconds),count:day.completed.length});list.append(row);}}
    function renderSync(config={}){lastSyncConfig=config;area.querySelector('.sync-enabled').checked=!!config.enabled;area.querySelector('.sync-status').textContent=config.error?t('tools.syncError',{error:config.error}):config.lastSync?t('tools.syncLast',{date:new Date(config.lastSync).toLocaleString(i18n?.locale()||'tr')}):config.enabled?t('tools.syncOn'):t('tools.syncOff');area.querySelector('[data-tool="syncNow"]').disabled=!config.enabled;}
    let lastSyncConfig={};chrome.storage.local.get('syncConfig').then(value=>renderSync(value.syncConfig||{}));
    const onStorage=(changes,scope)=>{if(scope==='local'&&changes.syncConfig)renderSync(changes.syncConfig.newValue);if(scope==='local'&&changes.listeningStats&&area.querySelector('.listening-statistics').open)refreshStats().catch(()=>{});};chrome.storage.onChanged.addListener(onStorage);
    area.querySelector('.sync-enabled').addEventListener('change',event=>run('syncEnable',{enabled:event.target.checked}));
    area.querySelector('.listening-statistics').addEventListener('toggle',event=>{if(event.target.open)refreshStats().catch(error=>feedback(error.message));});
    async function run(name,args={}){try{
      if(name==='statsRefresh'||name==='statsClear'||name==='statsGoal'){await refreshStats(name==='statsClear'?{clear:true}:name==='statsGoal'?{goal:area.querySelector('.stats-goal').value}:{});feedback(t(name==='statsClear'?'tools.statsCleared':'tools.statsUpdated'));return;}

      if(name==='vaultRefresh'){await refreshVault();return;}
      if(name==='siteSave')args={url:context()?.url,settings:settings.current(),theme:globalThis.SesliOkuThemes.current(),colorMode:globalThis.SesliOkuThemes.mode()};
      const result=await action(name,args);if(name==='backup')download(result.backup);feedback(result.message||t('library.done'));if(name==='bookRemove')await refreshVault();
    }catch(error){feedback(error.message);}}
    area.addEventListener('click',event=>{const b=event.target.closest('[data-tool]');if(b)run(b.dataset.tool);});
    area.querySelector('.backup-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error(t("tools.backupTooLarge"));const result=await action('restore',{backup:JSON.parse(await file.text())});feedback(result.message);await refreshVault();}catch(error){feedback(error.message);}finally{event.target.value='';}});
    const renderSites=value=>{const origin=library.siteOrigin(context()?.url);area.querySelector('.site-status').textContent=origin ? (value.sites[origin]?t('tools.siteActive',{origin}):`${origin} · ${t('tools.siteGlobal')}`) : t('tools.siteUnavailable');area.querySelector('[data-tool="siteSave"]').disabled=!origin;const list=area.querySelector('.site-list');list.replaceChildren();for(const key of Object.keys(value.sites)){const row=document.createElement('li');const text=document.createElement('span');text.textContent=key;row.append(text,makeButton(t('tools.resetSite'),'siteRemove',{origin:key}));list.append(row);}};
    const unsubscribe=library.subscribe(renderSites);
    const contextChanged=()=>renderSites(library.current());root.addEventListener('library-context',contextChanged);
    let lastJob='';const unsubscribeJobs=library.subscribe(value=>{const job=JSON.stringify(value.export);if(job!==lastJob){lastJob=job;if(value.export?.status==='done'&&value.export.kind==='offline')refreshVault().catch(()=>{});}});
    action('context').then(()=>{refreshVault().catch(error=>feedback(error.message));}).catch(()=>{});
    // Context is resolved asynchronously by the parent library.
    const contextTimer=setTimeout(()=>{area.querySelector('[data-tool="siteSave"]').disabled=!library.siteOrigin(context()?.url);},300);
    const releaseI18n = i18n?.observe(area) || (() => {});
    const unsubscribeLocale = (i18n?.subscribe(() => {
      renderSync(lastSyncConfig);
      renderSites(library.current());
      refreshStats().catch(() => {});
      refreshVault().catch(() => {});
    })) || (() => {});
    return {dispose(){root.removeEventListener('library-group-change',onGroup);chrome.storage.onChanged.removeListener(onStorage);unsubscribe();unsubscribeJobs();root.removeEventListener('library-context',contextChanged);releaseI18n();unsubscribeLocale();clearTimeout(contextTimer);}};
  }
  globalThis.SesliOkuTools={mount,backup,restore,validateBackup};
})();

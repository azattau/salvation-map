/* global L, fflate, IncidentCore */
'use strict';
const C = IncidentCore, $ = id => document.getElementById(id);
const state = {events:[], index:null, reference:Date.now(), file:null, filter:'all',busy:false,modelReady:false};
const fmt = new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yekaterinburg',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const safeText = (tag,text,className) => { const el=document.createElement(tag); el.textContent=text; if(className) el.className=className; return el; };
const dateInZone = date => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
$('base-date').value = dateInZone(new Date());
function getLocalURL() {
  const url = new URL($('local-url').value.trim());
  if (!['http:','https:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Укажите адрес локального помощника: http://127.0.0.1:8765');
  return url.origin;
}
try { const prefs=JSON.parse(localStorage.getItem('svodka-prefs') || '{}'); if(prefs.url) $('local-url').value=prefs.url; if(prefs.model) $('model-name').value=prefs.model; if(['llm','dictionary'].includes(prefs.engine)) $('engine').value=prefs.engine; } catch { /* storage can be unavailable */ }
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>{$('toast').hidden=true;},5000); }
function setStatus(text,error=false){$('analysis-status').textContent=text;$('analysis-status').classList.toggle('error',error);}
function setBusy(busy){state.busy=busy;$('analyze-btn').disabled=busy||!state.file||!state.index;$('file-input').disabled=busy;$('engine').disabled=busy;$('base-date').disabled=busy;$('analysis-progress').hidden=!busy;}
const map = L.map('map',{zoomControl:false,minZoom:3,preferCanvas:true}).setView([55,58],6);
L.control.zoom({position:'topright'}).addTo(map);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
let tileErrors=0;
tiles.on('tileerror',()=>{ if(++tileErrors>4){$('map-error').textContent='Не удалось загрузить фон карты. Проверьте интернет. Сообщения и журнал остаются доступны.';$('map-error').hidden=false;} });
tiles.on('tileload',()=>{$('map-error').hidden=true;tileErrors=0;});
const markers = L.layerGroup().addTo(map);
function eventTime(event){return event.timestamp===null?'Время не указано':fmt.format(event.timestamp);}
function popupFor(events){
  const el=document.createElement('div'); const first=events[0];
  el.append(safeText('div',events.length>1?`${events.length} СООБЩЕНИЙ В ОДНОМ МЕСТЕ`:'КАРТОЧКА СООБЩЕНИЯ','popup-eyebrow'),safeText('div',first.place,'popup-title'),safeText('div',first.district,'popup-district'));
  for(const event of events.slice().sort((a,b)=>(b.timestamp??-Infinity)-(a.timestamp??-Infinity))){
    const report=safeText('section','','popup-report'); const f=C.freshness(event.timestamp,state.reference);
    const time=safeText('div',eventTime(event),'popup-time'); const dot=document.createElement('i');dot.style.background=f.color;time.prepend(dot);
    report.append(time,safeText('p',event.raw,'popup-text'),safeText('div',`Источник: ${event.source} · ${event.engine}${event.count?' · Объектов: '+event.count:''}`,'popup-meta'));
    if(event.timeAssumed) report.append(safeText('div','Дата задана при импорте; время взято из сообщения.','popup-meta'));
    el.append(report);
  }
  el.append(safeText('div',`${first.method}. Это место сообщения, точное положение события не установлено.`,'popup-method'));
  return el;
}
function drawMarkers(){
  markers.clearLayers();const grouped=new Map();
  for(const e of state.events.filter(e=>e.status==='located')){const key=`${e.lat},${e.lon}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(e);}
  for(const group of grouped.values()){
    const sorted=group.filter(e=>e.timestamp!==null&&e.timestamp<=state.reference).sort((a,b)=>b.timestamp-a.timestamp);
    const event=sorted[0]||group.find(e=>e.timestamp!==null)||group[0];const f=C.freshness(event.timestamp,state.reference);
    const pin=document.createElement('span');pin.className='pin-dot';pin.style.setProperty('--pin-color',f.color);
    const wrap=document.createElement('div');wrap.append(pin);if(group.length>1)wrap.append(safeText('span',String(group.length),'pin-count'));
    const marker=L.marker([event.lat,event.lon],{icon:L.divIcon({className:'event-pin',html:wrap,iconSize:[19,19],iconAnchor:[9,9]}),title:`${event.place}: ${group.length} сообщ., ${f.label}`});
    marker.bindPopup(()=>popupFor(group),{maxWidth:330,minWidth:250,maxHeight:370});marker.addTo(markers);
  }
}
function updateCounts(){$('journal-count').textContent=state.events.length;}
function setReferenceFromEvents(){
  const times=state.events.map(e=>e.timestamp).filter(t=>t!==null&&Number.isFinite(t));
  state.reference=times.length?Math.max(...times):null;
}
function fitEvents(){const coords=state.events.filter(e=>e.status==='located').map(e=>[e.lat,e.lon]);if(coords.length)map.stop().fitBounds(coords,{paddingTopLeft:window.innerWidth>760?[390,60]:[30,40],paddingBottomRight:window.innerWidth>760?[320,80]:[30,100],maxZoom:10,animate:false});else toast('Пока нет сообщений с подтверждённым местом.');}
function installEvents(events,label){state.events=events;updateCounts();setReferenceFromEvents();drawMarkers();renderJournal();$('dataset-label').textContent=label;fitEvents();}
async function loadDemo(){
  const data=await fetch('data/demo.json').then(r=>{if(!r.ok)throw new Error('Не удалось загрузить пример');return r.json();});
  const events=data.map((r,i)=>C.analyzeRecord(r,state.index,{baseDate:$('base-date').value,engine:'Вымышленный пример'},i+1)).filter(Boolean);
  state.file=null;$('file-input').value='';$('file-title').textContent='Выберите или перетащите файл';$('file-subtitle').textContent='TXT, CSV, JSON, DOCX или ZIP · до 10 МБ';$('analyze-btn').disabled=true;
  clearTimeout(state.toastTimer);$('toast').hidden=true;
  installEvents(events,'Демонстрационные данные · вымышленные события');setStatus('Выберите файл для анализа.');
}
function selectFile(file){
  if(state.busy)return;
  if(!file)return;
  if(file.size>10*1024*1024){setStatus('Файл больше 10 МБ. Разделите его на части.',true);return;}
  if(!/\.(txt|csv|json|docx|zip)$/i.test(file.name)){setStatus('Поддерживаются TXT, CSV, JSON, DOCX и ZIP.',true);return;}
  state.file=file;$('file-title').textContent=file.name;$('file-subtitle').textContent=`${(file.size/1024).toFixed(0)} КБ · готов к анализу`;$('analyze-btn').disabled=!state.index;setStatus('Файл выбран. Нажмите «Анализ событий».');
}
function textFromBytes(bytes){const utf=new TextDecoder('utf-8').decode(bytes);return (utf.match(/\uFFFD/g)||[]).length>3?new TextDecoder('windows-1251').decode(bytes):utf;}
function unpack(bytes,filter){
  let total=0;return fflate.unzipSync(bytes,{filter:entry=>{if(!filter(entry.name))return false;total+=entry.originalSize;if(total>30*1024*1024)throw new Error('Распакованные данные превышают 30 МБ.');return true;}});
}
function docxRecords(bytes){
  const archive=unpack(bytes,name=>name==='word/document.xml');if(!archive['word/document.xml'])throw new Error('В DOCX отсутствует текст документа.');
  const xml=new DOMParser().parseFromString(new TextDecoder().decode(archive['word/document.xml']),'application/xml');if(xml.querySelector('parsererror'))throw new Error('Не удалось прочитать XML документа.');
  return Array.from(xml.getElementsByTagNameNS('*','p')).map(p=>Array.from(p.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join('')).filter(s=>s.trim()).map(text=>({text}));
}
async function readInput(file){
  const bytes=new Uint8Array(await file.arrayBuffer());const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='docx')return docxRecords(bytes);
  if(ext==='zip'){
    const content=unpack(bytes,name=>!/(^|\/)(\.|__MACOSX)/.test(name)&&/\.(txt|csv|json|docx)$/i.test(name));
    const names=Object.keys(content).sort((a,b)=>a.localeCompare(b));
    // In the supplied OSM archive reports are primary; coords.txt is a derived file with lost provenance.
    const chosen=names.find(n=>/\/(report|reports|messages)\.txt$/i.test('/'+n))||names.find(n=>/сообщени.*\.docx$/i.test(n))||names.find(n=>!/coords|sett[l]?ments|readme/i.test(n));
    if(!chosen)throw new Error('В архиве не найден файл сообщений. Загрузите report.txt, DOCX, CSV или JSON.');
    setStatus(`Читается ${chosen}…`);
    if(chosen.toLowerCase().endsWith('.docx'))return docxRecords(content[chosen]);
    return C.inputRecords(textFromBytes(content[chosen]),chosen.split('.').pop().toLowerCase());
  }
  return C.inputRecords(textFromBytes(bytes),ext);
}
async function localExtract(record){
  const raw=C.analyzeRecord(record,state.index,{baseDate:$('base-date').value},0)?.raw;
  if(!raw)return record;
  const response=await fetch(getLocalURL()+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw,model:$('model-name').value.trim()}),signal:AbortSignal.timeout(180000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Локальная модель недоступна');
  // Keep trusted source data; model output never supplies coordinates or alters original text.
  const out={...data.result,...record};out.text=raw;return out;
}
async function analyze(){
  if(!state.file||state.busy)return;
  if(!$('base-date').value){setStatus('Выберите дату для сообщений без даты.',true);return;}
  setBusy(true);$('analysis-progress').value=0;
  try{
    const records=await readInput(state.file);if(!records.length)throw new Error('В файле нет сообщений.');if(records.length>10000)throw new Error('Максимум 10 000 сообщений за один импорт.');
    const llm=$('engine').value==='llm';
    if(llm){setStatus('Проверяется подключение к локальной модели…');const r=await fetch(getLocalURL()+'/api/health',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Запустите start-local.cmd и проверьте подключение в настройках.');}
    const events=[];const started=performance.now();
    for(let i=0;i<records.length;i++){
      setStatus(`${llm?'Локальная LLM':'Справочник'} · обработано ${i} из ${records.length}`);
      const record=llm?await localExtract(records[i]):records[i];
      const event=C.analyzeRecord(record,state.index,{baseDate:$('base-date').value,engine:llm?'LLM · '+$('model-name').value:'Справочник'},i+1);if(event)events.push(event);
      $('analysis-progress').value=(i+1)/records.length*100;
      if(!llm&&i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!events.length)throw new Error('Не найдены тексты сообщений. В CSV и JSON используйте поле text, message или «сообщение».');
    installEvents(events,`${state.file.name} · ${llm?'локальная LLM':'разбор по справочнику'}`);
    setStatus(`Готово: ${events.length} сообщений · ${(performance.now()-started>1000)?Math.round((performance.now()-started)/1000)+' с':'менее 1 с'}. Неоднозначные места — в журнале.`);
    if(events.some(e=>e.status==='review'))toast('Некоторым сообщениям нужно уточнить место. Откройте «Проверить».');
  }catch(error){console.error(error);setStatus(error.name==='TimeoutError'?'Модель не ответила вовремя. Проверьте Ollama и повторите анализ.':error.message==='Failed to fetch'?'Локальная LLM не подключена. Запустите start-local.cmd, затем проверьте соединение в настройках.':error.message,true);}
  finally{setBusy(false);}
}
function renderJournal(){
  const root=$('journal-list');root.replaceChildren();const query=C.normalize($('search').value);
  const found=state.events.filter(e=>(state.filter==='all'||e.status===state.filter)&&(!query||C.normalize(`${e.raw} ${e.place||''} ${e.district||''}`).includes(query)));
  if(!found.length){root.append(safeText('div','Нет сообщений по выбранным условиям.','empty-journal'));return;}
  for(const e of found.slice(0,200)){
    const card=safeText('article','','journal-card');const head=document.createElement('header');head.append(safeText('strong',e.place||'Место требует проверки'),safeText('time',eventTime(e)));card.append(head,safeText('p',e.raw));
    card.append(safeText('span',e.status==='located'?(e.district||e.method):e.reason,'badge'+(e.status==='located'?' resolved':'')));
    if(e.status==='located'){const btn=safeText('button','Показать на карте ↗');btn.onclick=()=>{$('journal').hidden=true;map.setView([e.lat,e.lon],12);markers.eachLayer(m=>{const p=m.getLatLng();if(p.lat===e.lat&&p.lng===e.lon)m.openPopup();});};card.append(document.createElement('br'),btn);}
    else{
      const input=document.createElement('input');input.className='search';input.placeholder='Найти место для уточнения';input.setAttribute('aria-label','Поиск населённого пункта для сообщения '+e.id);input.style.marginTop='10px';
      const select=document.createElement('select');select.setAttribute('aria-label','Населённый пункт для сообщения '+e.id);
      const populate=()=>{select.replaceChildren();select.append(new Option('Выберите населённый пункт',''));const q=C.normalize(input.value);const options=q?state.index.entries.filter(p=>C.normalize(p.name+' '+p.district).includes(q)).slice(0,80):(e.candidates||[]);for(const p of options)select.append(new Option(`${p.name} · ${p.district}`,p.id));};
      populate();input.oninput=populate;const resolve=safeText('button','Подтвердить место');resolve.onclick=()=>{const p=state.index.entries.find(x=>x.id===select.value);if(!p){toast('Сначала выберите населённый пункт.');return;}Object.assign(e,{status:'located',lat:p.lat,lon:p.lon,place:p.name,district:p.district,method:'Место подтверждено пользователем',candidates:[]});updateCounts();drawMarkers();renderJournal();};
      card.append(input,select,resolve);
    }
    root.append(card);
  }
  if(found.length>200)root.append(safeText('p',`Показаны первые 200 из ${found.length}. Используйте поиск или скачайте полный JSON.`,'journal-limit'));
}
$('file-input').onchange=e=>selectFile(e.target.files[0]);
$('dropzone').tabIndex=0;$('dropzone').setAttribute('role','button');$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
for(const type of ['dragover','dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.toggle('dragover',type==='dragover');if(type==='drop')selectFile(e.dataTransfer.files[0]);});
$('analyze-btn').onclick=analyze;
$('fit-btn').onclick=fitEvents;$('russia-btn').onclick=()=>map.setView([62,86],3);
function openJournal(filter='all'){state.filter=filter;$('journal').hidden=false;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter));renderJournal();}
$('open-journal').onclick=()=>openJournal();$('close-journal').onclick=()=>{$('journal').hidden=true;};$('search').oninput=renderJournal;
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>openJournal(b.dataset.filter));
$('settings-btn').onclick=()=>{$('settings').showModal();};$('settings').addEventListener('close',()=>{try{const url=getLocalURL();localStorage.setItem('svodka-prefs',JSON.stringify({url,model:$('model-name').value.trim(),engine:$('engine').value}));}catch(e){toast(e.message);}});
$('check-model').onclick=async()=>{try{$('model-status').textContent='Подключение…';const res=await fetch(getLocalURL()+'/api/health',{signal:AbortSignal.timeout(5000)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Ollama недоступна');$('model-status').textContent=`Подключено · доступны: ${data.models.join(', ')||'модели не установлены'}`;}catch{$('model-status').textContent='Не удалось подключиться. Запустите start-local.cmd и убедитесь, что Ollama работает.';}};
$('export-btn').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,mode:'archive',timezone:'Asia/Yekaterinburg',reference:state.reference===null?null:new Date(state.reference).toISOString(),events:state.events},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='svodka-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
window.addEventListener('keydown',e=>{if(e.key==='Escape')$('journal').hidden=true;});
async function loadSettlements(){
  const response=await fetch('data/settlements.json');if(!response.ok)throw new Error('Не удалось загрузить справочник');
  const manifest=await response.json();if(Array.isArray(manifest))return manifest;
  if(manifest.format!=='svodka-settlements-v1'||!Array.isArray(manifest.files))throw new Error('Неизвестный формат справочника');
  const chunks=await Promise.all(manifest.files.map(async file=>{
    if(!/^settlements\/part\d+\.json$/.test(file))throw new Error('Некорректный файл справочника');
    const r=await fetch('data/'+file);if(!r.ok)throw new Error('Не удалось загрузить часть справочника');return r.json();
  }));
  const data=chunks.flat();if(data.length!==manifest.count)throw new Error('Справочник загружен не полностью');return data;
}
loadSettlements().then(data=>{state.index=C.buildIndex(data);setBusy(false);return loadDemo();}).catch(error=>setStatus(error.message,true));

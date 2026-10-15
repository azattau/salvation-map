(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IncidentCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const normalize = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim();
  const stripType = value => normalize(value).replace(/^(деревня|село|город|хутор|поселок|рабочий поселок|станица|д\.|с\.|г\.|п\.)\s*/u, '').trim();
  const districtStem = value => normalize(value).replace(/\s*(муниципальный район|городской округ|район|р-н).*$/u, '').replace(/(ский|ского|ском|скому|ским|ая|ой|ом)$/u, '');
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const delimiter = first.split(';').length > first.split(',').length ? ';' : ',';
    const rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (c === delimiter && !quoted) { row.push(value); value = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = ''; }
      else value += c;
    }
    if (value || row.length) { row.push(value); rows.push(row); }
    if (quoted) throw new Error('В CSV не закрыта кавычка. Проверьте исходный файл.');
    return rows;
  }
  function tabularRecords(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(normalize);
    return rows.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  }
  function field(obj, names) { for (const name of names) if (obj[name] !== undefined && obj[name] !== null && String(obj[name]).trim()) return obj[name]; return null; }
  function inputRecords(text, kind) {
    if (kind === 'json') {
      const data = JSON.parse(text);
      const rows = Array.isArray(data) ? data : (data.events || data.reports || data.messages);
      if (!Array.isArray(rows)) throw new Error('JSON должен содержать массив сообщений или поле events/reports/messages.');
      return rows.map(v => typeof v === 'string' ? {text: v} : Object.fromEntries(Object.entries(v).map(([k, x]) => [normalize(k), x])));
    }
    if (kind === 'csv') return tabularRecords(parseCSV(text));
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(text => ({text}));
  }
  function buildIndex(settlements) {
    const aliases = new Map(), districts = new Map();
    const entries = settlements.map((s, i) => ({...s, id: s.id || String(i), name: stripType(s.name), district: s.district || ''}));
    for (const place of entries) {
      for (const alias of new Set([place.name, ...(place.aliases || []).map(stripType)])) {
        if (alias.length < 3) continue;
        if (!aliases.has(alias)) aliases.set(alias, []);
        aliases.get(alias).push(place);
      }
      const stem = districtStem(place.district);
      if (stem) districts.set(stem, place.district);
    }
    return {entries, aliases, districts};
  }
  function nameOccurrences(text, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const re = new RegExp('(^|[^а-яa-z0-9])(' + escaped + ')(?=$|[^а-яa-z0-9])', 'giu');
    return [...text.matchAll(re)].map(m => ({start: m.index + m[1].length, end: m.index + m[0].length}));
  }
  function locate(text, index, structured = {}) {
    const rawLat = field(structured, ['lat', 'latitude', 'широта']);
    const rawLon = field(structured, ['lon', 'lng', 'longitude', 'долгота']);
    if (rawLat !== null || rawLon !== null) {
      const lat = Number(String(rawLat).replace(',', '.')), lon = Number(String(rawLon).replace(',', '.'));
      if (rawLat !== null && rawLon !== null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
        return {status:'located', lat, lon, place: field(structured, ['place', 'settlement', 'населенный пункт']) || 'Координаты из файла', district: field(structured, ['district', 'район']) || '', method:'Координаты в исходном файле', candidates:[]};
      return {status:'review', reason:'Некорректные или неполные координаты', candidates:[]};
    }
    const norm = normalize(text);
    const structuredPlace = field(structured, ['place', 'settlement', 'населенный пункт', 'населённый пункт']);
    const structuredDistrict = field(structured, ['district', 'район']);
    const candidates = [];
    for (const [alias, places] of index.aliases) {
      if (structuredPlace && stripType(structuredPlace) !== alias) continue;
      if (!structuredPlace && !norm.includes(alias)) continue;
      const occurrences = nameOccurrences(norm, alias);
      if (!occurrences.length && stripType(structuredPlace) !== alias) continue;
      for (const p of places) candidates.push({...p, occurrences, alias});
    }
    const unique = [...new Map(candidates.map(p => [p.id, p])).values()];
    const mentionedDistricts = [...index.districts.keys()].filter(d => new RegExp('(^|[^а-я])' + d + '(?:ский|ского|ском|скому|ским)\\s+(?:муниципальн[а-я]*\\s+)?(?:район[а-я]*|р-н)', 'u').test(norm));
    const explicitStem = districtStem(structuredDistrict);
    let filtered = unique;
    if (explicitStem) filtered = unique.filter(p => districtStem(p.district) === explicitStem);
    else if (mentionedDistricts.length === 1) filtered = unique.filter(p => districtStem(p.district) === mentionedDistricts[0]);
    // A message can mention an origin, a destination, and a sighting. Do not guess which place is the event.
    if (filtered.length === 1) {
      const p = filtered[0];
      const elsewhere = unique.filter(q => q.name !== p.name);
      if (elsewhere.length && !structuredPlace) return {status:'review',reason:'В тексте упомянуто несколько мест',candidates:unique.slice(0, 100)};
      return {status:'located',lat:p.lat,lon:p.lon,place:p.name,district:p.district,method:'Центр населённого пункта по справочнику',candidates:[]};
    }
    return {status:'review',reason:filtered.length > 1 ? 'Несколько подходящих населённых пунктов' : (unique.length ? 'Название и район не согласуются' : 'Место не найдено в справочнике'),candidates:(filtered.length ? filtered : unique).slice(0, 100)};
  }
  function parseTime(text, record, baseDate) {
    const supplied = field(record, ['timestamp', 'datetime', 'дата и время', 'time', 'время', 'date', 'дата']);
    if (typeof supplied === 'number' && Number.isFinite(supplied) && supplied >= 0 && supplied <= 8640000000000000) return {timestamp:supplied,timeAssumed:false};
    const source = supplied !== null ? String(supplied) : text;
    const iso = source.match(/\b(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?/);
    const ruDate = source.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/) || text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
    const rawISODate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const clock = source.replace(/\b\d{2}\.\d{2}\.\d{4}\b/g,'').match(/(?:^|[^\d])(\d{1,2})\s*[:.\-]\s*(\d{2})(?=$|[^\d])/);
    const time = iso ? [iso[2], iso[3]] : clock ? [clock[1], clock[2]] : null;
    if (!time || Number(time[0]) > 23 || Number(time[1]) > 59) return {timestamp:null,timeAssumed:false};
    const date = iso ? iso[1] : ruDate ? `${ruDate[3]}-${ruDate[2]}-${ruDate[1]}` : rawISODate ? rawISODate[1] : baseDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return {timestamp:null,timeAssumed:false};
    const zone = iso?.[5] || '+05:00';
    const value = `${date}T${time[0].padStart(2,'0')}:${time[1]}:00${zone}`;
    const timestamp = Date.parse(value);
    const day = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) return {timestamp:null,timeAssumed:false};
    return {timestamp,timeAssumed:!iso && !ruDate && !rawISODate};
  }
  function analyzeRecord(record, index, options, number) {
    const raw = String(field(record,['text','message','сообщение','текст','description','описание','raw']) || '').trim();
    if (!raw) return null;
    const location = locate(raw, index, record);
    const time = parseTime(raw, record, options.baseDate);
    const type = field(record,['type','тип события']) || (/дым|пожар|возгоран/iu.test(raw) ? 'Пожар / задымление' : /вод|затоп|подтоп/iu.test(raw) ? 'Подтопление' : /электр|отключен/iu.test(raw) ? 'Инфраструктура' : 'Сообщение');
    const count = field(record,['count','количество']) || raw.match(/\b(\d+)\s*(?:объект|бпла|беспилотник)/iu)?.[1] || null;
    return {id:`evt-${number}`,raw,...location,...time,type,count,source:field(record,['source','источник']) || (/112/u.test(raw)?'112':/еддс/iu.test(raw)?'ЕДДС':'Не указан'),engine:options.engine || 'Справочник'};
  }
  function freshness(timestamp, reference) {
    if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return {key:'unknown',color:'#7b8499',label:'Время не указано'};
    const age = (reference - timestamp) / 60000;
    if (age < -1) return {key:'future',color:'#8b5cf6',label:'Позже выбранного момента'};
    if (age <= 15) return {key:'fresh',color:'#ef6358',label:'До 15 минут'};
    if (age <= 60) return {key:'recent',color:'#e9a73b',label:'15–60 минут'};
    if (age <= 180) return {key:'old',color:'#4d9be9',label:'1–3 часа'};
    return {key:'archive',color:'#8796ad',label:'Более 3 часов'};
  }
  return {normalize,stripType,districtStem,parseCSV,tabularRecords,inputRecords,buildIndex,locate,parseTime,analyzeRecord,freshness};
});

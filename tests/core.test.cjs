const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../dist/core.js');
const index=C.buildIndex([
  {id:'1',name:'село Михайловка',district:'Уфимский муниципальный район',lat:54.8,lon:55.8},
  {id:'2',name:'село Михайловка',district:'Дуванский муниципальный район',lat:55.8,lon:58.2},
  {id:'3',name:'город Уфа',district:'городской округ город Уфа',lat:54.74,lon:55.96},
  {id:'4',name:'деревня Новая Уфа',district:'Уфимский муниципальный район',lat:54.9,lon:56.1},
]);
test('CSV preserves quoted commas, newlines, and escaped quotes',()=>{
  assert.deepEqual(C.parseCSV('text,time\n"дым, у дороги\nдва звонка","09:10"\n"сказал ""дым""",10:11'),[['text','time'],['дым, у дороги\nдва звонка','09:10'],['сказал "дым"','10:11']]);
  assert.equal(C.inputRecords('сообщение;время\n"дым, село";09:10','csv')[0]['сообщение'],'дым, село');
});
test('duplicate settlement names require review without a district',()=>assert.equal(C.locate('Михайловка, задымление',index).status,'review'));
test('district resolves identical place names',()=>{
  const e=C.locate('село Михайловка Уфимского района, задымление',index);
  assert.equal(e.status,'located');assert.equal(e.lat,54.8);
});
test('substring matches are not locations',()=>assert.equal(C.locate('Пожар в Уфалейском районе',index).status,'review'));
test('a city mention is not misread as a district',()=>{
  const ix=C.buildIndex([{id:'1',name:'г. Стерлитамак',district:'Городской округ город Стерлитамак',lat:53.6,lon:55.9},{id:'2',name:'село Пример',district:'Стерлитамакский муниципальный район',lat:53.5,lon:55.8}]);
  assert.equal(C.locate('10:10 г. Стерлитамак: дым',ix).status,'located');
});
test('multiple places in narrative are not automatically assigned',()=>assert.equal(C.locate('Уфа и Михайловка: получены сообщения',index).status,'review'));
test('structured coordinates are validated including partial values',()=>{
  assert.equal(C.locate('дым',index,{lat:'54.7',lon:'55.9'}).status,'located');
  assert.equal(C.locate('дым',index,{lat:94,lon:55}).status,'review');
  assert.equal(C.locate('дым',index,{lat:54}).status,'review');
});
test('times use an explicit import date and fixed UTC+5',()=>{
  const e=C.parseTime('09-28 задымление',{},'2026-10-15');
  assert.equal(e.timestamp,Date.parse('2026-10-15T09:28:00+05:00'));assert.equal(e.timeAssumed,true);
  assert.equal(C.parseTime('15.10.2026 12:30 сообщение',{},'2025-01-01').timestamp,Date.parse('2026-10-15T12:30:00+05:00'));
  assert.equal(C.parseTime('15.10.2026 12:30 сообщение',{time:'12:30'},'2025-01-01').timestamp,Date.parse('2026-10-15T12:30:00+05:00'));
  assert.equal(C.parseTime('09:28',{},'2026-02-31').timestamp,null);
  assert.equal(C.parseTime('24:61',{},'2026-10-15').timestamp,null);
  assert.equal(C.parseTime('время неизвестно',{},'2026-10-15').timestamp,null);
});
test('freshness includes missing, future, and threshold times',()=>{
  const ref=Date.now();assert.equal(C.freshness(null,ref).key,'unknown');assert.equal(C.freshness(ref+10*60000,ref).key,'future');
  assert.equal(C.freshness(ref-15*60000,ref).key,'fresh');assert.equal(C.freshness(ref-60*60000,ref).key,'recent');assert.equal(C.freshness(ref-181*60000,ref).key,'archive');
});
test('repeated reports remain separate and exports can be reimported',()=>{
  const rows=C.inputRecords('09:10 Уфа дым\n09:10 Уфа дым','txt');assert.equal(rows.length,2);
  const e=C.analyzeRecord(rows[0],index,{baseDate:'2026-10-15'},1);assert.equal(e.status,'located');
  const [roundtrip]=C.inputRecords(JSON.stringify({events:[e]}),'json');const actual=C.analyzeRecord(roundtrip,index,{baseDate:'2025-01-01'},1);
  assert.equal(actual.raw,e.raw);assert.equal(actual.timestamp,e.timestamp);assert.equal(actual.lat,e.lat);
});

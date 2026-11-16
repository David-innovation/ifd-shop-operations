'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../lib/cut-audit'),P=require('../lib/cutting-print');
test('each cut keeps its own cutter, sizes, time, recorder and plan reference',()=>{
 const line={title:'Zenith Caribou',qty:65,w:4,cuts:[{label:'CUT 1',length:3.9,width:4,pieces:[{name:'Bedroom'},{name:'Landing'}]},{label:'CUT 2',length:2.6,width:4,room:'Stairs'}]},at='2026-11-16T16:00:00Z';
 const records=A.records(line,['Sam','Alex'],'Office',at,{id:'shop',name:'Shared shop'},'W4-01','approved-plan');
 assert.deepEqual(records.map(r=>r.byName),['Sam','Alex']);assert.equal(records[0].rooms,'Bedroom, Landing');assert.equal(records[1].length,2.6);assert.equal(records[0].planSignature,'approved-plan');assert.equal(records[0].recordedBy,'shop');assert.equal(records[0].at,at);
 assert.throws(()=>A.records(line,['Sam',''],'Office',at,{id:'shop'},'W4-01'),/cut 2/);assert.throws(()=>A.records(line,null,'',at,{id:'shop'},'W4-01'),/cut 1/);
 const j={ref:'PRACTICE',lines:{a:{...line,cutBy:'Sam, Alex',cutAt:at,cutRecords:records}},cuttingApproval:{signature:'approved-plan',plan:{area:26,bins:[{id:'CUT 1',w:400,l:390,pieces:[]}]}}};
 assert.equal(A.history(j).length,2);const print=P.render(j);assert.match(print,/Recorded carpet cutters/);assert.match(print,/Sam/);assert.match(print,/Alex/);assert.match(print,/16\/11\/2026/);assert.match(print,/W4-01/);
});
test('old cut records retain the original name and uncut pieces are never attributed',()=>{const rows=A.history({lines:{a:{title:'Carpet',qty:39,w:4,cutBy:'Sam',cutAt:'2026-11-16T16:00:00Z'},b:{title:'Uncut',qty:20,w:4}}});assert.equal(rows.length,1);assert.equal(rows[0].byName,'Sam');assert.equal(rows[0].length,3.9);});

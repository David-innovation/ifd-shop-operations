'use strict';
// Read-only illustration attached to an existing practice job; never a ledger entry.
function example(st,u){
 if(u?.role!=='owner')throw Object.assign(Error('Owner access only.'),{status:403});
 const preferred='ZZ-HOUSE-PRACTICE-'+u.id;
 const jobs=st.list('jobs').filter(r=>r.data.test===true&&/^ZZ/i.test(r.id));
 const source=jobs.find(r=>r.id===preferred)||jobs.find(r=>/HOUSE-PRACTICE/.test(r.id));
 if(!source)return null;
 return {sourceJobId:source.id,ref:source.data.ref||source.id,customer:source.data.customer?.name||'David’s practice job',practice:true,
  note:'Illustrative figures linked to your practice job. This does not change its quote, stock, payments or diary. None of these amounts enters the real totals. All example buying costs are made up; preparation costs and the £5/m² labour rate remain unconfirmed.',
  rows:[
   {label:'Flooring & accessories',gross:880,net:733.34,cost:500,contribution:233.34,note:'Illustrative material cost excluding VAT'},
   {label:'Plywood preparation · 20 m²',gross:280,net:233.33,cost:160,contribution:73.33,note:'Example only: £60 plywood + £100 labour (20 m² × provisional £5)'},
   {label:'Fitting arrangement & support',gross:30,net:25,cost:0,contribution:25,note:'Included in the £470 fitting package; £440 remains for the fitter'},
   {label:'Delivery',gross:25,net:20.83,cost:10,contribution:10.83,note:'Illustrative £10 direct delivery cost'}
  ],shopGross:1215,shopNet:1012.50,cost:670,contribution:342.50,customerTotal:1655,
  fitter:{name:source.data.fitter||'Practice fitting team',direct:440,prepFromShop:100,total:540,note:'£440 paid by the customer for fitting, plus an illustrative £100 prep labour payment from the shop. The £100 is already deducted in prep costs above. No payment is recorded or requested.'}
 };
}
module.exports={example};
'use strict';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(text){
 let small=false;
 const lines=String(text).split('\n').map(line=>{
  if(line==='Helpful fitting information')small=true;
  if(!line)return '<div style="height:12px"></div>';
  const heading=['Your job confirmation','Your flooring and agreed work','Payment','Before we arrive','Helpful fitting information'].includes(line);
  return '<'+(heading?'h2':'p')+' style="margin:0 0 8px;font-size:'+(heading?(small?'15':'19'):(small?'14':'16'))+'px;line-height:1.55;color:#242424">'+esc(line)+'</'+(heading?'h2':'p')+'>';
 }).join('');
 return '<!doctype html><html><body style="margin:0;background:#f5f4f1;font-family:Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:28px;background:#fff;border-top:6px solid #bc1627">'+lines+'</main></body></html>';
}
module.exports={html};

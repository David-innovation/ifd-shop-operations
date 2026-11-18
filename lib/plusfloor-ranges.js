'use strict';
// PlusFloor Book No.2 2026, received 10 November 2026. Trade costs exclude VAT.
// Only glue-down and rigid click ranges are authorised. Loose lay and carpet tiles excluded.
const rows=[];
function add(range,pattern,cost,coverage,dimensions,items,click=false){
 for(const [code,colour] of items){rows.push({id:'plusfloor-'+code.toLowerCase(),supplier:'PlusFloor',code,
 name:range+' '+colour+' — '+pattern,colour,finish:colour,category:'lvt',type:click?'SPC click vinyl':'LVT glue-down',
 pattern,dimensions,coverage,cost,unit:'m²',sheetDate:'2026',roll:false,widths:[],ready:true,pricingVerified:true,
 sellingPrice:Math.round(cost*120+(click?1500:2000))/100,formula:'Trade cost per m² × 1.20 + £'+(click?15:20)+'/m²',
 stockStatus:'Not counted — supplier range',integratedUnderlay:click,note:click?'Integrated underlay included.':''});}
}
const vero=[['7100','Florence'],['7102','Pompeii'],['7104','Venice'],['7106','Portofino'],['7108','Catania'],['7110','Tuscany'],['7112','Sorrento'],['7114','Milan'],['7116','Umbria'],['7118','Parma']];
const codes=(items,suffix='')=>items.map(([c,n])=>['PLF'+c+suffix,n]);
add('Vero','Plank',15.95,4.13,'1227 x 187 x 2.5mm',codes(vero,'G'));
add('Vero','Herringbone',16.95,.87,'380 x 95 x 2.5mm',codes(vero,'GH'));
add('Vero','Chevron',18.95,1,'538 x 117 x 2.5mm',codes(vero,'GC'));
add('Diamond','Panel',20.95,4.44,'608 x 608 x 2.5mm',codes([['6900','Pompeii'],['6901','Milan'],['6902','Sorrento'],['6903','Umbria']]));
const versailles=[['7000','Lyon'],['7002','Marseilles'],['7004','Dijon'],['7006','Bordeaux']];
add('Versailles','Panel',20.95,4.46,'610 x 610 x 2.5mm',codes(versailles));
add('Versailles','Border plank',15.95,4.13,'1227 x 187 x 2.5mm',codes(versailles,'G'));
const formation=[['4272','Glacial Heather'],['4280','Italian Lime'],['4252','Pastel Blanc'],['4254','French Loft'],['4262','Silvery Clay'],['4274','Prairie Jute'],['4268','Burnt Cocoa'],['4278','Pitted Magma']];
add('Formation','Plank',15.95,3.62,'1320 x 196 x 2.5mm',codes([...formation,['4260','Pure Oyster']],'G'));
add('Formation','Herringbone',17.95,2.4,'632 x 158 x 2.5mm',codes([...formation,['4264','Blanched Carbon']],'GH'));
add('Nature’s Core Terracotta','Square',16.95,4.46,'610 x 610 x 2.5mm',codes([['7201','Claro'],['7203','Medio'],['7205','Oscuro']]));
add('Nature’s Core Terracotta','Briqué herringbone',17.95,.87,'380 x 95 x 2.5mm',codes([['7200','Claro'],['7202','Medio'],['7204','Oscuro']]));
add('Terrazzo Glue Down','Square',16.95,4.46,'610 x 610 x 2.5mm',codes([['2579','Venetian Terrazzo'],['2626','Copper Fleck'],['2624','Avid Mist'],['2620','Bold Blush'],['2622','Icy Freeze']]));
add('Nature’s Core Stone','Square',15.95,4.46,'610 x 610 x 2.5mm',codes([['2581','Silestone'],['2582','Rocksalt'],['2583','Quartzite'],['2584','Opal'],['2585','Sable Stone'],['2586','Dolomite']]));
const shush=[['7006','Bordeaux'],['7108','Catania'],['4315','Cashmere'],['7102','Pompeii'],['7112','Sorrento']];
add('SHUSH!','Plank',19.95,2.75,'1227 x 187 x 3.7mm',codes(shush,'SH'));
add('SHUSH!','Herringbone',21.95,1.13,'595 x 119 x 3.7mm',codes(shush,'SHB'));
const maverick=[['3080','Cliff'],['3082','Dune'],['3084','Bay'],['3086','Marina'],['3088','Crest'],['3090','Harbour'],['3092','Port'],['3094','Cove']];
add('Maverick','Plank',21.95,1.95,'1234 x 198 x 6mm',codes(maverick),true);
add('Maverick','Herringbone',24.95,1.31,'640 x 128 x 6mm',codes(maverick.slice(0,4),'CH'),true);
const elements=[['5201','Nickel Oak'],['5202','Mercury Oak'],['5203','Iron Oak'],['5204','Calcium Oak'],['5205','Uranium Oak'],['5206','Actinium Oak'],['5207','Copper Oak'],['5208','Barium Oak'],['5209','Radium Oak']];
add('Elements','Plank',18.95,2.5,'1220 x 228 x 5mm',codes(elements),true);
add('Elements','Herringbone',19.95,1.8,'750 x 150 x 5mm',codes(elements.slice(0,7),'CH'),true);
module.exports={list:()=>rows.map(r=>({...r,widths:[]}))};


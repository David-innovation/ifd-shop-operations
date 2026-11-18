'use strict';
// Lanca May 2026 sheet; Harry's 24 July email confirms standholder pack rates.
// David approved cost + VAT + £20/m² on 18 November 2026. No stock counts inferred.
const rows=[];
function add(group,pattern,cost,coverage,dimensions,wearLayer,bevel,packsPerPallet,palletArea,items){
 for(const [colour,finish] of items)rows.push({
  id:'lanca-'+group+'-'+colour.toLowerCase().replace(/[^a-z0-9]+/g,'-'),supplier:'Lanca',
  name:colour+' — '+pattern+' — '+wearLayer+'mm wear layer',colour,finish,pattern,
  category:'lvt',type:'LVT glue-down',dimensions,wearLayer,bevel,coverage,packsPerPallet,palletArea,
  cost,sellingPrice:Math.round(cost*120+2000)/100,formula:'Standholder pack-rate cost per m² × 1.20 + £20/m²',
  unit:'m²',sheetDate:'2026-05',roll:false,widths:[],ready:true,pricingVerified:true,
  integratedUnderlay:false,stockStatus:'Not counted — supplier range',
  palletQuantityCheck:packsPerPallet&&Math.abs(coverage*packsPerPallet-palletArea)>.02?'Supplier sheet pallet area differs from pack coverage × pack count. Confirm before ordering a pallet.':'',
  note:'Glue-down LVT. Standholder pack pricing; 100m²+ purchasing rate requires supplier confirmation.'
 });
}
const wood=['Invisible Scandi Oak','Beige Brown Oak','Golden Oak','Ash Brown Oak','Rich Brown Oak','Soft Natural Oak','Light Brown Oak','Warm Rustic Oak','Smokey Brown Oak','Rich Heritage Oak'];
const pair=(names,finishes)=>names.map((n,i)=>[n,finishes[i]]);
add('standard-plank','Straight plank',12.99,3.90,'228.6 x 1219.2 x 2.5mm',.55,'Micro',55,214.5,pair(['Summer Siesta','Morning Breeze','Honey Drizzle','Slow Morning','Coffee Break','Light Touch','Sunday Brunch','Clocked Off','Cinnamon Dust','After Dark'],wood));
add('standard-herringbone','Herringbone',13.99,3.34,'76.2 x 457.2 x 2.5mm',.55,'Square',64,213.76,pair(['Spring Clean','Snooze Mode','Sunny Side Up','Overnight Oats','Double Espresso','Sun Trap','Sweet Tooth','Cosy Corner','Maple Morning','Nightcap'],wood));
add('tile','Tile',13.99,2.97,'304.8 x 609.6 x 2.5mm',.55,'Micro',72,213.84,pair(['Snowfall','Soft Dusk','Stargazing','Night Sky'],['Marbled White Stone','Pebble Grey','Grey Stone Effect','Grey Slate Effect']));
const premium=['Warm Brown Oak','Natural Sand Oak','Gold Brown Oak','Light Natural Oak','Pale Grey Oak'];
add('premium-plank','Straight plank',14.99,3.62,'236.6 x 1532 x 3mm',.7,'Micro',47,170.14,pair(['Bedtime Story','Power Nap','Sunday Roast','Slow Dance','Sugar Rush'],premium));
add('premium-herringbone','Herringbone',15.99,3.62,'150 x 750 x 3mm',.7,'Micro',47,169.2,pair(['Sticky Toffee','Afterglow','Firelight','Date Night','Winter Glow'],premium));
add('chevron','Chevron',15.99,3.37,'158 x 710 x 3mm',.7,'Square',51,171.87,pair(['Summer Solstice','Hot Cocoa','Midsummer Eve','Baby Steps','Sugar Rush'],['Light Brown Oak','Classic Brown Oak','Warm Neutral Oak','Vintage Grey Oak','Pale Grey Oak']));
add('basket-weave','Basket weave',15.99,3.92,'190.5 x 190.5 x 2.5mm',.55,'Square',null,null,pair(['Crowd Pleaser','Daydream','Sunny Spell','Last Chapter','Slow Roasted','Warm Welcome','Golden Hour','Nutmeg Haze','Ginger Shot','Housewarming'],wood));
module.exports={list:()=>rows.map(r=>({...r,widths:[]}))};

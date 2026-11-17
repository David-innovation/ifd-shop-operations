'use strict';
// Owner-supplied Cormar sheet, headed 7 December 2026. Cut-length costs per m².
const costs=[['Apollo Plus',9.48],['Apollo Elite',11.39],['Primo Textures',9.87],['Primo Plus',10.19],['Primo Naturals',10.63],['Primo Tweeds',13.19],['Primo Ultra',14.01],['Primo Grande',15.14],['Kingston Classic',10.01],['Kingston Elite',11.58],['Inglewood Saxony',10.45],['Zenith',11.85],['Riva',13.37],['Silken Serenity',12.13],['Trinity',13.75],['Sensation Original',14.54],['Aurora',13.50],['Pembroke',17.20],['Woodland Heathers Elite',16.25],['Woodland Heathers Deluxe',19.08],['Natural Berber Twist Elite',18.37],['Natural Berber Twist Deluxe',21.28],['Hampstead Supreme',18.66],['Hampstead Deluxe',21.71],['Pimlico',17.13],['Malabar',16.28],['Fairisle',22.48],['Trilogy',22.25]];
const sell=c=>Math.round((Math.round(c*100)*120/100+1000))/100;
function list(){return costs.map(([name,cost])=>({id:'cormar-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),supplier:'Cormar',name,cost,sellingPrice:sell(cost),unit:'m²',sheetDate:'2026-12-07',formula:'Cut-length cost × 1.20 + £10/m²',stockStatus:'Not counted — supplier range'}));}
function all(){return list().map(r=>({...r,category:'carpet',type:'Carpet roll',roll:true,widths:[4,5],ready:true})).concat(require('./furlong-ranges').list(),require('./abingdon-ranges').list());}
module.exports={list:all,sell};

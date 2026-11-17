'use strict';
module.exports=(j,r,L)=>({carpet:L.specOf(r)?.floor==='carpet',widths:L.roomWidths(j,r)||[],roomNames:Object.fromEntries(L.roomsOf(j).map(x=>[x.k,x.name]))});


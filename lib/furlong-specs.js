'use strict';
// Verified against Furlong product pages and technical sheets, 16 November 2026.
// Missing specifications remain unavailable for automatic calculation.
const carpetGroups={
 avondale:['Avondale Heathers','Avondale Plains'],bliss:['Bliss','Bliss Comfort'],carefree:['Carefree Twist','Carefree Ultra'],chiltern:['Chiltern'],duchesse:['Duchesse'],elegance:['Elegance'],enchantment:['Enchantment Elite','Enchantment Luxe','Enchantment Twist'],'essential-twist-saxony':['Essential Saxony','Essential Twist'],'fairway-2':['Fairway'],inspiration:['Inspiration'],iona:['Iona'],provence:['Provence Classic','Provence Deluxe'],revelation:['Revelation'],'satisfaction-2':['Satisfaction Moods','Satisfaction Ultra'],timeless:['Timeless Classic','Timeless Deluxe'],'trident-plain-heathers':['Trident Heathers','Trident Plains'],'trident-tweed':['Trident Tweed'],veneto:['Veneto'],'woodland-woodland-supreme':['Woodland','Woodland Supreme']
};
const specs={};
for(const [slug,names] of Object.entries(carpetGroups))for(const name of names)specs[name]={widths:[4,5],source:'https://www.furlongflooring.com/flooring/carpet/'+slug};
for(const [name,slug] of [['Gobi','gobi'],['Mojave','mojave'],['Bedford','bedford'],['Primavera','primavera-2']])specs[name]={widths:[4],source:'https://www.furlongflooring.com/flooring/carpet/'+slug};
const vinyl={'Artisan II Vinyl':'artisan-ii','Bonita Vinyl':'bonita','Charisma II Vinyl':'charisma-ii','Cirrus IV Vinyl':'cirrus-iv','Essential II Vinyl':'essential-ii','Goliath Vinyl':'tarkett-goliath','Gripstar Tex Vinyl':'tarkett-gripstar-tex','Homestyle Vinyl':'tarkett-homestyle','Oakland Vinyl':'oakland','Rhinofloor Super Deluxe Vinyl':'tarkett-rhinofloor-super-deluxe','Rhinofloor XL-Tex Vinyl':'rhinofloor-xl-tex','Signature Vinyl':'signature','Texstar Vinyl':'tarkett-texsar','Versatility III Vinyl':'versatility-iii'};
for(const [name,slug] of Object.entries(vinyl))specs[name]={widths:[2,3,4],source:'https://www.furlongflooring.com/flooring/vinyl/'+slug};
for(const [name,coverage,file] of [['Elite XL Unifit',1.875,'Elite-XL.pdf'],['Fusion Laminate',1.899,'Fusion.pdf'],['Neptune Laminate',2.179,'Neptune.pdf'],['River Laminate',1.9,'River.pdf'],['Urban',1.899,'Urban-new-colours-Copy_2026-11-04-111749_sdpv.pdf'],['Manor Herringbone 8mm 2023',1.179,'Manor.pdf'],['Aurora Dryback Herringbone Plank',2.4,'Aurora_2026-10-28-113957_zmfv.pdf'],['Aurora Dryback Medium Tile',4.86,'Aurora_2026-10-28-113957_zmfv.pdf'],['Aurora Dryback Plank',3.62,'Aurora_2026-10-28-113957_zmfv.pdf'],['Aurora Dryback Square Tile',3.4,'Aurora_2026-10-28-113957_zmfv.pdf'],['Sirona Dryback Plank',4.66,'Sirona_2026-10-28-114048_ziya.pdf'],['Sirona Dryback Tiles',3.9,'Sirona_2026-10-28-114048_ziya.pdf']])specs[name]={coverage,source:'https://files.flooring-assets.co.uk/production/files/'+file};
specs['Carina']={formats:[{name:'Plank',coverage:3.62},{name:'Tile',coverage:3.47}],source:'https://files.flooring-assets.co.uk/production/files/Carina_2026-10-28-114024_wqov.pdf'};
specs['Taunus Laminate']={note:'Supplier lists 1.974–2.245 m² per pack; confirm the selected colour’s pack label.'};
specs['Sunex']={note:'Supplier lists pallet-only supply; confirm order minimum and pack coverage.'};
specs['Universal Clic']={coverage:2.888,source:'https://files.flooring-assets.co.uk/production/files/Universal-Clic-Planks.pdf'};
module.exports=specs;

'use strict';
document.addEventListener('DOMContentLoaded',()=>{
 function attach(){for(const heading of document.querySelectorAll('h2,h3')){if(!/^(Order now — check supplier details|Review supplier order|Deliveries)$/.test(heading.textContent.trim()))continue;const host=heading.parentElement;if(host.querySelector('[data-buying-link]'))continue;const a=document.createElement('a');a.dataset.buyingLink='1';a.href='/buying-comparison';a.target='_blank';a.rel='noopener';a.textContent='Compare roll / pallet buying costs before ordering';a.style.cssText='display:block;padding:12px;color:#ffcf75';host.append(a);}}
 new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});attach();
});

/* Product identity, independent of the owner. No market data is transformed. */
(() => {
 const brand=Object.freeze({name:'Still',tagline:'Clarity before capital.',status:'chosen identity'});
 globalThis.ProductBrand=brand;
 if(typeof document==='undefined')return;
 function mount(){
  document.querySelectorAll('[data-product-name]').forEach(node=>{node.textContent=brand.name;});
  document.querySelector('[data-product-explore]')?.addEventListener('click',event=>{
   event.preventDefault();const target=document.querySelector('#mainResearchMount');
   target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
   const search=target?.querySelector('input[name=search]');search?.focus({preventScroll:true});
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

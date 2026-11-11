'use strict';
/* A stand-in for Shopify for the tests: hands out keys the way the real one does and answers the questions this system asks. Made-up people only. */
const DOMAIN = 'innovationflooring.myshopify.com';
const resp = (status, obj) => ({ok:status >= 200 && status < 300, status:status, json:async () => obj, text:async () => JSON.stringify(obj)});
function make(){
  const state = {tokens:0, calls:[], expireNext:false, down:false, avail:36, drafts:0, docs:{}, orders:0};
  /* drafts this system has made, and what shop staff then do with them in Shopify's own admin: make the order, take payment, send the goods */
  const priceOf = id => id === 'gid://shopify/ProductVariant/701' ? 20.18 : 0;
  function totalOf(input){
    let t = 0;
    (input.lineItems || []).forEach(it => {
      let unit = it.originalUnitPriceWithCurrency ? Number(it.originalUnitPriceWithCurrency.amount) : it.priceOverride ? Number(it.priceOverride.amount) : priceOf(it.variantId);
      if (it.appliedDiscount && it.appliedDiscount.valueType === 'PERCENTAGE') unit = unit * (1 - Number(it.appliedDiscount.value) / 100);
      t += unit * (Number(it.quantity) || 0);
    });
    if (input.appliedDiscount && input.appliedDiscount.valueType === 'FIXED_AMOUNT') t -= Number(input.appliedDiscount.value) || 0;
    return Math.round(t * 100) / 100;
  }
  const money = n => ({shopMoney:{amount:Number(n).toFixed(2)}});
  const seenOrder = o => ({id:o.id, name:o.name, displayFulfillmentStatus:o.fulfilled ? 'FULFILLED' : 'UNFULFILLED', displayFinancialStatus:o.paid ? 'PAID' : 'PENDING', cancelledAt:o.cancelled ? '2026-11-10T10:00:00Z' : null,
    currentTotalPriceSet:money(o.total), totalReceivedSet:money(o.paid ? o.total : 0), totalOutstandingSet:money(o.paid ? 0 : o.total)});
  const docOf = name => Object.values(state.docs).find(d => d.name === name || d.id === name);
  state.staff = {
    addDraft(total){ state.drafts++; const id = 'gid://shopify/DraftOrder/' + (9000 + state.drafts); state.docs[id] = {id:id, name:'#D' + state.drafts, status:'OPEN', total:total, input:null, order:null}; return {id:id, name:'#D' + state.drafts, num:String(9000 + state.drafts)}; },
    makeOrder(name, paid){ const d = docOf(name); state.orders++; d.status = 'COMPLETED'; d.order = {id:'gid://shopify/Order/' + (6000 + state.orders), name:'#' + (3000 + state.orders), total:d.total, paid:!!paid, fulfilled:false, cancelled:false}; return d.order; },
    markPaid(name){ docOf(name).order.paid = true; }, fulfil(name){ docOf(name).order.fulfilled = true; }, setTotal(name, total){ const d = docOf(name); d.total = total; if (d.order) d.order.total = total; }
  };
  const order = {id:'gid://shopify/Order/5001', name:'#2001', createdAt:'2026-11-09T19:53:06Z', displayFinancialStatus:'PAID', displayFulfillmentStatus:'UNFULFILLED', cancelledAt:null, tags:['packs-reserved'], email:'alex@example.com', phone:null,
    totalPriceSet:{shopMoney:{amount:'50.0'}}, totalOutstandingSet:{shopMoney:{amount:'0.0'}}, customer:{id:'gid://shopify/Customer/9', displayName:'Alex Sample'}, shippingAddress:null,
    customAttributes:[{key:'Quote reference', value:'QT-1'}, {key:'Quote estimated total', value:'£282.52'}],
    lineItems:{nodes:[{title:'£50 Order Deposit', variantTitle:'Collection from Clydebank', quantity:1, variant:{id:'gid://shopify/ProductVariant/5', product:{productType:'deposit'}},
      customAttributes:[{key:'Customer name', value:'Alex Sample'}, {key:'Telephone', value:'07700 900123'}, {key:'Postcode', value:'G64 1AA'}, {key:'Flooring product', value:'Royale Oak 12mm Herringbone Laminate'}, {key:'Pack coverage', value:'1.836 m2 per pack'},
        {key:'Room 1 — Living room', value:'5m x 4.6m = 23m2, 2 doorways'}, {key:'_reserve_variant_id', value:'701'}, {key:'_reserve_packs', value:'14'}, {key:'Fitting requested', value:'No — supply only'}, {key:'How you will receive your flooring', value:'Collect from Clydebank'}]}]}};
  const variant = () => ({id:'gid://shopify/ProductVariant/701', title:'Default Title', sku:null, price:'20.18', inventoryQuantity:state.avail, inventoryPolicy:'DENY', rollNumber:null, rollWidth:null, rollLocation:null, rollStatus:null,
    inventoryItem:{id:'gid://shopify/InventoryItem/701', tracked:true, inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1', name:'South Elgin Place'}, quantities:[{name:'available', quantity:state.avail}, {name:'on_hand', quantity:state.avail}, {name:'committed', quantity:0}, {name:'reserved', quantity:0}]}]}},
    product:{id:'gid://shopify/Product/70', title:'Royale Oak 12mm Herringbone Laminate', productType:'laminate flooring', status:'ACTIVE', coverage:{value:'1.836'}, ppm:null}});
  const roll = (n, w, avail) => ({id:'gid://shopify/ProductVariant/' + n, title:'Roll R-' + n + ' · ' + w + 'm wide', sku:null, price:'0.00', inventoryQuantity:avail, inventoryPolicy:'DENY', rollNumber:{value:'R-' + n}, rollWidth:{value:String(w)}, rollLocation:null, rollStatus:null,
    inventoryItem:{id:'gid://shopify/InventoryItem/' + n, tracked:true, inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1', name:'South Elgin Place'}, quantities:[{name:'available', quantity:avail}, {name:'on_hand', quantity:avail}, {name:'committed', quantity:0}, {name:'reserved', quantity:0}]}]}}});
  const carpet = () => ({id:'gid://shopify/Product/80', title:'Silver twist carpet', productType:'Carpet roll', status:'ACTIVE', coverage:null, ppm:{value:JSON.stringify({amount:'10.0', currency_code:'GBP'})}});
  const rolls = () => [roll(801, 4, 300), roll(802, 5, 200)];
  function answer(op, vars){
    const base = {shop:{myshopifyDomain:DOMAIN}};
    if (op === 'OpsShop') return {shop:{name:'Innovation Flooring Direct', myshopifyDomain:DOMAIN}, locations:{nodes:[{id:'gid://shopify/Location/1', name:'South Elgin Place', isActive:true}]}};
    if (op === 'OpsInbox') return Object.assign(base, {orders:{nodes:[order]}});
    if (op === 'OpsSearch') return Object.assign(base, {products:{nodes:/royale|oak|laminate/i.test(String(vars.q || '')) ? [Object.assign({}, variant().product, {variants:{nodes:[variant()]}})] : /twist|silver/i.test(String(vars.q || '')) ? [Object.assign(carpet(), {variants:{nodes:rolls()}})] : []}});
    if (op === 'OpsProduct') return Object.assign(base, {product:vars.id === 'gid://shopify/Product/80' ? Object.assign(carpet(), {variants:{nodes:rolls()}}) : null});
    if (op === 'OpsVariants') return Object.assign(base, {nodes:(vars.ids || []).map(id => { const r = rolls().find(x => x.id === id); return id === 'gid://shopify/ProductVariant/701' ? variant() : r ? Object.assign(r, {product:carpet()}) : null; })});
    if (op === 'OpsAdjust'){ const c = vars.input.changes[0]; if (c.changeFromQuantity !== state.avail) return {inventoryAdjustQuantities:{inventoryAdjustmentGroup:null, userErrors:[{field:['input'], message:'stale', code:'CHANGE_FROM_QUANTITY_STALE'}]}}; state.avail += c.delta; return {inventoryAdjustQuantities:{inventoryAdjustmentGroup:{id:'g1'}, userErrors:[]}}; }
    if (op === 'OpsDraftCreate'){
      state.drafts++; state.lastDraft = vars.input; const id = 'gid://shopify/DraftOrder/' + (9000 + state.drafts);
      state.docs[id] = {id:id, name:'#D' + state.drafts, status:'OPEN', total:totalOf(vars.input), input:vars.input, order:null};
      return {draftOrderCreate:{draftOrder:{id:id, name:'#D' + state.drafts, status:'OPEN'}, userErrors:[]}};
    }
    if (op === 'OpsDraft'){ const d = state.docs[vars.id]; return Object.assign(base, {draftOrder:d ? {id:d.id, name:d.name, status:d.status, totalPriceSet:money(d.total), order:d.order ? seenOrder(d.order) : null} : null}); }
    if (op === 'OpsOrder'){ const d = Object.values(state.docs).find(x => x.order && x.order.id === vars.id); return Object.assign(base, {order:d ? seenOrder(d.order) : null}); }
    return base;
  }
  async function fetchImpl(url, init){
    if (state.down) throw new Error('network down');
    if (String(url).endsWith('/admin/oauth/access_token')){
      const b = new URLSearchParams(init.body);
      if (b.get('grant_type') !== 'client_credentials' || b.get('client_id') !== 'test-id' || b.get('client_secret') !== 'test-secret') return resp(401, {error:'invalid_client'});
      state.tokens++; return resp(200, {access_token:'tok' + state.tokens, scope:'read_orders,write_draft_orders,write_inventory', expires_in:86399});
    }
    if (String(url).includes('/graphql.json')){
      if (state.expireNext){ state.expireNext = false; return resp(401, {errors:'[API] Invalid API key or access token'}); }
      if (init.headers['x-shopify-access-token'] !== 'tok' + state.tokens) return resp(401, {errors:'bad token'});
      const body = JSON.parse(init.body), op = (/(?:query|mutation)\s+(\w+)/.exec(body.query) || [])[1]; state.calls.push(op);
      return resp(200, {data:answer(op, body.variables || {})});
    }
    if (String(url).indexOf('https://api.postcodes.io/outcodes/') === 0){
      const c = String(url).split('/').pop(), at = {G81:[55.9, -4.4], G84:[56.014, -4.756], ML5:[55.86, -4.032], G13:[55.893, -4.345], G82:[55.95, -4.57]}[c]; state.geo = (state.geo || 0) + 1;
      return at ? resp(200, {status:200, result:{outcode:c, latitude:at[0], longitude:at[1]}}) : resp(404, {status:404, error:'Outcode not found'});
    }
    throw new Error('the tests do not expect a call to ' + url);
  }
  return {fetchImpl, state, DOMAIN};
}
module.exports = { make };

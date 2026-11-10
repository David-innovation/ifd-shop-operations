'use strict';
/* A stand-in for Shopify for the tests: hands out keys the way the real one does and answers the questions this system asks. Made-up people only. */
const DOMAIN = 'innovationflooring.myshopify.com';
const resp = (status, obj) => ({ok:status >= 200 && status < 300, status:status, json:async () => obj, text:async () => JSON.stringify(obj)});
function make(){
  const state = {tokens:0, calls:[], expireNext:false, down:false, avail:36, drafts:0};
  const order = {id:'gid://shopify/Order/5001', name:'#2001', createdAt:'2026-11-09T19:53:06Z', displayFinancialStatus:'PAID', displayFulfillmentStatus:'UNFULFILLED', cancelledAt:null, tags:['packs-reserved'], email:'alex@example.com', phone:null,
    totalPriceSet:{shopMoney:{amount:'50.0'}}, totalOutstandingSet:{shopMoney:{amount:'0.0'}}, customer:{id:'gid://shopify/Customer/9', displayName:'Alex Sample'}, shippingAddress:null,
    customAttributes:[{key:'Quote reference', value:'QT-1'}, {key:'Quote estimated total', value:'£282.52'}],
    lineItems:{nodes:[{title:'£50 Order Deposit', variantTitle:'Collection from Clydebank', quantity:1, variant:{id:'gid://shopify/ProductVariant/5', product:{productType:'deposit'}},
      customAttributes:[{key:'Customer name', value:'Alex Sample'}, {key:'Telephone', value:'07700 900123'}, {key:'Postcode', value:'G64 1AA'}, {key:'Flooring product', value:'Royale Oak 12mm Herringbone Laminate'}, {key:'Pack coverage', value:'1.836 m2 per pack'},
        {key:'Room 1 — Living room', value:'5m x 4.6m = 23m2, 2 doorways'}, {key:'_reserve_variant_id', value:'701'}, {key:'_reserve_packs', value:'14'}, {key:'Fitting requested', value:'No — supply only'}, {key:'How you will receive your flooring', value:'Collect from Clydebank'}]}]}};
  const variant = () => ({id:'gid://shopify/ProductVariant/701', title:'Default Title', sku:null, price:'20.18', inventoryQuantity:state.avail, inventoryPolicy:'DENY', rollNumber:null, rollWidth:null, rollLocation:null, rollStatus:null,
    inventoryItem:{id:'gid://shopify/InventoryItem/701', tracked:true, inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1', name:'South Elgin Place'}, quantities:[{name:'available', quantity:state.avail}, {name:'on_hand', quantity:state.avail}, {name:'committed', quantity:0}, {name:'reserved', quantity:0}]}]}},
    product:{id:'gid://shopify/Product/70', title:'Royale Oak 12mm Herringbone Laminate', productType:'laminate flooring', status:'ACTIVE', coverage:{value:'1.836'}, ppm:null}});
  function answer(op, vars){
    const base = {shop:{myshopifyDomain:DOMAIN}};
    if (op === 'OpsShop') return {shop:{name:'Innovation Flooring Direct', myshopifyDomain:DOMAIN}, locations:{nodes:[{id:'gid://shopify/Location/1', name:'South Elgin Place', isActive:true}]}};
    if (op === 'OpsInbox') return Object.assign(base, {orders:{nodes:[order]}});
    if (op === 'OpsVariants') return Object.assign(base, {nodes:(vars.ids || []).map(id => (id === 'gid://shopify/ProductVariant/701' ? variant() : null))});
    if (op === 'OpsAdjust'){ const c = vars.input.changes[0]; if (c.changeFromQuantity !== state.avail) return {inventoryAdjustQuantities:{inventoryAdjustmentGroup:null, userErrors:[{field:['input'], message:'stale', code:'CHANGE_FROM_QUANTITY_STALE'}]}}; state.avail += c.delta; return {inventoryAdjustQuantities:{inventoryAdjustmentGroup:{id:'g1'}, userErrors:[]}}; }
    if (op === 'OpsDraftCreate'){ state.drafts++; return {draftOrderCreate:{draftOrder:{id:'gid://shopify/DraftOrder/' + (9000 + state.drafts), name:'#D' + state.drafts, status:'OPEN'}, userErrors:[]}}; }
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

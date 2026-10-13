/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ksh = n => 'KSh ' + Math.round(n || 0).toLocaleString();
const uid = () => Math.random().toString(36).slice(2, 10);
const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;
const pl = (w, n) => n === 1 ? w : (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const int = v => Math.max(0, Math.round(num(v)));
const when = t => new Date(t).toLocaleString([], {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
const startOfDay = () => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); };
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ================= passwords (stored scrambled, never as plain text) ================= */
async function hashPw(pw, salt){
  const data = new TextEncoder().encode(salt + ':' + pw);
  if (window.crypto && crypto.subtle){
    const b = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const c of data) h = ((h << 5) + h + c) >>> 0; return 'f' + h.toString(16);
}
function pwProblem(pw){
  if (pw.length < 8) return 'Password needs at least 8 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use both letters and numbers in the password.';
  return '';
}
const pwField = (id, ph) => `<div class="pw"><input id="${id}" type="password" autocomplete="off" placeholder="${ph || 'Password'}"><button type="button" onclick="const i=$('#${id}');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide'">Show</button></div>`;

/* ================= data (saved on this device) ================= */
const KEY = 'farmstock_v2';
function seed(){
  return {
    farm: 'Shamba Stores',
    maxEmployees: 2,
    users: [],
    products: [
      {id:'p1', name:'Cooking oil 1L', base:'Cooking oil', sizeVal:1, sizeUnit:'L', barcode:'1001', sellAs:'both', unit:'bottle', pack:'box', per:12, price:350, packPrice:4000, cost:280, low:24, stock:12},
      {id:'p2', name:'Red Bull 250ml', base:'Red Bull', sizeVal:250, sizeUnit:'ml', barcode:'1002', sellAs:'both', unit:'can', pack:'box', per:24, price:250, packPrice:5600, cost:190, low:24, stock:72},
      {id:'p3', name:'Eggs', barcode:'1003', sellAs:'boxes', unit:'egg', pack:'tray', per:1, price:0, packPrice:450, cost:380, low:10, stock:30},
      {id:'p4', name:'Dairy meal 70kg', base:'Dairy meal', sizeVal:70, sizeUnit:'kg', barcode:'1004', sellAs:'items', unit:'sack', pack:'box', per:1, price:3200, packPrice:0, cost:2800, low:5, stock:8}
    ],
    log: []
  };
}
function load(){ try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch(e){} return seed(); }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(db)); } catch(e){ toast('Could not save on this device'); } }
let db = load();

/* history is permanent: entries are only ever added, never edited or deleted */
function addLog(o){
  db.log.push({id: uid(), t: Date.now(), uid: me ? me.id : null, user: me ? me.name : '', ...o});
  save();
}

/* ================= product helpers ================= */
const prod = id => db.products.find(p => p.id === id);
const modesOf = p => p.sellAs === 'both' ? ['pack','unit'] : p.sellAs === 'boxes' ? ['pack'] : ['unit'];
const stockUnit = p => p.sellAs === 'boxes' ? p.pack : p.unit;
const factor = (p, mode) => (p.sellAs === 'both' && mode === 'pack') ? p.per : 1;
const priceFor = (p, mode) => mode === 'pack' ? p.packPrice : p.price;
const labelFor = (p, mode) => mode === 'pack' ? p.pack : p.unit;
const unitValue = p => p.sellAs === 'boxes' ? p.packPrice : p.price;
function split(p){
  if (p.sellAs !== 'both') return null;
  return {boxes: Math.floor(p.stock / p.per), loose: p.stock % p.per};
}
function fmtStock(p){
  const s = p.stock, su = stockUnit(p), sp = split(p);
  if (sp && sp.boxes) return `${sp.boxes} ${pl(p.pack, sp.boxes)}${sp.loose ? ` + ${sp.loose} ${pl(p.unit, sp.loose)}` : ''} (${s} ${pl(p.unit, s)})`;
  return `${s} ${pl(su, s)}`;
}

/* ================= session ================= */
let me = null, tab = 'stock';
try { const id = sessionStorage.getItem('fs_me'); me = db.users.find(u => u.id === id && u.active) || null; } catch(e){}
const isAdmin = () => me && me.role === 'admin';
const activeEmployees = () => db.users.filter(u => u.role === 'employee' && u.active);

/* ---- first run: create the administrator ---- */
function renderSetup(err){
  $('#app').innerHTML = `
  <div class="login">
    <div class="brand"><div class="logo">🌾</div><h1>Welcome</h1><p>Set up the administrator account</p></div>
    <div class="card">
      <label for="su_farm">Business name</label><input id="su_farm" value="${esc(db.farm)}">
      <label for="su_name">Your full name</label><input id="su_name" placeholder="e.g. Mary Wanjiku">
      <label for="su_user">Username</label><input id="su_user" autocapitalize="off" placeholder="e.g. mary">
      <label for="su_pw">Password</label>${pwField('su_pw', 'At least 8 letters and numbers')}
      <label for="su_pw2">Type the password again</label>${pwField('su_pw2', 'Same password')}
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
      <button class="primary block" onclick="doSetup()">Create administrator</button>
    </div>
  </div>`;
}
async function doSetup(){
  const farm = $('#su_farm').value.trim(), name = $('#su_name').value.trim(), username = $('#su_user').value.trim().toLowerCase();
  const pw = $('#su_pw').value, pw2 = $('#su_pw2').value;
  if (!name || !username) return renderSetup('Enter your name and a username.');
  const prob = pwProblem(pw); if (prob) return renderSetup(prob);
  if (pw !== pw2) return renderSetup('The two passwords do not match.');
  const salt = uid() + uid();
  const u = {id: uid(), name, username, role:'admin', salt, hash: await hashPw(pw, salt), active: true, created: Date.now()};
  db.farm = farm || db.farm; db.users.push(u); me = u;
  addLog({type:'staff', text:`created the administrator account`});
  startSession();
}

/* ---- login ---- */
let loginRole = 'employee', loginErr = '', fails = 0, lockUntil = 0;
function renderLogin(){
  if (!db.users.some(u => u.role === 'admin')) return renderSetup();
  $('#app').innerHTML = `
  <div class="login">
    <div class="brand"><div class="logo">🌾</div><h1>${esc(db.farm)}</h1><p>Stock and sales</p></div>
    <div class="card">
      <div class="seg">
        ${['employee','admin'].map(r => `<button class="${loginRole===r?'on':''}" onclick="loginRole='${r}';loginErr='';renderLogin()">${r==='admin'?'Administrator':'Employee'}</button>`).join('')}
      </div>
      <label for="lu">Username</label>
      <input id="lu" autocapitalize="off" autocomplete="username" placeholder="Your username">
      <label for="lp">Password</label>
      ${pwField('lp')}
      ${loginErr ? `<div class="err">${esc(loginErr)}</div>` : ''}
      <button class="primary block" onclick="doLogin()">Log in</button>
      <p class="note center">Forgot your password? Ask the administrator to reset it.</p>
    </div>
  </div>`;
  $('#lp').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}
async function doLogin(){
  if (Date.now() < lockUntil){ loginErr = `Too many wrong tries. Wait ${Math.ceil((lockUntil - Date.now()) / 1000)} seconds.`; return renderLogin(); }
  const username = $('#lu').value.trim().toLowerCase(), pw = $('#lp').value;
  const u = db.users.find(x => x.username === username && x.role === loginRole);
  let ok = false;
  if (u) ok = (await hashPw(pw, u.salt)) === u.hash;
  if (ok && !u.active){ loginErr = 'This account has been removed. Speak to the administrator.'; return renderLogin(); }
  if (ok && u.role === 'employee'){
    const allowed = activeEmployees().slice(0, db.maxEmployees).map(x => x.id);
    if (!allowed.includes(u.id)){ loginErr = 'The employee limit is full. Ask the administrator to raise it.'; return renderLogin(); }
  }
  if (!ok){
    fails++;
    if (fails >= 5){ lockUntil = Date.now() + 30000; fails = 0; loginErr = 'Too many wrong tries. Wait 30 seconds.'; }
    else loginErr = 'Wrong username or password.';
    return renderLogin();
  }
  fails = 0; me = u;
  addLog({type:'login', text:'logged in'});
  startSession();
}
function startSession(){
  tab = 'stock';
  try { sessionStorage.setItem('fs_me', me.id); } catch(e){}
  render();
}
function logout(){
  if (me) addLog({type:'logout', text:'logged out'});
  me = null; cart = []; loginErr = '';
  try { sessionStorage.removeItem('fs_me'); } catch(e){}
  renderLogin();
}

/* ================= shell ================= */
let armed = null;
function go(t){ tab = t; armed = null; render(); window.scrollTo(0, 0); }
function render(){
  if (!me) return renderLogin();
  const tabs = [['stock','Stock','📦'], ['sell','Sell','🛒'], ['restock','Restock','🚚']];
  if (isAdmin()) tabs.push(['reports','Reports','📊'], ['history','History','🕘'], ['team','Team','👥']);
  if (!tabs.find(t => t[0] === tab)) tab = 'stock';
  $('#app').innerHTML = `
    <header class="top">
      <div><div class="farm">${esc(db.farm)}</div><div class="who">${esc(me.name)}, ${isAdmin() ? 'administrator' : 'employee'}</div></div>
      <button class="ghost sm" onclick="logout()">Log out</button>
    </header>
    <main id="main"></main>
    <nav class="nav">${tabs.map(t => `<button class="${tab===t[0]?'on':''}" onclick="go('${t[0]}')"><span>${t[2]}</span>${t[1]}</button>`).join('')}</nav>`;
  ({stock: viewStock, sell: viewSell, restock: viewRestock, reports: viewReports, history: viewHistory, team: viewTeam})[tab]();
}

/* ================= stock ================= */
let q = '';
function viewStock(){
  const low = db.products.filter(p => p.stock <= p.low);
  const val = db.products.reduce((s, p) => s + p.stock * unitValue(p), 0);
  $('#main').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${db.products.length}</b><span>Products</span></div>
      <div class="stat ${low.length ? 'warn' : ''}"><b>${low.length}</b><span>Running low</span></div>
      <div class="stat"><b>${ksh(val)}</b><span>Stock value</span></div>
    </div>
    <div class="row" style="margin-bottom:10px">
      <button class="ghost" onclick="showStatement()">📄 Stock statement</button>
      <button class="primary" onclick="editProduct()">Add product</button>
    </div>
    <input id="sq" placeholder="Search by name or barcode" value="${esc(q)}" oninput="q=this.value;drawList()" style="margin-bottom:12px">
    <div id="plist"></div>`;
  drawList();
}
function drawList(){
  const s = q.toLowerCase();
  const ps = db.products.filter(p => p.name.toLowerCase().includes(s) || (p.barcode || '').includes(s))
    .sort((a, b) => (a.stock <= a.low ? 0 : 1) - (b.stock <= b.low ? 0 : 1) || a.name.localeCompare(b.name));
  $('#plist').innerHTML = ps.length ? ps.map(p => {
    const prices = modesOf(p).map(m => `${ksh(priceFor(p, m))} per ${esc(labelFor(p, m))}`).join(', ');
    return `<button class="item" onclick="editProduct('${p.id}')">
      <div><div class="name">${esc(p.name)}</div><div class="sub">${prices}</div><div class="sub">${fmtStock(p)}</div></div>
      <div class="right"><div class="count">${p.stock}</div><div class="sub">${esc(pl(stockUnit(p), p.stock))}</div>${p.stock <= p.low ? '<span class="badge">Low</span>' : ''}</div>
    </button>`;
  }).join('') : `<p class="muted center">No products match. Tap “Add product” to create one.</p>`;
}

/* ---- stock statement for counting / reconciliation ---- */
function statementRows(){
  return db.products.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    const sp = split(p);
    return {
      name: p.name, barcode: p.barcode || '',
      boxes: sp ? sp.boxes : (p.sellAs === 'boxes' ? p.stock : 0),
      boxLabel: p.pack, items: sp ? sp.loose : (p.sellAs === 'items' ? p.stock : 0), itemLabel: p.unit,
      total: p.stock, unit: stockUnit(p),
      priceItem: p.sellAs === 'boxes' ? '' : p.price, priceBox: p.sellAs === 'items' ? '' : p.packPrice,
      value: p.stock * unitValue(p)
    };
  });
}
function showStatement(){
  const rows = statementRows();
  const total = rows.reduce((a, r) => a + r.value, 0);
  openModal(`
    <div class="sheethead"><h2>Stock statement</h2><button class="ghost sm" onclick="closeModal()">Close</button></div>
    <p class="muted">${esc(db.farm)}, ${when(Date.now())}</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Product</th><th class="n">Boxes</th><th class="n">Single items</th><th class="n">Total</th><th class="n">Value</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${r.boxes ? `${r.boxes} ${esc(pl(r.boxLabel, r.boxes))}` : '–'}</td><td class="n">${r.items ? `${r.items} ${esc(pl(r.itemLabel, r.items))}` : '–'}</td><td class="n">${r.total} ${esc(pl(r.unit, r.total))}</td><td class="n">${ksh(r.value)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="total"><span>Total stock value</span><span class="big">${ksh(total)}</span></div>
    <button class="primary block" onclick="downloadStatement()">Download for Excel (CSV)</button>
    <p class="note">The download has empty “Counted” and “Difference” columns so you can fill them in while counting.</p>`);
}
let dl = null;
if (window.claude && claude.use) claude.use('downloads').then(d => { dl = d; }).catch(() => {});
async function downloadStatement(){
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    [`${db.farm} stock statement`], [`Date: ${when(Date.now())}`], [`Prepared by: ${me.name}`], [],
    ['Product','Barcode','Full boxes','Box type','Single items','Item type','Total in stock','Counted in','Counted (fill in)','Difference','Price per item (KSh)','Price per box (KSh)','Value (KSh)']
  ];
  statementRows().forEach(r => lines.push([r.name, r.barcode, r.boxes, r.boxLabel, r.items, r.itemLabel, r.total, pl(r.unit, 2), '', '', r.priceItem, r.priceBox, Math.round(r.value)]));
  const csv = '\uFEFF' + lines.map(l => l.map(cell).join(',')).join('\r\n');
  const d = new Date(), filename = `stock-statement-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.csv`;
  try {
    if (dl){ await dl.save({filename, data: csv}); }
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
    addLog({type:'download', text:'downloaded the stock statement'});
    toast('Statement downloaded');
  } catch(e){
    toast(e && e.code === 'declined' ? 'Download cancelled' : 'Download is not available here');
  }
}

/* ================= product form ================= */
let editCb = null, formSell = 'both';
const UNITS = ['piece','bottle','can','packet','container','sachet','tin','egg','kg','litre','sack'];
const PACKS = ['box','carton','crate','tray','bale','sack','pack','dozen'];
const fv = k => $('#' + k) ? $('#' + k).value.trim() : '';
const composeName = (base, variant, sv, su) => [base, variant, sv && su ? `${+sv}${su}` : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

function editProduct(id, presetCode, cb){
  const p = id ? prod(id) : {base:'', variant:'', sizeVal:'', sizeUnit:'', barcode: presetCode || '', sellAs:'both', unit:'bottle', pack:'box', per:0, price:'', packPrice:'', cost:'', low:10, stock:0};
  editCb = cb || null; armed = null; formSell = p.sellAs;
  const admin = isAdmin(), sp = split(p);
  const base = p.base ?? p.name;
  const costShown = p.cost ? Math.round((p.sellAs === 'both' ? p.cost * p.per : p.cost) * 100) / 100 : '';
  openModal(`
    <div class="sheethead"><h2>${id ? 'Edit product' : 'New product'}</h2><button class="ghost sm" onclick="closeModal()">Close</button></div>
    ${id ? `<div class="chosen"><div class="name">${esc(p.name)}</div><div class="muted">In stock: ${fmtStock(p)}</div></div>` : ''}
    <input id="f_photo" type="file" accept="image/*" capture="environment" class="hidden" onchange="readLabel(this.files[0]);this.value=''">
    <button class="scan aionly ${ai ? '' : 'hidden'}" style="font-size:1rem;padding:14px;margin-top:12px" onclick="$('#f_photo').click()">📸 Photo of the front: fill name and size</button>
    <p id="f_status" class="note"></p>
    <label for="f_code">Barcode</label>
    <div class="row"><input id="f_code" value="${esc(p.barcode)}" inputmode="numeric" placeholder="Scan or type" onchange="if(this.value.trim())autoLookup(this.value.trim())"><button class="ghost fit" onclick="openScanner(c=>{$('#f_code').value=c;autoLookup(c)})">📷 Scan</button></div>
    <label for="f_base">Product name</label><input id="f_base" value="${esc(base)}" placeholder="e.g. Coca-Cola, Fresh Fri oil, Dairy meal">
    <label for="f_var">Flavour or type (optional)</label><input id="f_var" value="${esc(p.variant || '')}" placeholder="e.g. Orange, Pineapple, Wholegrain">
    <label for="f_sv">Size (optional)</label>
    <div class="row"><input id="f_sv" type="number" min="0" inputmode="decimal" value="${p.sizeVal || ''}" placeholder="e.g. 500"><select id="f_su" class="fit" style="width:auto">${['','ml','L','g','kg'].map(u => `<option value="${u}" ${(p.sizeUnit || '') === u ? 'selected' : ''}>${u || 'No size'}</option>`).join('')}</select></div>
    <label>How is it sold?</label>
    <div class="seg" id="f_sell">
      ${[['items','Single items'],['boxes','Boxes only'],['both','Both']].map(([k, t]) => `<button data-k="${k}" class="${formSell===k?'on':''}" onclick="setFormSell('${k}')">${t}</button>`).join('')}
    </div>
    <div class="row">
      <div class="fi"><label for="f_unit">Single item is a</label><input id="f_unit" list="units" value="${esc(p.unit)}"></div>
      <div class="fb"><label for="f_pack">Box is a</label><input id="f_pack" list="packs" value="${esc(p.pack)}"></div>
    </div>
    <div class="fboth"><label for="f_per">How many single items in one box? (check the side of the box)</label><input id="f_per" type="number" min="2" inputmode="numeric" value="${p.per > 1 ? p.per : ''}" placeholder="e.g. 6, 12 or 24"></div>
    <label for="f_cost" id="f_costlbl">Buying price (KSh)</label><input id="f_cost" type="number" min="0" inputmode="decimal" value="${costShown}" placeholder="What you paid">
    <div class="row">
      <div class="fi"><label for="f_price">Selling price per single item (KSh)</label><input id="f_price" type="number" min="0" inputmode="decimal" value="${p.price || ''}"></div>
      <div class="fb"><label for="f_pprice">Selling price per box (KSh)</label><input id="f_pprice" type="number" min="0" inputmode="decimal" value="${p.packPrice || ''}"></div>
    </div>
    <label for="f_low">Warn me when stock is below</label><input id="f_low" type="number" min="0" inputmode="numeric" value="${p.low}">
    ${!id ? `
      <h3>How many did you receive now?</h3>
      <div class="row">
        <div class="fb"><label for="f_cb">Full boxes</label><input id="f_cb" type="number" min="0" inputmode="numeric" placeholder="0"></div>
        <div class="fi"><label for="f_ci">Single items</label><input id="f_ci" type="number" min="0" inputmode="numeric" placeholder="0"></div>
      </div>` : admin ? `
      <h3>Correct the stock count</h3>
      <div class="row">
        <div class="fb"><label for="f_cb">Full boxes</label><input id="f_cb" type="number" min="0" inputmode="numeric" value="${sp ? sp.boxes : (p.sellAs === 'boxes' ? p.stock : 0)}"></div>
        <div class="fi"><label for="f_ci">Single items</label><input id="f_ci" type="number" min="0" inputmode="numeric" value="${sp ? sp.loose : (p.sellAs === 'items' ? p.stock : 0)}"></div>
      </div>
      <p class="note">Only administrators can correct the count. Every correction is saved in the history.</p>`
      : `<p class="note">The stock number changes by itself when you sell or restock. Only the administrator can correct it.</p>`}
    <div id="f_err" class="err"></div>
    <button class="primary block" onclick="saveProduct(${id ? `'${id}'` : 'null'})">${id ? 'Save changes' : 'Save product'}</button>
    ${id && admin ? `<button class="danger block" id="delbtn" onclick="deleteProduct('${id}')">Delete product</button>` : ''}
    <datalist id="units">${UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
    <datalist id="packs">${PACKS.map(u => `<option value="${u}">`).join('')}</datalist>`);
  applyFormSell();
  if (!id && presetCode) autoLookup(presetCode);
}
function setFormSell(k){ formSell = k; document.querySelectorAll('#f_sell button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); applyFormSell(); }
function applyFormSell(){
  document.querySelectorAll('#sheet .fi').forEach(e => e.classList.toggle('hidden', formSell === 'boxes'));
  document.querySelectorAll('#sheet .fb').forEach(e => e.classList.toggle('hidden', formSell === 'items'));
  document.querySelectorAll('#sheet .fboth').forEach(e => e.classList.toggle('hidden', formSell !== 'both'));
  const l = $('#f_costlbl'); if (l) l.textContent = formSell === 'items' ? 'Buying price per single item (KSh)' : 'Buying price per box (KSh)';
}
const countFrom = (sellAs, per) => { const b = int(fv('f_cb')), i = int(fv('f_ci')); return sellAs === 'both' ? b * per + i : sellAs === 'boxes' ? b : i; };
const priceLabel = x => modesOf(x).map(m => `${ksh(priceFor(x, m))} per ${labelFor(x, m)}`).join(', ');

function saveProduct(id){
  const err = m => { $('#f_err').textContent = m; $('#f_err').scrollIntoView({block:'nearest'}); };
  const old = id ? prod(id) : null, admin = isAdmin(), sellAs = formSell;
  const base = fv('f_base'), variant = fv('f_var'), sizeVal = num(fv('f_sv')) || '', sizeUnit = sizeVal ? fv('f_su') : '';
  if (!base) return err('Write the product name, or scan it.');
  const name = composeName(base, variant, sizeVal, sizeUnit), code = fv('f_code');
  if (code && db.products.some(x => x.barcode === code && x.id !== id)) return err('Another product already uses this barcode.');
  if (db.products.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return err('A product with this exact name already exists.');
  const per = sellAs === 'both' ? int(fv('f_per')) : 1;
  if (sellAs === 'both' && per < 2) return err('Write how many single items are in one box.');
  const price = num(fv('f_price')), packPrice = num(fv('f_pprice')), costIn = num(fv('f_cost'));
  if (sellAs !== 'boxes' && price <= 0) return err('Write the selling price per single item.');
  if (sellAs !== 'items' && packPrice <= 0) return err('Write the selling price per box.');
  const data = {name, base, variant, sizeVal, sizeUnit, barcode: code, sellAs, per,
    unit: (fv('f_unit') || 'item').toLowerCase(), pack: (fv('f_pack') || 'box').toLowerCase(),
    price: sellAs === 'boxes' ? 0 : price, packPrice: sellAs === 'items' ? 0 : packPrice,
    cost: sellAs === 'both' ? costIn / per : costIn, low: int(fv('f_low'))};

  if (old){
    const next = {...old, ...data};
    if (priceLabel(old) !== priceLabel(next)) addLog({type:'price', text:`changed selling prices of ${name}: ${priceLabel(next)} (was ${priceLabel(old)})`});
    const changed = ['name','barcode','sellAs','per','unit','pack','low'].filter(k => String(old[k] ?? '') !== String(data[k] ?? ''));
    if (Math.abs((old.cost || 0) - data.cost) > 0.001) changed.push('buying price');
    // if the counting unit changes (boxes vs items), convert the balance so it stays correct
    let stock = old.stock;
    if (old.sellAs === 'boxes' && sellAs !== 'boxes') stock = old.stock * (sellAs === 'both' ? per : 1);
    else if (old.sellAs !== 'boxes' && sellAs === 'boxes') stock = old.sellAs === 'both' ? Math.floor(old.stock / old.per) : old.stock;
    const beforeTxt = fmtStock(old), wasStock = old.stock;
    Object.assign(old, data); old.stock = stock;
    if (stock !== wasStock) addLog({type:'adjust', text:`changed how ${name} is counted, balance converted: ${beforeTxt} → ${fmtStock(old)}`});
    if (changed.length) addLog({type:'product', text:`edited ${name} (${changed.join(', ')})`});
    if (admin && $('#f_cb')){
      const c = countFrom(sellAs, per);
      if (c !== old.stock){ old.stock = c; addLog({type:'adjust', text:`corrected the stock of ${name}: ${beforeTxt} → ${fmtStock(old)}`}); }
    }
    save(); closeModal(); toast('Saved'); render();
  } else {
    const p = {id: uid(), ...data, stock: 0};
    db.products.push(p);
    addLog({type:'product', text:`added product ${name}${code ? ` (barcode ${code})` : ''}, ${priceLabel(p)}`});
    const rec = countFrom(sellAs, per);
    if (rec > 0){ p.stock = rec; addLog({type:'restock', text:`received ${name}: ${fmtStock(p)} (was 0)`}); }
    closeModal(); toast(rec > 0 ? `${name} saved: ${fmtStock(p)}` : `${name} saved`);
    const cb = editCb; editCb = null;
    if (cb) cb(p.id); else render();
  }
}
function deleteProduct(id){
  if (armed !== 'del'){ armed = 'del'; $('#delbtn').textContent = 'Tap again to delete for good'; return; }
  const p = prod(id);
  db.products = db.products.filter(x => x.id !== id);
  addLog({type:'product', text:`deleted product ${p.name} (had ${fmtStock(p)})`});
  armed = null; closeModal(); toast('Product deleted'); render();
}

/* ---- automatic name and size: barcode lookup + reading the label from a photo ---- */
function parseSize(s){
  const m = String(s || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(ml|cl|l|ltr|litres?|liters?|g|kg)\b/i);
  if (!m) return {};
  let v = parseFloat(m[1]), u = m[2].toLowerCase();
  if (u === 'cl'){ v *= 10; u = 'ml'; }
  if (u === 'l' || u.startsWith('lit') || u === 'ltr') u = 'L';
  return {sizeVal: v, sizeUnit: u};
}
async function lookupBarcode(code){
  if (!/^\d{8,14}$/.test(code)) return null;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity`, {signal: ctl.signal});
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    let base = (j.product.product_name || '').trim();
    const brand = (j.product.brands || '').split(',')[0].trim();
    if (brand && !base.toLowerCase().includes(brand.toLowerCase())) base = (brand + ' ' + base).trim();
    return {base, ...parseSize(j.product.quantity)};
  } catch(e){ return null; }
}
function fillForm(r, force){
  const set = (id, val) => { const el = $('#' + id); if (el && val !== undefined && val !== null && val !== '' && (force || !el.value)) el.value = val; };
  set('f_base', r.base); set('f_var', r.variant);
  if (r.sizeVal && (force || !$('#f_sv').value)){ $('#f_sv').value = r.sizeVal; $('#f_su').value = r.sizeUnit || ''; }
}
async function autoLookup(code){
  const st = $('#f_status'); if (!st) return;
  st.textContent = 'Looking up this barcode…';
  const r = await lookupBarcode(code);
  if (!$('#f_status')) return;
  if (r && r.base){ fillForm(r, false); st.textContent = 'Found it. Check the name and size, then add the box size and prices.'; }
  else st.textContent = ai ? 'Not found online. Take a photo of the front, or type the name.' : 'Not found online. Type the name and size.';
}
let ai = null;
if (window.claude && claude.use) claude.use('sample').then(async s => {
  if (!s) return;
  const caps = await s.limits().catch(() => null);
  if (caps && caps.images){ ai = s; document.querySelectorAll('.aionly').forEach(e => e.classList.remove('hidden')); }
}).catch(() => {});
async function shrink(file){
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.85));
  } catch(e){ return file; }
}
async function readLabel(file){
  if (!file || !ai) return;
  const st = $('#f_status'); st.textContent = 'Reading the label…';
  try {
    const img = await shrink(file);
    const r = await ai.json(
      'The photo shows the front of a product package in a shop, farm store or warehouse. Read only what is printed on it. ' +
      'Reply with only a JSON object: {"name": brand and product name, e.g. "Coca-Cola" or "Fresh Fri Cooking Oil", ' +
      '"variant": flavour or type if printed, else "", "size_value": the number of the pack size or null, "size_unit": one of "ml", "L", "g", "kg" or null}. ' +
      'If you cannot read something, use "" or null. Do not guess.',
      {images: img, modelTier: 'quick', cache: false});
    if (!$('#f_status')) return;
    const unit = r && r.size_unit ? ({l:'L', ml:'ml', g:'g', kg:'kg'})[String(r.size_unit).toLowerCase()] || '' : '';
    if (!r || !r.name){ st.textContent = 'Could not read the label. Try a clearer photo, or type the name.'; return; }
    fillForm({base: r.name, variant: r.variant || '', sizeVal: r.size_value || '', sizeUnit: unit}, true);
    st.textContent = 'Name and size filled from the photo. Check them, then add the box size and prices.';
  } catch(e){
    if ($('#f_status')) st.textContent = e && e.code === 'not_granted' ? 'Photo reading was not allowed. Type the name instead.' : 'Could not read the label right now. Type the name instead.';
  }
}

/* ================= sell + restock picker ================= */
const pick = {sell: {id:null, mode:'unit', qty:1}, restock: {id:null, mode:'pack', qty:1}};
function pickerHTML(m){
  const s = pick[m], p = prod(s.id);
  return `
  <div class="card">
    <h2>${m === 'sell' ? 'Sell' : 'Restock'}</h2>
    <button class="scan" onclick="openScanner(c=>found('${m}',c))">📷 Scan product</button>
    <div class="or">or</div>
    <select aria-label="Choose product" onchange="choose('${m}',this.value)">
      <option value="">Choose from the list…</option>
      ${db.products.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select>
    ${p ? detailHTML(m, p) : `<p class="muted center" style="margin-bottom:0">Scan a barcode or pick a product to begin.</p>`}
  </div>`;
}
function detailHTML(m, p){
  const s = pick[m], modes = modesOf(p);
  if (!modes.includes(s.mode)) s.mode = modes[0];
  return `
    <div class="chosen"><div class="name">${esc(p.name)}</div><div class="muted">In stock: ${fmtStock(p)}</div></div>
    ${modes.length > 1 ? `
    <label>${m === 'sell' ? 'Selling' : 'Received'}</label>
    <div class="seg">${modes.map(md => `<button class="${s.mode===md?'on':''}" onclick="setMode('${m}','${md}')">${md === 'pack' ? `${cap(pl(p.pack, 2))} (${p.per} each)` : `Single ${esc(pl(p.unit, 2))}`}</button>`).join('')}</div>` : ''}
    <label for="qty-${m}">How many ${esc(pl(labelFor(p, s.mode), 2))}?</label>
    <div class="stepper">
      <button aria-label="Less" onclick="step('${m}',-1)">−</button>
      <input id="qty-${m}" type="number" min="1" inputmode="numeric" value="${s.qty}" oninput="setQty('${m}',this.value)">
      <button aria-label="More" onclick="step('${m}',1)">+</button>
    </div>
    ${m === 'restock' ? `<label for="cost-restock">Buying price per ${esc(labelFor(p, s.mode))} (optional)</label><input id="cost-restock" type="number" min="0" inputmode="decimal" placeholder="Leave empty to keep the current one">` : ''}
    <div id="sum-${m}" class="sum"></div>
    <button class="primary block" onclick="${m === 'sell' ? 'addToCart()' : 'doRestock()'}">${m === 'sell' ? 'Add to sale' : 'Save restock'}</button>`;
}
function unitsOf(m){ const s = pick[m], p = prod(s.id); return s.qty * factor(p, s.mode); }
function updateSum(m){
  const el = $('#sum-' + m), s = pick[m], p = prod(s.id);
  if (!el || !p) return;
  const u = unitsOf(m), su = stockUnit(p);
  if (m === 'sell'){
    const each = priceFor(p, s.mode);
    const inCart = cart.filter(c => c.pid === p.id).reduce((a, c) => a + c.units, 0);
    const left = p.stock - inCart - u;
    el.innerHTML = `
      <div class="line"><span>Price per ${esc(labelFor(p, s.mode))}</span><span>${ksh(each)}</span></div>
      <div class="line"><span>Amount</span><span class="big">${ksh(each * s.qty)}</span></div>
      <div class="line muted"><span>Left after sale</span><span>${left < 0 ? '<b style="color:var(--low)">Not enough stock</b>' : fmtStock({...p, stock: left})}</span></div>`;
  } else {
    el.innerHTML = `
      <div class="line"><span>Adding</span><span>${u} ${esc(pl(su, u))}</span></div>
      <div class="line"><span>Stock will be</span><span class="big">${p.stock} → ${p.stock + u}</span></div>`;
  }
}
function choose(m, id){ pick[m].id = id || null; pick[m].qty = 1; pick[m].mode = m === 'sell' ? 'unit' : 'pack'; render(); }
function setMode(m, mode){ pick[m].mode = mode; render(); }
function step(m, d){ const s = pick[m]; s.qty = Math.max(1, s.qty + d); $('#qty-' + m).value = s.qty; updateSum(m); }
function setQty(m, v){ pick[m].qty = Math.max(1, int(v) || 1); updateSum(m); }
function found(m, code){
  code = String(code || '').trim();
  if (!code) return;
  const p = db.products.find(x => x.barcode === code);
  if (p){ if (navigator.vibrate) navigator.vibrate(60); choose(m, p.id); toast(p.name); return; }
  toast('New barcode. Add the product details.');
  editProduct(null, code, id => choose(m, id));   // after saving, it is picked automatically
}

/* ================= sell ================= */
let cart = [], pay = 'Cash';
function viewSell(){ $('#main').innerHTML = pickerHTML('sell') + cartHTML(); updateSum('sell'); }
function cartHTML(){
  if (!cart.length) return '';
  const total = cart.reduce((a, c) => a + c.total, 0);
  return `
  <div class="card">
    <h2>This sale</h2>
    ${cart.map((c, i) => `
      <div class="cartline">
        <div><b>${esc(c.name)}</b><div class="muted">${c.qty} ${esc(pl(c.label, c.qty))} × ${ksh(c.each)}</div></div>
        <div class="row fit" style="gap:2px"><b>${ksh(c.total)}</b><button class="x" aria-label="Remove" onclick="cart.splice(${i},1);render()">×</button></div>
      </div>`).join('')}
    <div class="total"><span>Total to collect</span><span class="big">${ksh(total)}</span></div>
    <label>How did the customer pay?</label>
    <div class="seg">${['Cash','M-Pesa','Card','Bank','Credit'].map(x => `<button class="${pay===x?'on':''}" onclick="pay='${x}';render()">${x}</button>`).join('')}</div>
    <p class="note">For records only. The app does not send or request any payment.</p>
    <button class="primary block" onclick="completeSale()">Record sale, ${ksh(total)}</button>
  </div>`;
}
function addToCart(){
  const s = pick.sell, p = prod(s.id); if (!p) return;
  const u = unitsOf('sell');
  const inCart = cart.filter(c => c.pid === p.id).reduce((a, c) => a + c.units, 0);
  if (inCart + u > p.stock) return toast(`Only ${fmtStock({...p, stock: p.stock - inCart})} left`);
  const each = priceFor(p, s.mode);
  cart.push({pid: p.id, name: p.name, qty: s.qty, label: labelFor(p, s.mode), each, total: each * s.qty, units: u, cost: (p.cost || 0) * u});
  pick.sell = {id: null, mode: 'unit', qty: 1};
  render();
}
function completeSale(){
  const need = {};
  cart.forEach(c => need[c.pid] = (need[c.pid] || 0) + c.units);
  for (const pid in need){ const p = prod(pid); if (!p || p.stock < need[pid]) return toast(`Not enough ${p ? p.name : 'stock'}`); }
  const total = cart.reduce((a, c) => a + c.total, 0);
  Object.keys(need).forEach(pid => prod(pid).stock -= need[pid]);
  const receipt = 'R' + Date.now().toString().slice(-7);
  addLog({type:'sale', receipt, items: cart, total, pay, text:`sold ${cart.map(i => `${i.qty} ${pl(i.label, i.qty)} ${i.name}`).join(', ')} for ${ksh(total)} (${pay})`});
  const done = cart, after = Object.keys(need).map(prod), paidBy = pay;
  cart = []; pay = 'Cash';
  render();
  openModal(`
    <div class="sheethead"><h2>Sale recorded</h2><button class="ghost sm" onclick="closeModal()">Done</button></div>
    <p class="muted">Receipt ${receipt}, ${when(Date.now())}, served by ${esc(me.name)}</p>
    ${done.map(c => `<div class="kv"><span>${c.qty} ${esc(pl(c.label, c.qty))} ${esc(c.name)}</span><b>${ksh(c.total)}</b></div>`).join('')}
    <div class="total"><span>Total</span><span class="big">${ksh(total)}</span></div>
    <div class="kv"><span>Paid by</span><b>${esc(paidBy)}</b></div>
    <h3>Now in stock</h3>
    ${after.map(p => `<div class="kv"><span>${esc(p.name)}</span><span>${fmtStock(p)}${p.stock <= p.low ? ' <span class="badge">Low</span>' : ''}</span></div>`).join('')}`);
}

/* ================= restock ================= */
function viewRestock(){ $('#main').innerHTML = pickerHTML('restock'); updateSum('restock'); }
function doRestock(){
  const s = pick.restock, p = prod(s.id); if (!p) return;
  const u = unitsOf('restock'), before = fmtStock(p);
  const c = $('#cost-restock') ? num($('#cost-restock').value) : 0;
  if (c > 0) p.cost = c / factor(p, s.mode);
  p.stock += u;
  addLog({type:'restock', text:`restocked ${p.name}: +${s.qty} ${pl(labelFor(p, s.mode), s.qty)} (${before} → ${fmtStock(p)})`});
  toast(`${p.name}: now ${fmtStock(p)}`);
  pick.restock = {id: null, mode: 'pack', qty: 1};
  render();
}

/* ================= reports (admin) ================= */
let range = 'today', staffF = '';
const rangeStart = () => range === 'today' ? startOfDay() : range === 'week' ? Date.now() - 7 * 864e5 : range === 'month' ? Date.now() - 30 * 864e5 : 0;
const rangeSeg = () => `<div class="seg" style="margin-bottom:10px">${[['today','Today'],['week','7 days'],['month','30 days'],['all','All time']].map(([k, t]) => `<button class="${range===k?'on':''}" onclick="range='${k}';render()">${t}</button>`).join('')}</div>`;
const staffSelect = () => `<select aria-label="Staff" onchange="staffF=this.value;render()" style="margin-bottom:14px"><option value="">Everyone</option>${db.users.map(u => `<option value="${u.id}" ${staffF===u.id?'selected':''}>${esc(u.name)}${u.active ? '' : ' (former)'}</option>`).join('')}</select>`;
function viewReports(){
  const since = rangeStart();
  const logs = db.log.filter(l => l.t >= since && (!staffF || l.uid === staffF));
  const sales = logs.filter(l => l.type === 'sale');
  const total = sales.reduce((a, l) => a + l.total, 0);
  const profit = sales.reduce((a, l) => a + l.items.reduce((b, i) => b + i.total - (i.cost || 0), 0), 0);
  const group = (arr, key, val) => arr.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + val(x); return m; }, {});
  const rows = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${ksh(v)}</b></div>`).join('') || '<p class="muted">No sales in this period.</p>';
  const low = db.products.filter(p => p.stock <= p.low);
  const staff = db.users.filter(u => !staffF || u.id === staffF).map(u => {
    const mine = logs.filter(l => l.uid === u.id), ms = mine.filter(l => l.type === 'sale');
    const lastIn = db.log.filter(l => l.uid === u.id && l.type === 'login').pop();
    return {u, amount: ms.reduce((a, l) => a + l.total, 0), receipts: ms.length, restocks: mine.filter(l => l.type === 'restock').length, logins: mine.filter(l => l.type === 'login').length, last: lastIn ? when(lastIn.t) : 'Never'};
  });
  $('#main').innerHTML = `
    ${rangeSeg()}${staffSelect()}
    <div class="stats">
      <div class="stat"><b>${ksh(total)}</b><span>Sales</span></div>
      <div class="stat"><b>${ksh(profit)}</b><span>Profit (est.)</span></div>
      <div class="stat"><b>${sales.length}</b><span>Receipts</span></div>
    </div>
    <div class="card"><h2>Who did what</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>Staff</th><th class="n">Sales</th><th class="n">Receipts</th><th class="n">Restocks</th><th class="n">Logins</th><th>Last logged in</th></tr></thead>
        <tbody>${staff.map(s => `<tr><td><b>${esc(s.u.name)}</b>${s.u.active ? '' : ' <span class="muted">(former)</span>'}</td><td class="n">${ksh(s.amount)}</td><td class="n">${s.receipts}</td><td class="n">${s.restocks}</td><td class="n">${s.logins}</td><td>${s.last}</td></tr>`).join('')}</tbody>
      </table></div>
      <button class="ghost block" onclick="go('history')">See full history</button>
    </div>
    ${low.length ? `<div class="card"><h2>Restock soon</h2>${low.map(p => `<div class="kv"><span>${esc(p.name)}</span><b style="color:var(--low)">${fmtStock(p)}</b></div>`).join('')}</div>` : ''}
    <div class="card"><h2>Best sellers</h2>${rows(group(sales.flatMap(l => l.items), i => i.name, i => i.total))}</div>
    <div class="card"><h2>Money by payment type</h2>${rows(group(sales, l => l.pay, l => l.total))}</div>`;
}

/* ================= history (admin, permanent) ================= */
let typeF = '', histLimit = 100;
const TYPES = [['','Everything'],['login','Logins and logouts'],['sale','Sales'],['restock','Restocks'],['adjust','Stock corrections'],['price','Price changes'],['product','Product changes'],['staff','Staff changes'],['download','Downloads']];
function viewHistory(){
  const since = rangeStart();
  const list = db.log.filter(l => l.t >= since && (!staffF || l.uid === staffF) && (!typeF || l.type === typeF || (typeF === 'login' && l.type === 'logout'))).reverse();
  $('#main').innerHTML = `
    ${rangeSeg()}
    <div class="row" style="margin-bottom:14px">
      ${staffSelect().replace('margin-bottom:14px', 'margin:0')}
      <select aria-label="Type" onchange="typeF=this.value;histLimit=100;render()">${TYPES.map(([k, t]) => `<option value="${k}" ${typeF===k?'selected':''}>${t}</option>`).join('')}</select>
    </div>
    <div class="card">
      <h2>History</h2>
      <p class="note" style="margin-top:-6px;margin-bottom:8px">${list.length} records. History is kept for good and cannot be edited or deleted.</p>
      ${list.slice(0, histLimit).map(l => `<div class="log"><time>${when(l.t)}${l.receipt ? `, receipt ${l.receipt}` : ''}</time><b>${esc(l.user || 'System')}</b> ${esc(l.text || '')}</div>`).join('') || '<p class="muted">Nothing recorded in this period.</p>'}
      ${list.length > histLimit ? `<button class="ghost block" onclick="histLimit+=100;render()">Show more</button>` : ''}
    </div>`;
}

/* ================= team (admin) ================= */
function viewTeam(){
  const emps = activeEmployees(), admins = db.users.filter(u => u.role === 'admin' && u.active), former = db.users.filter(u => !u.active);
  const full = emps.length >= db.maxEmployees;
  const row = u => `<div class="kv"><span><b>${esc(u.name)}</b><br><span class="muted">@${esc(u.username)}</span></span>
    ${u.id === me.id ? '<span class="muted">You</span>' : `<span class="row fit"><button class="ghost sm" onclick="resetPw('${u.id}')">Reset password</button><button class="danger sm" id="rm-${u.id}" onclick="removeUser('${u.id}')">Remove</button></span>`}</div>`;
  $('#main').innerHTML = `
    <div class="card">
      <h2>Employee limit</h2>
      <p class="muted" style="margin-top:-6px">${emps.length} of ${db.maxEmployees} employee places used. Only this many employees can have accounts and log in.</p>
      <div class="stepper">
        <button aria-label="Fewer" onclick="setLimit(-1)">−</button>
        <input id="lim" type="number" min="1" inputmode="numeric" value="${db.maxEmployees}" onchange="setLimit(0, this.value)">
        <button aria-label="More" onclick="setLimit(1)">+</button>
      </div>
    </div>
    <div class="card">
      <h2>Employees</h2>
      ${emps.map(row).join('') || '<p class="muted">No employees yet.</p>'}
      <h3>Add a staff member</h3>
      ${full ? `<p class="note">All ${db.maxEmployees} employee places are used. Raise the limit above to add another employee.</p>` : ''}
      <label for="nu_name">Full name</label><input id="nu_name" placeholder="e.g. John Otieno">
      <label for="nu_user">Username</label><input id="nu_user" autocapitalize="off" placeholder="e.g. john">
      <label for="nu_pw">Password for them</label>${pwField('nu_pw', 'At least 8 letters and numbers')}
      <label for="nu_role">Role</label>
      <select id="nu_role"><option value="employee">Employee</option><option value="admin">Administrator</option></select>
      <div id="nu_err" class="err"></div>
      <button class="primary block" onclick="addUser()">Add staff member</button>
    </div>
    <div class="card"><h2>Administrators</h2>${admins.map(row).join('')}</div>
    ${former.length ? `<div class="card"><h2>Former staff</h2><p class="note" style="margin-top:-6px">They can no longer log in. Their history is kept.</p>${former.map(u => `<div class="kv"><span>${esc(u.name)} <span class="muted">@${esc(u.username)}</span></span><span class="muted">${u.role === 'admin' ? 'Administrator' : 'Employee'}</span></div>`).join('')}</div>` : ''}
    <div class="card"><h2>Settings</h2>
      <label for="s_farm">Business name</label>
      <div class="row"><input id="s_farm" value="${esc(db.farm)}"><button class="ghost fit" onclick="saveFarm()">Save</button></div>
      <h3>Change my password</h3>
      <label for="s_old">Current password</label>${pwField('s_old', 'Current password')}
      <label for="s_new">New password</label>${pwField('s_new', 'At least 8 letters and numbers')}
      <div id="s_err" class="err"></div>
      <button class="ghost block" onclick="changePw()">Change password</button>
    </div>`;
}
function setLimit(d, v){
  let n = d ? db.maxEmployees + d : int(v);
  const used = activeEmployees().length;
  if (n < 1) n = 1;
  if (n < used){ toast(`${used} employees are active. Remove someone first.`); render(); return; }
  if (n === db.maxEmployees){ render(); return; }
  addLog({type:'staff', text:`changed the employee limit from ${db.maxEmployees} to ${n}`});
  db.maxEmployees = n; save(); render();
}
async function addUser(){
  const name = $('#nu_name').value.trim(), username = $('#nu_user').value.trim().toLowerCase(), pw = $('#nu_pw').value, role = $('#nu_role').value;
  const err = m => { $('#nu_err').textContent = m; };
  if (!name || !username) return err('Enter a full name and a username.');
  if (!/^[a-z0-9._-]{3,}$/.test(username)) return err('Username: at least 3 letters or numbers, no spaces.');
  if (db.users.some(u => u.username === username)) return err('That username is already taken.');
  const prob = pwProblem(pw); if (prob) return err(prob);
  if (role === 'employee' && activeEmployees().length >= db.maxEmployees) return err(`The limit is ${db.maxEmployees} employees. Raise it first.`);
  const salt = uid() + uid();
  db.users.push({id: uid(), name, username, role, salt, hash: await hashPw(pw, salt), active: true, created: Date.now()});
  addLog({type:'staff', text:`added ${role === 'admin' ? 'administrator' : 'employee'} ${name} (@${username})`});
  toast(`${name} added. Give them their username and password.`); render();
}
function removeUser(id){
  if (armed !== 'rm' + id){ armed = 'rm' + id; $('#rm-' + id).textContent = 'Tap again'; return; }
  const u = db.users.find(x => x.id === id);
  u.active = false;
  addLog({type:'staff', text:`removed ${u.name} (@${u.username})`});
  armed = null; save(); toast(`${u.name} can no longer log in`); render();
}
function resetPw(id){
  const u = db.users.find(x => x.id === id);
  openModal(`
    <div class="sheethead"><h2>Reset password</h2><button class="ghost sm" onclick="closeModal()">Close</button></div>
    <p class="muted">New password for ${esc(u.name)} (@${esc(u.username)})</p>
    ${pwField('rp_pw', 'At least 8 letters and numbers')}
    <div id="rp_err" class="err"></div>
    <button class="primary block" onclick="doResetPw('${id}')">Save new password</button>`);
}
async function doResetPw(id){
  const u = db.users.find(x => x.id === id), pw = $('#rp_pw').value;
  const prob = pwProblem(pw); if (prob){ $('#rp_err').textContent = prob; return; }
  u.salt = uid() + uid(); u.hash = await hashPw(pw, u.salt);
  addLog({type:'staff', text:`reset the password of ${u.name}`});
  closeModal(); toast('Password reset. Tell them the new one.');
}
async function changePw(){
  const err = m => { $('#s_err').textContent = m; };
  if ((await hashPw($('#s_old').value, me.salt)) !== me.hash) return err('Current password is wrong.');
  const pw = $('#s_new').value, prob = pwProblem(pw); if (prob) return err(prob);
  me.salt = uid() + uid(); me.hash = await hashPw(pw, me.salt);
  addLog({type:'staff', text:'changed their own password'});
  toast('Password changed'); render();
}
function saveFarm(){
  const n = $('#s_farm').value.trim(); if (!n || n === db.farm) return;
  addLog({type:'staff', text:`renamed the business from ${db.farm} to ${n}`});
  db.farm = n; save(); toast('Name saved'); render();
}

/* ================= modal ================= */
function openModal(html){ $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); armed = null; }

/* ================= camera scanner ================= */
let scanner = null, scanCb = null;
function openScanner(cb){
  scanCb = cb;
  $('#manualcode').value = '';
  $('#scan').classList.remove('hidden');
  $('#scanmsg').textContent = 'Point the camera at the barcode.';
  if (!window.Html5Qrcode){ $('#scanmsg').textContent = 'The scanner could not load. Type the barcode below.'; return; }
  try {
    // only look for shop barcodes (faster and more reliable), and use the phone's built-in barcode reader when it has one
    const F = window.Html5QrcodeSupportedFormats || {};
    const formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE].filter(x => x !== undefined);
    scanner = new Html5Qrcode('reader', {verbose: false, formatsToSupport: formats, experimentalFeatures: {useBarCodeDetectorIfSupported: true}});
    scanner.start(
      {facingMode: 'environment'},
      {fps: 15,
       qrbox: (w, h) => ({width: Math.floor(Math.min(420, w * 0.92)), height: Math.floor(Math.min(200, h * 0.55))}),
       videoConstraints: {facingMode: 'environment', width: {ideal: 1920}, height: {ideal: 1080}, advanced: [{focusMode: 'continuous'}]}},
      code => { const c = scanCb; closeScanner(); if (navigator.vibrate) navigator.vibrate(80); if (c) c(code); },
      () => {}
    ).catch(() => { $('#scanmsg').textContent = 'Camera is not available. Allow camera access, or type the barcode below.'; });
  } catch(e){ $('#scanmsg').textContent = 'Camera is not available. Type the barcode below.'; }
}
function useManual(){ const v = $('#manualcode').value.trim(); if (!v) return; const c = scanCb; closeScanner(); if (c) c(v); }
function closeScanner(){
  $('#scan').classList.add('hidden');
  if (scanner){ const s = scanner; scanner = null; s.stop().then(() => s.clear()).catch(() => { try { s.clear(); } catch(e){} }); }
}

render();

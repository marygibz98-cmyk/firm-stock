/* =====================================================
   FIRM STOCK: stock and sales portal (online version)
   All records are saved in Supabase, so every phone sees the same stock.
   ===================================================== */

/* ---------- connection ---------- */
const SB_URL = 'https://ouokszfefokhvacnjwby.supabase.co';
const SB_KEY = 'sb_publishable_OJOEgYEZBQh13zHDXR_kAg_QALe198Y';
const EMAIL_DOMAIN = 'staff.firmstock.app';      // usernames become hidden login emails
const sb = window.supabase.createClient(SB_URL, SB_KEY);
const emailOf = u => `${u}@${EMAIL_DOMAIN}`;

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ksh = n => 'KSh ' + Math.round(n || 0).toLocaleString();
const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;
const pl = (w, n) => n === 1 ? w : (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const int = v => Math.max(0, Math.round(num(v)));
const when = t => new Date(t).toLocaleString([], {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
const startOfDay = () => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); };
const fv = k => $('#' + k) ? $('#' + k).value.trim() : '';
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3000);
}
function errMsg(e){
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/EMPLOYEE_LIMIT/.test(m)) return 'All employee places are used. Raise the limit first.';
  if (/LIMIT_TOO_LOW/.test(m)) return 'More employees are active than that number. Remove someone first.';
  if (/STOCK_LOCKED/.test(m)) return 'Stock numbers change only through sales, restocks or admin corrections.';
  if (/NOT_ENOUGH/.test(m)) return 'Not enough stock of ' + (m.split('NOT_ENOUGH:')[1] || '').trim();
  if (/already registered/i.test(m)) return 'That username is already taken.';
  if (/duplicate key|23505/i.test(m)) return /barcode/i.test(m) ? 'Another product already uses this barcode.' : 'That name or username is already used.';
  if (/NOT_ALLOWED|row-level security|permission denied/i.test(m)) return 'You are not allowed to do that.';
  if (/WEAK_PASSWORD|Password should/i.test(m)) return 'Password is too weak. Use at least 8 letters and numbers.';
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return 'No internet connection. Check the network and try again.';
  return 'Something went wrong: ' + m;
}
function pwProblem(pw){
  if (pw.length < 8) return 'Password needs at least 8 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use both letters and numbers in the password.';
  return '';
}
const pwField = (id, ph) => `<div class="pw"><input id="${id}" type="password" autocomplete="off" placeholder="${ph || 'Password'}"><button type="button" onclick="const i=$('#${id}');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide'">Show</button></div>`;
let busy = false;
async function once(fn){ if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }

/* ---------- data kept in memory (loaded from Supabase) ---------- */
let settings = {farm: 'Shamba Stores', max_employees: 2};
let products = [], staff = [], me = null, hasAdmin = true;

const fromDb = r => ({id: r.id, name: r.name, base: r.base, variant: r.variant, sizeVal: r.size_val, sizeUnit: r.size_unit,
  barcode: r.barcode || '', sellAs: r.sell_as, unit: r.unit, pack: r.pack, per: r.per, price: +r.price, packPrice: +r.pack_price,
  cost: +r.cost, low: r.low, stock: r.stock});
const toDb = d => ({name: d.name, base: d.base, variant: d.variant || null, size_val: d.sizeVal || null, size_unit: d.sizeUnit || null,
  barcode: d.barcode || null, sell_as: d.sellAs, unit: d.unit, pack: d.pack, per: d.per, price: d.price, pack_price: d.packPrice,
  cost: d.cost, low: d.low});

async function loadSettings(){
  const {data} = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
  if (data) settings = data;
}
async function loadProducts(){
  const {data, error} = await sb.from('products').select('*').order('name');
  if (error) throw error;
  products = data.map(fromDb);
}
async function loadStaff(){
  if (!isAdmin()) { staff = me ? [me] : []; return; }
  const {data, error} = await sb.from('staff').select('*').order('created_at');
  if (error) throw error;
  staff = data;
}
async function loadMe(){
  const {data: {user}} = await sb.auth.getUser();
  if (!user) return false;
  const {data} = await sb.from('staff').select('*').eq('id', user.id).maybeSingle();
  if (!data || !data.active){ await sb.auth.signOut(); me = null; return false; }
  me = data; return true;
}
async function logHist(type, text){
  try { await sb.from('history').insert({type, text}); } catch(e){}
}

/* ---------- product helpers ---------- */
const prod = id => products.find(p => p.id === id);
const modesOf = p => p.sellAs === 'both' ? ['pack','unit'] : p.sellAs === 'boxes' ? ['pack'] : ['unit'];
const stockUnit = p => p.sellAs === 'boxes' ? p.pack : p.unit;
const factor = (p, mode) => (p.sellAs === 'both' && mode === 'pack') ? p.per : 1;
const priceFor = (p, mode) => mode === 'pack' ? p.packPrice : p.price;
const labelFor = (p, mode) => mode === 'pack' ? p.pack : p.unit;
const unitValue = p => p.sellAs === 'boxes' ? p.packPrice : p.price;
const isAdmin = () => me && me.role === 'admin';
function split(p){ return p.sellAs === 'both' ? {boxes: Math.floor(p.stock / p.per), loose: p.stock % p.per} : null; }
function fmtStock(p){
  const s = p.stock, sp = split(p);
  if (sp && sp.boxes) return `${sp.boxes} ${pl(p.pack, sp.boxes)}${sp.loose ? ` + ${sp.loose} ${pl(p.unit, sp.loose)}` : ''} (${s} ${pl(p.unit, s)})`;
  return `${s} ${pl(stockUnit(p), s)}`;
}

/* =====================================================
   START, SET UP, LOG IN, LOG OUT
   ===================================================== */
function showLoading(msg){ $('#app').innerHTML = `<div class="login"><div class="brand"><div class="logo">🌾</div><p>${esc(msg || 'Loading…')}</p></div></div>`; }

async function boot(){
  showLoading();
  try {
    await loadSettings();
    const {data} = await sb.rpc('has_admin');
    hasAdmin = !!data;
    const {data: {session}} = await sb.auth.getSession();
    if (session && await loadMe()){
      await loadProducts(); await loadStaff();
      tab = 'stock'; return render();
    }
  } catch(e){ return showError(e); }
  renderLogin();
}
function showError(e){
  $('#app').innerHTML = `<div class="login"><div class="brand"><div class="logo">🌾</div><h1>Can’t connect</h1><p>${esc(errMsg(e))}</p></div><button class="primary block" onclick="boot()">Try again</button></div>`;
}

/* ---- first time: create the administrator ---- */
function renderSetup(err){
  $('#app').innerHTML = `
  <div class="login">
    <div class="brand"><div class="logo">🌾</div><h1>Welcome</h1><p>Set up the administrator account</p></div>
    <div class="card">
      <label for="su_farm">Business name</label><input id="su_farm" value="${esc(settings.farm)}">
      <label for="su_name">Your full name</label><input id="su_name" placeholder="e.g. Mary Wanjiku">
      <label for="su_user">Username</label><input id="su_user" autocapitalize="off" placeholder="e.g. mary">
      <label for="su_pw">Password</label>${pwField('su_pw', 'At least 8 letters and numbers')}
      <label for="su_pw2">Type the password again</label>${pwField('su_pw2', 'Same password')}
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
      <button class="primary block" onclick="doSetup()">Create administrator</button>
    </div>
  </div>`;
}
function doSetup(){ return once(async () => {
  const farm = fv('su_farm'), name = fv('su_name'), username = fv('su_user').toLowerCase();
  const pw = $('#su_pw').value, pw2 = $('#su_pw2').value;
  if (!name || !username) return renderSetup('Enter your name and a username.');
  if (!/^[a-z0-9._-]{3,}$/.test(username)) return renderSetup('Username: at least 3 letters or numbers, no spaces.');
  const prob = pwProblem(pw); if (prob) return renderSetup(prob);
  if (pw !== pw2) return renderSetup('The two passwords do not match.');
  showLoading('Creating your account…');
  const {data, error} = await sb.auth.signUp({email: emailOf(username), password: pw});
  if (error) return renderSetup(errMsg(error));
  if (!data.session) return renderSetup('Supabase is still asking for email confirmation. Turn off “Confirm email” in Supabase, then try again.');
  const {error: e2} = await sb.from('staff').insert({id: data.user.id, name, username, role: 'admin'});
  if (e2){ await sb.auth.signOut(); return renderSetup(errMsg(e2)); }
  if (farm && farm !== settings.farm) await sb.from('settings').update({farm}).eq('id', 1);
  await loadMe(); await loadSettings();
  hasAdmin = true;
  await logHist('staff', 'created the administrator account');
  await loadProducts(); await loadStaff();
  tab = 'stock'; render();
}); }

/* ---- login ---- */
let loginRole = 'employee', loginErr = '', fails = 0, lockUntil = 0;
function renderLogin(){
  if (!hasAdmin) return renderSetup();
  $('#app').innerHTML = `
  <div class="login">
    <div class="brand"><div class="logo">🌾</div><h1>${esc(settings.farm)}</h1><p>Stock and sales</p></div>
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
function doLogin(){ return once(async () => {
  if (Date.now() < lockUntil){ loginErr = `Too many wrong tries. Wait ${Math.ceil((lockUntil - Date.now()) / 1000)} seconds.`; return renderLogin(); }
  const username = fv('lu').toLowerCase(), pw = $('#lp').value;
  if (!username || !pw){ loginErr = 'Enter your username and password.'; return renderLogin(); }
  showLoading('Logging in…');
  const {error} = await sb.auth.signInWithPassword({email: emailOf(username), password: pw});
  if (error){
    fails++;
    if (/Failed to fetch|network/i.test(error.message)) loginErr = errMsg(error);
    else if (fails >= 5){ lockUntil = Date.now() + 30000; fails = 0; loginErr = 'Too many wrong tries. Wait 30 seconds.'; }
    else loginErr = 'Wrong username or password.';
    return renderLogin();
  }
  if (!(await loadMe())){ loginErr = 'This account has been removed. Speak to the administrator.'; return renderLogin(); }
  if (me.role !== loginRole){
    await sb.auth.signOut();
    loginErr = loginRole === 'admin' ? 'This is not an administrator account.' : 'This is an administrator account. Choose “Administrator” above.';
    me = null; return renderLogin();
  }
  fails = 0;
  await logHist('login', 'logged in');
  try { await loadProducts(); await loadStaff(); } catch(e){ return showError(e); }
  tab = 'stock'; render();
}); }
async function logout(){
  if (me) await logHist('logout', 'logged out');
  await sb.auth.signOut();
  me = null; cart = []; loginErr = '';
  renderLogin();
}

/* =====================================================
   SHELL
   ===================================================== */
let tab = 'stock', armed = null;
async function go(t){
  tab = t; armed = null; render(); window.scrollTo(0, 0);
  try { await loadProducts(); if (isAdmin()) await loadStaff(); if (tab === t && modalClosed()) render(); } catch(e){}
}
const modalClosed = () => $('#modal').classList.contains('hidden') && $('#scan').classList.contains('hidden');
function render(){
  if (!me) return renderLogin();
  const tabs = [['stock','Stock','📦'], ['sell','Sell','🛒'], ['restock','Restock','🚚']];
  if (isAdmin()) tabs.push(['reports','Reports','📊'], ['history','History','🕘'], ['team','Team','👥']);
  if (!tabs.find(t => t[0] === tab)) tab = 'stock';
  $('#app').innerHTML = `
    <header class="top">
      <div><div class="farm">${esc(settings.farm)}</div><div class="who">${esc(me.name)}, ${isAdmin() ? 'administrator' : 'employee'}</div></div>
      <button class="ghost sm" onclick="logout()">Log out</button>
    </header>
    <main id="main"></main>
    <nav class="nav">${tabs.map(t => `<button class="${tab===t[0]?'on':''}" onclick="go('${t[0]}')"><span>${t[2]}</span>${t[1]}</button>`).join('')}</nav>`;
  ({stock: viewStock, sell: viewSell, restock: viewRestock, reports: viewReports, history: viewHistory, team: viewTeam})[tab]();
}
// keep the screen fresh so the admin sees employees’ work without reloading
setInterval(async () => {
  if (!me || busy || !modalClosed() || document.hidden) return;
  if (document.activeElement && ['INPUT','SELECT'].includes(document.activeElement.tagName)) return;
  if (!['stock','reports','history'].includes(tab)) return;
  try { await loadProducts(); render(); } catch(e){}
}, 30000);

/* =====================================================
   STOCK
   ===================================================== */
let q = '';
function viewStock(){
  const low = products.filter(p => p.stock <= p.low);
  const val = products.reduce((s, p) => s + p.stock * unitValue(p), 0);
  $('#main').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${products.length}</b><span>Products</span></div>
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
  const ps = products.filter(p => p.name.toLowerCase().includes(s) || (p.barcode || '').includes(s))
    .sort((a, b) => (a.stock <= a.low ? 0 : 1) - (b.stock <= b.low ? 0 : 1) || a.name.localeCompare(b.name));
  $('#plist').innerHTML = ps.length ? ps.map(p => `
    <button class="item" onclick="editProduct('${p.id}')">
      <div><div class="name">${esc(p.name)}</div>
        <div class="sub">${modesOf(p).map(m => `${ksh(priceFor(p, m))} per ${esc(labelFor(p, m))}`).join(', ')}</div>
        <div class="sub">${fmtStock(p)}</div></div>
      <div class="right"><div class="count">${p.stock}</div><div class="sub">${esc(pl(stockUnit(p), p.stock))}</div>${p.stock <= p.low ? '<span class="badge">Low</span>' : ''}</div>
    </button>`).join('') : `<p class="muted center">${products.length ? 'No products match.' : 'No products yet. Tap “Add product”, or scan one from Restock.'}</p>`;
}

/* ---- stock statement ---- */
function statementRows(){
  return products.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    const sp = split(p);
    return {name: p.name, barcode: p.barcode || '',
      boxes: sp ? sp.boxes : (p.sellAs === 'boxes' ? p.stock : 0), boxLabel: p.pack,
      items: sp ? sp.loose : (p.sellAs === 'items' ? p.stock : 0), itemLabel: p.unit,
      total: p.stock, unit: stockUnit(p),
      priceItem: p.sellAs === 'boxes' ? '' : p.price, priceBox: p.sellAs === 'items' ? '' : p.packPrice,
      value: p.stock * unitValue(p)};
  });
}
function showStatement(){
  const rows = statementRows(), total = rows.reduce((a, r) => a + r.value, 0);
  openModal(`
    <div class="sheethead"><h2>Stock statement</h2><button class="ghost sm" onclick="closeModal()">Close</button></div>
    <p class="muted">${esc(settings.farm)}, ${when(Date.now())}</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Product</th><th class="n">Boxes</th><th class="n">Single items</th><th class="n">Total</th><th class="n">Value</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${r.boxes ? `${r.boxes} ${esc(pl(r.boxLabel, r.boxes))}` : '–'}</td><td class="n">${r.items ? `${r.items} ${esc(pl(r.itemLabel, r.items))}` : '–'}</td><td class="n">${r.total} ${esc(pl(r.unit, r.total))}</td><td class="n">${ksh(r.value)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="total"><span>Total stock value</span><span class="big">${ksh(total)}</span></div>
    <button class="primary block" onclick="downloadStatement()">Download for Excel (CSV)</button>
    <p class="note">The download has empty “Counted” and “Difference” columns to fill in while counting.</p>`);
}
async function downloadStatement(){
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [[`${settings.farm} stock statement`], [`Date: ${when(Date.now())}`], [`Prepared by: ${me.name}`], [],
    ['Product','Barcode','Full boxes','Box type','Single items','Item type','Total in stock','Counted in','Counted (fill in)','Difference','Price per item (KSh)','Price per box (KSh)','Value (KSh)']];
  statementRows().forEach(r => lines.push([r.name, r.barcode, r.boxes, r.boxLabel, r.items, r.itemLabel, r.total, pl(r.unit, 2), '', '', r.priceItem, r.priceBox, Math.round(r.value)]));
  const csv = '\uFEFF' + lines.map(l => l.map(cell).join(',')).join('\r\n');
  const d = new Date(), filename = `stock-statement-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  await logHist('download', 'downloaded the stock statement');
  toast('Statement downloaded');
}

/* =====================================================
   PRODUCT FORM
   ===================================================== */
let editCb = null, formSell = 'both';
const UNITS = ['piece','bottle','can','packet','container','sachet','tin','egg','kg','litre','sack'];
const PACKS = ['box','carton','crate','tray','bale','sack','pack','dozen'];
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
const priceLabel = x => modesOf(x).map(m => `${ksh(priceFor(x, m))} per ${labelFor(x, m)}`).join(', ');

function saveProduct(id){ return once(async () => {
  const err = m => { $('#f_err').textContent = m; $('#f_err').scrollIntoView({block:'nearest'}); };
  const old = id ? prod(id) : null, admin = isAdmin(), sellAs = formSell;
  const base = fv('f_base'), variant = fv('f_var'), sizeVal = num(fv('f_sv')) || '', sizeUnit = sizeVal ? fv('f_su') : '';
  if (!base) return err('Write the product name, or scan it.');
  const name = composeName(base, variant, sizeVal, sizeUnit), code = fv('f_code');
  if (code && products.some(x => x.barcode === code && x.id !== id)) return err('Another product already uses this barcode.');
  if (products.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return err('A product with this exact name already exists.');
  const per = sellAs === 'both' ? int(fv('f_per')) : 1;
  if (sellAs === 'both' && per < 2) return err('Write how many single items are in one box.');
  const price = num(fv('f_price')), packPrice = num(fv('f_pprice')), costIn = num(fv('f_cost'));
  if (sellAs !== 'boxes' && price <= 0) return err('Write the selling price per single item.');
  if (sellAs !== 'items' && packPrice <= 0) return err('Write the selling price per box.');
  const data = {name, base, variant, sizeVal, sizeUnit, barcode: code, sellAs, per,
    unit: (fv('f_unit') || 'item').toLowerCase(), pack: (fv('f_pack') || 'box').toLowerCase(),
    price: sellAs === 'boxes' ? 0 : price, packPrice: sellAs === 'items' ? 0 : packPrice,
    cost: sellAs === 'both' ? costIn / per : costIn, low: int(fv('f_low'))};
  const b = int(fv('f_cb')), i = int(fv('f_ci'));

  if (old){
    const {data: row, error} = await sb.from('products').update(toDb(data)).eq('id', id).select().single();
    if (error) return err(errMsg(error));
    const next = fromDb(row);
    if (priceLabel(old) !== priceLabel(next)) await logHist('price', `changed selling prices of ${name}: ${priceLabel(next)} (was ${priceLabel(old)})`);
    const changed = ['name','barcode','sellAs','per','unit','pack','low'].filter(k => String(old[k] ?? '') !== String(next[k] ?? ''));
    if (Math.abs((old.cost || 0) - next.cost) > 0.001) changed.push('buying price');
    if (changed.length) await logHist('product', `edited ${name} (${changed.join(', ')})`);
    if (old.stock !== next.stock) await logHist('adjust', `changed how ${name} is counted, balance converted: ${fmtStock(old)} → ${fmtStock(next)}`);
    if (admin && $('#f_cb') && old.sellAs === sellAs){
      const c = sellAs === 'both' ? b * per + i : sellAs === 'boxes' ? b : i;
      if (c !== next.stock){
        const {error: e2} = await sb.rpc('adjust_stock', {p_id: id, p_stock: c});
        if (e2) toast(errMsg(e2));
      }
    }
    await loadProducts(); closeModal(); toast('Saved'); render();
  } else {
    const {data: row, error} = await sb.from('products').insert(toDb(data)).select().single();
    if (error) return err(errMsg(error));
    await logHist('product', `added product ${name}${code ? ` (barcode ${code})` : ''}, ${priceLabel(fromDb(row))}`);
    // what was received now is saved as a restock, so it appears in the history
    if (sellAs === 'both'){
      if (b > 0) await sb.rpc('restock', {p_id: row.id, p_qty: b, p_mode: 'pack', p_cost: null, p_note: 'received'});
      if (i > 0) await sb.rpc('restock', {p_id: row.id, p_qty: i, p_mode: 'unit', p_cost: null, p_note: 'received'});
    } else {
      const n = sellAs === 'boxes' ? b : i;
      if (n > 0) await sb.rpc('restock', {p_id: row.id, p_qty: n, p_mode: sellAs === 'boxes' ? 'pack' : 'unit', p_cost: null, p_note: 'received'});
    }
    await loadProducts();
    const p = prod(row.id);
    closeModal(); toast(p && p.stock ? `${name} saved: ${fmtStock(p)}` : `${name} saved`);
    const cb = editCb; editCb = null;
    if (cb) cb(row.id); else render();
  }
}); }
function deleteProduct(id){
  if (armed !== 'del'){ armed = 'del'; $('#delbtn').textContent = 'Tap again to delete for good'; return; }
  return once(async () => {
    const p = prod(id);
    const {error} = await sb.from('products').delete().eq('id', id);
    if (error) return toast(errMsg(error));
    await logHist('product', `deleted product ${p.name} (had ${fmtStock(p)})`);
    armed = null; await loadProducts(); closeModal(); toast('Product deleted'); render();
  });
}

/* ---- name and size from the barcode (free online product list) ---- */
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
async function autoLookup(code){
  const st = $('#f_status'); if (!st) return;
  st.textContent = 'Looking up this barcode…';
  const r = await lookupBarcode(code);
  if (!$('#f_status')) return;
  if (r && r.base){
    if (!$('#f_base').value) $('#f_base').value = r.base;
    if (r.sizeVal && !$('#f_sv').value){ $('#f_sv').value = r.sizeVal; $('#f_su').value = r.sizeUnit || ''; }
    st.textContent = 'Found it. Check the name and size, then add the box size and prices.';
  } else st.textContent = 'Not found online. Type the name and size.';
}

/* =====================================================
   SELL + RESTOCK PICKER
   ===================================================== */
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
      ${products.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
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
async function found(m, code){
  code = String(code || '').trim();
  if (!code) return;
  try { await loadProducts(); } catch(e){}
  const p = products.find(x => x.barcode === code);
  if (p){ if (navigator.vibrate) navigator.vibrate(60); choose(m, p.id); toast(p.name); return; }
  toast('New barcode. Add the product details.');
  editProduct(null, code, id => choose(m, id));   // after saving, it is picked automatically
}

/* =====================================================
   SELL
   ===================================================== */
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
  cart.push({pid: p.id, name: p.name, qty: s.qty, mode: s.mode, label: labelFor(p, s.mode), each, total: each * s.qty, units: u});
  pick.sell = {id: null, mode: 'unit', qty: 1};
  render();
}
function completeSale(){ return once(async () => {
  if (!cart.length) return;
  const paidBy = pay;
  const {data, error} = await sb.rpc('record_sale', {p_items: cart.map(c => ({pid: c.pid, qty: c.qty, mode: c.mode})), p_pay: paidBy});
  if (error){ toast(errMsg(error)); try { await loadProducts(); render(); } catch(e){} return; }
  cart = []; pay = 'Cash';
  await loadProducts(); render();
  openModal(`
    <div class="sheethead"><h2>Sale recorded</h2><button class="ghost sm" onclick="closeModal()">Done</button></div>
    <p class="muted">Receipt ${esc(data.receipt)}, ${when(Date.now())}, served by ${esc(me.name)}</p>
    ${data.items.map(c => `<div class="kv"><span>${c.qty} ${esc(pl(c.label, c.qty))} ${esc(c.name)}</span><b>${ksh(c.total)}</b></div>`).join('')}
    <div class="total"><span>Total</span><span class="big">${ksh(data.total)}</span></div>
    <div class="kv"><span>Paid by</span><b>${esc(paidBy)}</b></div>
    <h3>Now in stock</h3>
    ${data.after.map(a => `<div class="kv"><span>${esc(a.name)}</span><span>${esc(a.stock_text)}${a.low ? ' <span class="badge">Low</span>' : ''}</span></div>`).join('')}`);
}); }

/* =====================================================
   RESTOCK
   ===================================================== */
function viewRestock(){ $('#main').innerHTML = pickerHTML('restock'); updateSum('restock'); }
function doRestock(){ return once(async () => {
  const s = pick.restock, p = prod(s.id); if (!p) return;
  const c = $('#cost-restock') ? num($('#cost-restock').value) : 0;
  const {data, error} = await sb.rpc('restock', {p_id: p.id, p_qty: s.qty, p_mode: s.mode, p_cost: c > 0 ? c : null, p_note: 'restocked'});
  if (error) return toast(errMsg(error));
  pick.restock = {id: null, mode: 'pack', qty: 1};
  await loadProducts();
  const n = prod(p.id);
  toast(`${p.name}: now ${n ? fmtStock(n) : data.stock}`);
  render();
}); }

/* =====================================================
   REPORTS + HISTORY (admin)
   ===================================================== */
let range = 'today', staffF = '', typeF = '', histLimit = 100;
const rangeStart = () => range === 'today' ? startOfDay() : range === 'week' ? Date.now() - 7 * 864e5 : range === 'month' ? Date.now() - 30 * 864e5 : 0;
const rangeSeg = () => `<div class="seg" style="margin-bottom:10px">${[['today','Today'],['week','7 days'],['month','30 days'],['all','All time']].map(([k, t]) => `<button class="${range===k?'on':''}" onclick="range='${k}';histLimit=100;render()">${t}</button>`).join('')}</div>`;
const staffSelect = style => `<select aria-label="Staff" onchange="staffF=this.value;histLimit=100;render()" style="${style || 'margin-bottom:14px'}"><option value="">Everyone</option>${staff.map(u => `<option value="${u.id}" ${staffF===u.id?'selected':''}>${esc(u.name)}${u.active ? '' : ' (former)'}</option>`).join('')}</select>`;
function histQuery(){
  let qy = sb.from('history').select('*', {count: 'exact'}).gte('t', new Date(rangeStart()).toISOString()).order('t', {ascending: false});
  if (staffF) qy = qy.eq('user_id', staffF);
  return qy;
}

async function viewReports(){
  $('#main').innerHTML = rangeSeg() + staffSelect() + '<p class="muted center">Loading report…</p>';
  const [{data: logs, error}, lastLogins] = await Promise.all([
    histQuery().in('type', ['sale', 'restock', 'login']).limit(5000),
    Promise.all(staff.map(u => sb.from('history').select('t').eq('user_id', u.id).eq('type', 'login').order('t', {ascending: false}).limit(1)))
  ]);
  if (tab !== 'reports') return;
  if (error){ $('#main').innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  const sales = logs.filter(l => l.type === 'sale');
  const total = sales.reduce((a, l) => a + +l.total, 0);
  const profit = sales.reduce((a, l) => a + (l.items || []).reduce((b, i) => b + +i.total - (+i.cost || 0), 0), 0);
  const group = (arr, key, val) => arr.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + val(x); return m; }, {});
  const rows = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${ksh(v)}</b></div>`).join('') || '<p class="muted">No sales in this period.</p>';
  const low = products.filter(p => p.stock <= p.low);
  const people = staff.map((u, i) => ({u, last: lastLogins[i].data && lastLogins[i].data[0]})).filter(x => !staffF || x.u.id === staffF).map(({u, last}) => {
    const mine = logs.filter(l => l.user_id === u.id), ms = mine.filter(l => l.type === 'sale');
    return {u, amount: ms.reduce((a, l) => a + +l.total, 0), receipts: ms.length, restocks: mine.filter(l => l.type === 'restock').length,
      logins: mine.filter(l => l.type === 'login').length, last: last ? when(last.t) : 'Never'};
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
        <tbody>${people.map(s => `<tr><td><b>${esc(s.u.name)}</b>${s.u.active ? '' : ' <span class="muted">(former)</span>'}</td><td class="n">${ksh(s.amount)}</td><td class="n">${s.receipts}</td><td class="n">${s.restocks}</td><td class="n">${s.logins}</td><td>${s.last}</td></tr>`).join('')}</tbody>
      </table></div>
      <button class="ghost block" onclick="go('history')">See full history</button>
    </div>
    ${low.length ? `<div class="card"><h2>Restock soon</h2>${low.map(p => `<div class="kv"><span>${esc(p.name)}</span><b style="color:var(--low)">${fmtStock(p)}</b></div>`).join('')}</div>` : ''}
    <div class="card"><h2>Best sellers</h2>${rows(group(sales.flatMap(l => l.items || []), i => i.name, i => +i.total))}</div>
    <div class="card"><h2>Money by payment type</h2>${rows(group(sales, l => l.pay, l => +l.total))}</div>`;
}

const TYPES = [['','Everything'],['login','Logins and logouts'],['sale','Sales'],['restock','Restocks'],['adjust','Stock corrections'],['price','Price changes'],['product','Product changes'],['staff','Staff changes'],['download','Downloads']];
async function viewHistory(){
  const filters = `${rangeSeg()}
    <div class="row" style="margin-bottom:14px">
      ${staffSelect('margin:0')}
      <select aria-label="Type" onchange="typeF=this.value;histLimit=100;render()">${TYPES.map(([k, t]) => `<option value="${k}" ${typeF===k?'selected':''}>${t}</option>`).join('')}</select>
    </div>`;
  $('#main').innerHTML = filters + '<p class="muted center">Loading history…</p>';
  let qy = histQuery();
  if (typeF === 'login') qy = qy.in('type', ['login', 'logout']); else if (typeF) qy = qy.eq('type', typeF);
  const {data: list, count, error} = await qy.limit(histLimit);
  if (tab !== 'history') return;
  if (error){ $('#main').innerHTML = filters + `<p class="err">${esc(errMsg(error))}</p>`; return; }
  $('#main').innerHTML = `${filters}
    <div class="card">
      <h2>History</h2>
      <p class="note" style="margin-top:-6px;margin-bottom:8px">${count ?? list.length} records. History is kept for good and cannot be edited or deleted.</p>
      ${list.map(l => `<div class="log"><time>${when(l.t)}${l.receipt ? `, receipt ${esc(l.receipt)}` : ''}</time><b>${esc(l.user_name || 'System')}</b> ${esc(l.text || '')}</div>`).join('') || '<p class="muted">Nothing recorded in this period.</p>'}
      ${(count || 0) > list.length ? `<button class="ghost block" onclick="histLimit+=100;render()">Show more</button>` : ''}
    </div>`;
}

/* =====================================================
   TEAM (admin)
   ===================================================== */
const activeEmployees = () => staff.filter(u => u.role === 'employee' && u.active);
function viewTeam(){
  const emps = activeEmployees(), admins = staff.filter(u => u.role === 'admin' && u.active), former = staff.filter(u => !u.active);
  const full = emps.length >= settings.max_employees;
  const row = u => `<div class="kv"><span><b>${esc(u.name)}</b><br><span class="muted">@${esc(u.username)}</span></span>
    ${u.id === me.id ? '<span class="muted">You</span>' : `<span class="row fit"><button class="ghost sm" onclick="resetPw('${u.id}')">Reset password</button><button class="danger sm" id="rm-${u.id}" onclick="removeUser('${u.id}')">Remove</button></span>`}</div>`;
  $('#main').innerHTML = `
    <div class="card">
      <h2>Employee limit</h2>
      <p class="muted" style="margin-top:-6px">${emps.length} of ${settings.max_employees} employee places used. Only this many employees can have accounts and log in.</p>
      <div class="stepper">
        <button aria-label="Fewer" onclick="setLimit(-1)">−</button>
        <input id="lim" type="number" min="1" inputmode="numeric" value="${settings.max_employees}" onchange="setLimit(0, this.value)">
        <button aria-label="More" onclick="setLimit(1)">+</button>
      </div>
    </div>
    <div class="card">
      <h2>Employees</h2>
      ${emps.map(row).join('') || '<p class="muted">No employees yet.</p>'}
      <h3>Add a staff member</h3>
      ${full ? `<p class="note">All ${settings.max_employees} employee places are used. Raise the limit above to add another employee.</p>` : ''}
      <label for="nu_name">Full name</label><input id="nu_name" placeholder="e.g. John Otieno">
      <label for="nu_user">Username</label><input id="nu_user" autocapitalize="off" placeholder="e.g. john">
      <label for="nu_pw">Password for them</label>${pwField('nu_pw', 'At least 8 letters and numbers')}
      <label for="nu_role">Role</label>
      <select id="nu_role"><option value="employee">Employee</option><option value="admin">Administrator</option></select>
      <div id="nu_err" class="err"></div>
      <button class="primary block" onclick="addUser()">Add staff member</button>
    </div>
    <div class="card"><h2>Administrators</h2>${admins.map(row).join('')}</div>
    ${former.length ? `<div class="card"><h2>Former staff</h2><p class="note" style="margin-top:-6px">They can no longer log in. Their history is kept.</p>${former.map(u => `<div class="kv"><span>${esc(u.name)} <span class="muted">@${esc(u.username)}</span></span><button class="ghost sm" onclick="bringBack('${u.id}')">Bring back</button></div>`).join('')}</div>` : ''}
    <div class="card"><h2>Settings</h2>
      <label for="s_farm">Business name</label>
      <div class="row"><input id="s_farm" value="${esc(settings.farm)}"><button class="ghost fit" onclick="saveFarm()">Save</button></div>
      <h3>Change my password</h3>
      <label for="s_old">Current password</label>${pwField('s_old', 'Current password')}
      <label for="s_new">New password</label>${pwField('s_new', 'At least 8 letters and numbers')}
      <div id="s_err" class="err"></div>
      <button class="ghost block" onclick="changePw()">Change password</button>
    </div>`;
}
function setLimit(d, v){ return once(async () => {
  let n = d ? settings.max_employees + d : int(v);
  if (n < 1) n = 1;
  const used = activeEmployees().length;
  if (n < used){ toast(`${used} employees are active. Remove someone first.`); return render(); }
  if (n === settings.max_employees) return render();
  const {error} = await sb.from('settings').update({max_employees: n}).eq('id', 1);
  if (error){ toast(errMsg(error)); return render(); }
  await logHist('staff', `changed the employee limit from ${settings.max_employees} to ${n}`);
  await loadSettings(); render();
}); }
function addUser(){ return once(async () => {
  const name = fv('nu_name'), username = fv('nu_user').toLowerCase(), pw = $('#nu_pw').value, role = $('#nu_role').value;
  const err = m => { $('#nu_err').textContent = m; };
  if (!name || !username) return err('Enter a full name and a username.');
  if (!/^[a-z0-9._-]{3,}$/.test(username)) return err('Username: at least 3 letters or numbers, no spaces.');
  if (staff.some(u => u.username === username)) return err('That username is already taken.');
  const prob = pwProblem(pw); if (prob) return err(prob);
  if (role === 'employee' && activeEmployees().length >= settings.max_employees) return err(`The limit is ${settings.max_employees} employees. Raise it first.`);
  err('Adding…');
  // a separate, temporary connection creates their login without logging the admin out
  const temp = window.supabase.createClient(SB_URL, SB_KEY, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'fs-temp'}});
  const {data, error} = await temp.auth.signUp({email: emailOf(username), password: pw});
  if (error || !data.user) return err(errMsg(error || 'Could not create the login'));
  const {error: e2} = await sb.from('staff').insert({id: data.user.id, name, username, role});
  if (e2) return err(errMsg(e2));
  await logHist('staff', `added ${role === 'admin' ? 'administrator' : 'employee'} ${name} (@${username})`);
  await loadStaff();
  toast(`${name} added. Give them their username and password.`); render();
}); }
function removeUser(id){
  if (armed !== 'rm' + id){ armed = 'rm' + id; $('#rm-' + id).textContent = 'Tap again'; return; }
  return once(async () => {
    const u = staff.find(x => x.id === id);
    const {error} = await sb.from('staff').update({active: false}).eq('id', id);
    if (error) return toast(errMsg(error));
    await logHist('staff', `removed ${u.name} (@${u.username})`);
    armed = null; await loadStaff(); toast(`${u.name} can no longer log in`); render();
  });
}
function bringBack(id){ return once(async () => {
  const u = staff.find(x => x.id === id);
  const {error} = await sb.from('staff').update({active: true}).eq('id', id);
  if (error) return toast(errMsg(error));
  await logHist('staff', `brought back ${u.name} (@${u.username})`);
  await loadStaff(); toast(`${u.name} can log in again`); render();
}); }
function resetPw(id){
  const u = staff.find(x => x.id === id);
  openModal(`
    <div class="sheethead"><h2>Reset password</h2><button class="ghost sm" onclick="closeModal()">Close</button></div>
    <p class="muted">New password for ${esc(u.name)} (@${esc(u.username)})</p>
    ${pwField('rp_pw', 'At least 8 letters and numbers')}
    <div id="rp_err" class="err"></div>
    <button class="primary block" onclick="doResetPw('${id}')">Save new password</button>`);
}
function doResetPw(id){ return once(async () => {
  const u = staff.find(x => x.id === id), pw = $('#rp_pw').value;
  const prob = pwProblem(pw); if (prob){ $('#rp_err').textContent = prob; return; }
  const {error} = await sb.rpc('admin_set_password', {p_user: id, p_password: pw});
  if (error){ $('#rp_err').textContent = errMsg(error); return; }
  await logHist('staff', `reset the password of ${u.name}`);
  closeModal(); toast('Password reset. Tell them the new one.');
}); }
function changePw(){ return once(async () => {
  const err = m => { $('#s_err').textContent = m; };
  const oldPw = $('#s_old').value, pw = $('#s_new').value;
  const prob = pwProblem(pw); if (prob) return err(prob);
  const {error: e1} = await sb.auth.signInWithPassword({email: emailOf(me.username), password: oldPw});
  if (e1) return err('Current password is wrong.');
  const {error} = await sb.auth.updateUser({password: pw});
  if (error) return err(errMsg(error));
  await logHist('staff', 'changed their own password');
  toast('Password changed'); render();
}); }
function saveFarm(){ return once(async () => {
  const n = fv('s_farm'); if (!n || n === settings.farm) return;
  const {error} = await sb.from('settings').update({farm: n}).eq('id', 1);
  if (error) return toast(errMsg(error));
  await logHist('staff', `renamed the business from ${settings.farm} to ${n}`);
  await loadSettings(); toast('Name saved'); render();
}); }

/* =====================================================
   POP-UP WINDOW + CAMERA SCANNER
   ===================================================== */
function openModal(html){ $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); armed = null; }

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

boot();

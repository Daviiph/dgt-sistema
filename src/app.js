let html2pdfLib = null;
const html2pdf = (...a) => html2pdfLib(...a);
async function loadPdfLib() { if (!html2pdfLib) html2pdfLib = (await import('html2pdf.js')).default; }
import { fetchAll, syncTables, saveSetting, createSale, cancelSale, deleteSaleRemote, importAll, listProfiles, updateProfile, listAudit, subscribeChanges, clean, sendInvoiceEmail, askPriceAssistant, onNetChange, flushOutbox, persistLocal, netState } from './data.js'
import { DEFAULT_COLOR, applyPalette, applyLogo, cacheBrand, currentColor, currentLogo, loadImageFile, analyzeLogo, normalizeBrand } from './theme.js'
import { saleTime as saleTimeOf, stampCaracas, previousRange as prevRangeOf, buckets as bucketsOf, rangeLabel } from './fechas.js'
import { loadPeriod, savePeriod, rangeOf, periodTitle, mountPeriod } from './periodo.js'
import { mountDonut, mountAreaChart, mountRankBars, gauge, groupBuckets, mountMiniBars, mountMiniLine } from './charts.js'

// STATE
let products = [], brands = [], customers = [], sellers = [], payments = [], sales = [], resale = [];
let brandColor = '', brandLogo = '';
// Modo de trabajo: 'tienda' (inventario propio) o 'reventa' (equipos conseguidos por fuera)
let appMode = localStorage.getItem('ns_mode') === 'reventa' ? 'reventa' : 'tienda';
let appCurrency = '$';
let globalRate = '36.50';
let currentProfile = null;
let bcvRate = localStorage.getItem('ns_rate_bcv') || globalRate;
let binanceRate = localStorage.getItem('ns_rate_binance') || globalRate;
let rateType = localStorage.getItem('ns_rate_type') || 'BCV';
let rateDate = localStorage.getItem('ns_rate_date') || '';
let cart = [];

const AVAILABLE_COLORS = [
    { name: 'Negro', hex: '#000000' }, { name: 'Blanco', hex: '#ffffff' },
    { name: 'Plata', hex: '#C0C0C0' }, { name: 'Oro', hex: '#FFD700' },
    { name: 'Azul', hex: '#0000FF' }, { name: 'Rojo', hex: '#FF0000' },
    { name: 'Verde', hex: '#008000' }, { name: 'Rosa', hex: '#FFC0CB' },
    { name: 'Gris', hex: '#808080' }, { name: 'Amarillo', hex: '#FFFF00' }
];

// THEME: el cambio se expande en círculo desde el botón (View Transitions; sin soporte, cambia directo)
function syncThemeButtons() {
    const dark = document.documentElement.classList.contains('dark');
    document.querySelectorAll('[data-theme-set]').forEach(b => { const on = (b.dataset.themeSet === 'dark') === dark; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
}
function setTheme(mode, btn) {
    const root = document.documentElement;
    const want = mode === 'dark';
    if (root.classList.contains('dark') === want) return;
    const apply = () => { root.classList.toggle('dark', want); try { localStorage.setItem('ns_theme', want ? 'dark' : 'light'); } catch {} syncThemeButtons(); };
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) return apply();
    const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: innerWidth - 40, top: 20, width: 0, height: 0 };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
        root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] }, { duration: 650, easing: 'cubic-bezier(.23,1,.32,1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
}
function toggleDarkMode(btn) { setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark', btn); }
if (localStorage.getItem('ns_theme') === 'dark') document.documentElement.classList.add('dark');
setTimeout(syncThemeButtons, 0);

// CURRENCY
function updateCurrency() {
    appCurrency = document.getElementById('config-currency').value;
    saveSetting('currency', appCurrency).catch(err => alert('No se pudo guardar: ' + err.message));
    updateDashboard();
    renderInventory();
    renderPOS();
}

function updateRate() {
    setDailyRate('BCV', document.getElementById('config-rate').value);
}

// TASAS DEL DÍA (BCV / BINANCE P2P)
const BS_METHOD_RE = /(bs|bol[ií]var|pago\s*m[oó]vil|transferencia|punto|biopago|d[eé]bito)/i;
const RATES_URL = 'https://icwlksxcrqlbpwvqyxxz.supabase.co/functions/v1/tasas';
let rateAuto = localStorage.getItem('ns_rate_auto') !== '0';
let rateLiveAt = localStorage.getItem('ns_rate_live_at') || '';
async function fetchLiveRates(userAction) {
    if (userAction) { rateAuto = true; localStorage.setItem('ns_rate_auto', '1'); }
    if (!rateAuto || !currentProfile) return;
    document.querySelectorAll('.rate-live-btn i').forEach(i => i.classList.add('fa-spin'));
    try {
        const r = await fetch(RATES_URL, { cache: 'no-store' });
        const d = await r.json();
        if (!d.bcv && !d.binance) throw new Error('sin datos');
        if (d.bcv) setDailyRate('BCV', d.bcv.rate, true);
        if (d.binance) setDailyRate('Binance P2P', d.binance.rate, true);
        rateLiveAt = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem('ns_rate_live_at', rateLiveAt);
        syncRateInputs();
        const saleRate = document.getElementById('sale-rate');
        if (saleRate && document.activeElement !== saleRate) { saleRate.value = getRate(rateType) || ''; if (typeof updateSettleBalance === 'function') updateSettleBalance(); }
    } catch (e) {
        if (userAction) alert('No se pudo obtener la tasa en vivo. Revise su conexión a internet o escríbala a mano.');
    } finally {
        document.querySelectorAll('.rate-live-btn i').forEach(i => i.classList.remove('fa-spin'));
    }
}
setInterval(() => fetchLiveRates(false), 10 * 60 * 1000);
function getRate(type) {
    return parseFloat(type === 'Binance P2P' ? binanceRate : bcvRate) || 0;
}
function setDailyRate(type, value, live) {
    const v = parseFloat(value);
    if (!live && v > 0) { rateAuto = false; localStorage.setItem('ns_rate_auto', '0'); }
    if (live && v === getRate(type) && rateDate === new Date().toLocaleDateString('es-VE')) return;
    if (!(v > 0)) { syncRateInputs(); return alert('Ingrese una tasa válida'); }
    if (type === 'Binance P2P') {
        binanceRate = String(v);
        saveSetting('rate_binance', binanceRate).catch(err => alert('No se pudo guardar la tasa: ' + err.message));
    } else {
        bcvRate = String(v);
        globalRate = bcvRate;
        saveSetting('rate_bcv', bcvRate).catch(err => alert('No se pudo guardar la tasa: ' + err.message));
        saveSetting('rate', globalRate).catch(err => alert('No se pudo guardar: ' + err.message));
    }
    rateDate = new Date().toLocaleDateString('es-VE');
    saveSetting('rate_date', rateDate).catch(err => alert('No se pudo guardar la tasa: ' + err.message));
    syncRateInputs();
}
function syncRateInputs() {
    document.querySelectorAll('[data-rate]').forEach(inp => {
        if (document.activeElement !== inp) inp.value = getRate(inp.dataset.rate) || '';
    });
    const today = new Date().toLocaleDateString('es-VE');
    document.querySelectorAll('.rate-date').forEach(el => {
        const fresh = rateDate === today;
        if (rateAuto && fresh && rateLiveAt) {
            el.className = 'rate-date text-[10px] font-semibold text-green-600';
            el.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1"></span>En vivo · ${rateLiveAt}`;
            return;
        }
        if (!rateAuto && fresh) {
            el.className = 'rate-date text-[10px] font-semibold text-blue-600';
            el.innerText = 'Manual · hoy';
            return;
        }
        el.className = 'rate-date text-[10px] font-semibold ' + (fresh ? 'text-green-600' : 'text-amber-500');
        el.innerText = fresh ? `Actualizada hoy` : (rateDate ? `Última actualización: ${rateDate} · actualice la tasa` : 'Actualice la tasa del día');
    });
}
function selectRateType(type) {
    rateType = type === 'Binance P2P' ? 'Binance P2P' : 'BCV';
    localStorage.setItem('ns_rate_type', rateType);
    const on = 'bg-brand text-white border-brand', off = 'bg-white dark:bg-gray-900 text-gray-500 border-gray-200 dark:border-gray-700';
    document.getElementById('rate-btn-bcv').className = 'flex-1 py-1 rounded-lg text-xs font-bold border transition ' + (rateType === 'BCV' ? on : off);
    document.getElementById('rate-btn-binance').className = 'flex-1 py-1 rounded-lg text-xs font-bold border transition ' + (rateType === 'Binance P2P' ? on : off);
    document.getElementById('sale-rate').value = getRate(rateType) || '';
    updateSettleBalance();
}
function onSaleRateInput(value) {
    if (parseFloat(value) > 0) setDailyRate(rateType, value);
    updateSettleBalance();
}
function onPayMethodChange(sel) {
    const m = payments.find(p => p.id == sel.value);
    const cur = sel.closest('div').querySelector('.pay-currency');
    if (m && cur) cur.value = BS_METHOD_RE.test(m.name) ? 'VES' : 'USD';
    updateSettleBalance();
}
function fmtBs(n) {
    return 'Bs. ' + (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// MODO TIENDA / REVENTA
const SECTION_MODE = { dashboard: 'tienda', brands: 'tienda', inventory: 'tienda', sales: 'tienda', 'resale-dashboard': 'reventa', 'resale-items': 'reventa', 'resale-sales': 'reventa' };
let currentSection = 'dashboard';
const isAdmin = () => !!currentProfile && currentProfile.role === 'admin';
const isResaleSale = (s) => s.channel === 'reventa';

function applyModeClasses() {
    document.body.classList.toggle('mode-tienda', appMode === 'tienda');
    document.body.classList.toggle('mode-reventa', appMode === 'reventa');
    document.getElementById('mode-btn-tienda').classList.toggle('on', appMode === 'tienda');
    document.getElementById('mode-btn-reventa').classList.toggle('on', appMode === 'reventa');
}

function setMode(mode, opts = {}) {
    mode = mode === 'reventa' ? 'reventa' : 'tienda';
    if (mode === appMode && !opts.force) return;
    if (cart.length && !opts.keepCart) {
        if (!confirm('El carrito tiene equipos de ' + appMode + '. Al cambiar a ' + mode + ' se vaciará. ¿Continuar?')) return;
        cart = []; renderCart();
    }
    appMode = mode;
    localStorage.setItem('ns_mode', mode);
    applyModeClasses();
    if (opts.section) return showSection(opts.section);
    const shared = !SECTION_MODE[currentSection];
    if (shared) { if (currentSection === 'pos') renderPOS(); return; }
    showSection(mode === 'reventa' ? (isAdmin() ? 'resale-dashboard' : 'pos') : (isAdmin() ? 'dashboard' : 'pos'));
}

function toggleNav(open) {
    document.body.classList.toggle('nav-open', open);
}

function togglePassword(id, btn) {
    const inp = document.getElementById(id);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.innerHTML = inp.type === 'password' ? '<i class="far fa-eye"></i>' : '<i class="far fa-eye-slash"></i>';
}

// CONDICIÓN DEL EQUIPO: sellado / usado
const COND_LABEL = { sellado: 'Sellado', usado: 'Usado' };
const condOf = (x) => (x && (x.condition === 'sellado' || x.condition === 'usado')) ? x.condition : '';
function condBadge(c) {
    if (!c) return '';
    return `<span class="cond-badge ${c}"><i class="fas ${c === 'sellado' ? 'fa-box' : 'fa-mobile-screen'}"></i>${COND_LABEL[c]}</span>`;
}
function setCondPick(target, value) {
    const input = document.getElementById(target);
    if (!input) return;
    input.value = value;
    document.querySelectorAll(`.cond-pick[data-target="${target}"] .cond-btn`).forEach(b => b.classList.toggle('on', b.dataset.c === value));
}
function pickCondition(btn) {
    const target = btn.closest('.cond-pick').dataset.target;
    setCondPick(target, btn.dataset.c);
    if (target === 'resale-condition') clearPriceAssistant();
}
let invCond = 'todos', resaleCond = 'todos', posCond = 'todos';
const condMatch = (filter, x) => filter === 'todos' || condOf(x) === filter;

// NAVEGACIÓN SUPERIOR (PC): principales en la píldora, el resto en "Más"
const TOP_LABEL = { dashboard: 'Inicio', 'resale-dashboard': 'Panel', brands: 'Marcas', inventory: 'Inventario', 'resale-items': 'Equipos', pos: 'Vender', customers: 'Clientes', sellers: 'Vendedores', payments: 'Formas de pago', sales: 'Ventas', 'resale-sales': 'Ventas', config: 'Configuración' };
const TOP_ADMIN = ['brands', 'sellers', 'payments', 'resale-dashboard', 'resale-items', 'config'];
const TOP_MAIN = ['dashboard', 'resale-dashboard', 'pos', 'sales', 'resale-sales', 'inventory', 'resale-items', 'customers'];
const TOP_MORE = ['brands', 'sellers', 'payments', 'config'];
const navIcon = (sec) => document.getElementById(`link-${sec}`)?.querySelector('i')?.className.replace('w-6', '').trim() || 'fas fa-circle';
function buildTopNav() {
    const nav = document.getElementById('top-nav');
    if (!nav || nav.childElementCount) return;
    nav.innerHTML = TOP_MAIN.map(sec => {
        const src = document.getElementById(`link-${sec}`);
        if (!src) return '';
        const mode = src.dataset.mode ? ` data-mode="${src.dataset.mode}"` : '';
        return `<a href="#" data-section="${sec}"${mode} class="top-link${TOP_ADMIN.includes(sec) ? ' admin-only' : ''}" onclick="showSection('${sec}')"><i class="${navIcon(sec)}"></i><span>${TOP_LABEL[sec]}</span></a>`;
    }).join('') + `<button type="button" id="top-more" class="top-link admin-only" onclick="openMoreMenu(this)" aria-haspopup="menu" aria-expanded="false"><i class="fas fa-ellipsis"></i><span>Más</span><i class="fas fa-chevron-down chev"></i></button>`;
}
// Menú flotante junto a un botón (se cierra al tocar fuera, con Esc o al desplazar)
let popMenuEl = null;
function closePopMenu() { if (!popMenuEl) return; popMenuEl.btn.setAttribute('aria-expanded', 'false'); popMenuEl.el.remove(); popMenuEl = null; }
function popMenu(btn, html) {
    if (popMenuEl && popMenuEl.btn === btn) return closePopMenu();
    closePopMenu();
    const el = document.createElement('div');
    el.className = 'v-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = html;
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect(), w = el.offsetWidth;
    el.style.top = (r.bottom + 8) + 'px';
    el.style.left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', (e) => { if (e.target.closest('button')) closePopMenu(); });
    popMenuEl = { el, btn };
    requestAnimationFrame(() => el.classList.add('in'));
    el.querySelector('button')?.focus();
}
document.addEventListener('click', (e) => { if (popMenuEl && !popMenuEl.el.contains(e.target) && !popMenuEl.btn.contains(e.target)) closePopMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popMenuEl) { const b = popMenuEl.btn; closePopMenu(); b.focus(); } });
window.addEventListener('resize', closePopMenu);
function openMoreMenu(btn) {
    popMenu(btn, TOP_MORE.map(sec => `<button type="button" role="menuitem" class="${currentSection === sec ? 'on' : ''}" onclick="showSection('${sec}')"><i class="${navIcon(sec)}"></i>${TOP_LABEL[sec]}</button>`).join(''));
}
function openUserMenu(btn) {
    const name = currentProfile ? (currentProfile.full_name || currentProfile.email || '') : '';
    popMenu(btn, `<p class="who"><b>${escHtml(name)}</b>${escHtml(currentProfile?.email || '')} · ${currentProfile?.role === 'admin' ? 'Administrador' : 'Vendedor'}</p><div class="sep"></div>
        ${isAdmin() ? `<button type="button" role="menuitem" onclick="showSection('config')"><i class="fas fa-gear"></i>Configuración</button>` : ''}
        <button type="button" role="menuitem" onclick="toggleDarkMode(document.getElementById('user-btn'))"><i class="fas fa-circle-half-stroke"></i>Cambiar tema</button>
        <div class="sep"></div><button type="button" role="menuitem" class="danger" onclick="logout()"><i class="fas fa-right-from-bracket"></i>Cerrar sesión</button>`);
}
function updateTopAvatar() {
    const el = document.getElementById('top-avatar');
    if (!el || !currentProfile) return;
    const name = currentProfile.full_name || currentProfile.email || '';
    el.textContent = getInitials(name);
    const nm = document.getElementById('top-name');
    if (nm) nm.textContent = (currentProfile.full_name || name.split('@')[0] || '').split(' ').slice(0, 2).join(' ');
}

// NAVIGATION
function showSection(sectionId) {
    buildTopNav();
    updateTopAvatar();
    const needMode = SECTION_MODE[sectionId];
    if (needMode && needMode !== appMode) { appMode = needMode; localStorage.setItem('ns_mode', appMode); cart = []; renderCart(); applyModeClasses(); }
    currentSection = sectionId;
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`section-${sectionId}`).classList.remove('hidden');
    document.querySelectorAll('#sidebar nav a').forEach(a => a.classList.remove('active-link'));
    document.getElementById(`link-${sectionId}`)?.classList.add('active-link');
    document.querySelectorAll('.bottom-nav a, .top-link').forEach(a => a.classList.toggle('on', a.dataset.section === sectionId));
    document.getElementById('top-more')?.classList.toggle('on', TOP_MORE.includes(sectionId));
    closePopMenu();
    toggleNav(false);
    document.querySelector('main').scrollTop = 0;

    if(sectionId === 'dashboard') updateDashboard();
    if(sectionId === 'resale-dashboard') renderResaleDashboard();
    if(sectionId === 'resale-items') renderResaleItems();
    if(sectionId === 'resale-sales') renderResaleSales();
    if(sectionId === 'brands') renderBrands();
    if(sectionId === 'inventory') renderInventory();
    if(sectionId === 'pos') renderPOS();
    if(sectionId === 'customers') renderCustomers();
    if(sectionId === 'sellers') renderSellers();
    if(sectionId === 'payments') renderPayments();
    if(sectionId === 'sales') renderSales();
}

function openModal(id) { 
    if(id === 'modal-product') setupProductModal();
    document.getElementById(id).classList.remove('hidden'); 
}

function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
    resetModal(id);
}

function resetModal(modalId) {
    const form = document.querySelector(`#${modalId} form`);
    if(form) form.reset();
    if(modalId === 'modal-brand') document.getElementById('brand-id').value = '';
    if(modalId === 'modal-product') {
        setCondPick('prod-condition', 'sellado');
        document.getElementById('prod-id').value = '';
        document.getElementById('prod-color').value = '#000000';
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    }
    if(modalId === 'modal-customer') document.getElementById('cust-id').value = '';
    if(modalId === 'modal-seller') document.getElementById('sell-id').value = '';
    if(modalId === 'modal-payment') document.getElementById('pay-id').value = '';
    if(modalId === 'modal-resale') { setCondPick('resale-condition', 'usado'); clearPriceAssistant(); document.getElementById('resale-id').value = ''; document.getElementById('resale-then-cart').value = ''; document.getElementById('resale-profit-hint').innerText = ''; }
}

// BRAND LOGIC
document.getElementById('form-brand').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('brand-id').value;
    const brandData = {
        id: id ? parseInt(id) : Date.now(),
        name: document.getElementById('brand-name').value
    };
    if(id) {
        const idx = brands.findIndex(b => b.id == id);
        brands[idx] = brandData;
    } else {
        brands.push(brandData);
    }
    save();
    closeModal('modal-brand');
    renderBrands();
};

function editBrand(id) {
    const b = brands.find(x => x.id == id);
    document.getElementById('brand-id').value = b.id;
    document.getElementById('brand-name').value = b.name;
    document.getElementById('brand-modal-title').innerText = "Editar Marca";
    openModal('modal-brand');
}

function renderBrands() {
    const tbody = document.getElementById('brands-table-body');
    if(brands.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-gray-500">No hay marcas registradas</td></tr>';
        return;
    }
    tbody.innerHTML = brands.map(b => `
        <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            <td class="p-4 font-medium">${b.name}</td>
            <td class="p-4 text-center flex justify-center gap-3">
                <button onclick="editBrand(${b.id})" class="text-blue-500 hover:text-blue-700"><i class="fas fa-edit"></i></button>
                <button onclick="deleteItem('brands', ${b.id}, renderBrands)" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

// PRODUCT LOGIC
function setupProductModal() {
    const brandSelect = document.getElementById('prod-brand');
    brandSelect.innerHTML = brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('') || '<option value="">Crea una marca primero</option>';
    
    const palette = document.getElementById('color-palette');
    palette.innerHTML = AVAILABLE_COLORS.map(c => `
        <div class="color-dot" style="background-color: ${c.hex}" onclick="selectColor(this, '${c.hex}')"></div>
    `).join('');
}

function selectColor(el, hex) {
    if(!el) return;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('prod-color').value = hex;
}

document.getElementById('form-product').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const productData = {
        id: id ? parseInt(id) : Date.now(),
        brandId: document.getElementById('prod-brand').value,
        name: document.getElementById('prod-name').value,
        category: document.getElementById('prod-cat').value,
        color: document.getElementById('prod-color').value,
        price: parseFloat(document.getElementById('prod-price').value),
        stock: parseInt(document.getElementById('prod-stock').value),
        condition: document.getElementById('prod-condition').value || 'sellado'
    };
    if(id) {
        const idx = products.findIndex(p => p.id == id);
        products[idx] = productData;
    } else {
        products.push(productData);
    }
    save();
    closeModal('modal-product');
    renderInventory();
};

function duplicateProduct(id) {
    const p = products.find(x => x.id == id);
    const duplicate = { ...p, id: Date.now() };
    products.push(duplicate);
    save();
    renderInventory();
    alert('Producto duplicado. Ahora puede editar color y precio.');
}

function editProduct(id) {
    const p = products.find(x => x.id == id);
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-brand').value = p.brandId;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-cat').value = p.category;
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-stock').value = p.stock;
    
    openModal('modal-product');
    setCondPick('prod-condition', condOf(p) || 'sellado');
    
    document.getElementById('prod-color').value = p.color;
    document.querySelectorAll('.color-dot').forEach(d => {
        if(d.style.backgroundColor === p.color) d.classList.add('active');
        else d.classList.remove('active');
    });
    document.getElementById('prod-modal-title').innerText = "Editar Producto";
}

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    bindSeg('inv-filter', 'f', invFilter, (f) => { invFilter = f; renderInventory(); });
    bindSeg('inv-cond', 'c', invCond, (c) => { invCond = c; renderInventory(); });
    const brandSel = document.getElementById('inv-brand');
    const prevBrand = brandSel.value;
    brandSel.innerHTML = '<option value="">Todas las marcas</option>' + brands.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
    brandSel.value = brands.some(b => String(b.id) === prevBrand) ? prevBrand : '';
    const q = (document.getElementById('inv-search').value || '').toLowerCase().trim();
    const units = products.reduce((a, p) => a + (p.stock || 0), 0);
    document.getElementById('inv-summary').innerText = `${products.length} productos · ${units.toLocaleString('en-US')} unidades · valor ${money(products.reduce((a, p) => a + (p.stock || 0) * (p.price || 0), 0))}`;
    const list = products.filter(p => {
        const brand = brands.find(b => b.id == p.brandId);
        if (brandSel.value && String(p.brandId) !== brandSel.value) return false;
        if (!condMatch(invCond, p)) return false;
        if (invFilter === 'bajo' && !(p.stock < 5)) return false;
        if (invFilter === 'agotado' && p.stock > 0) return false;
        return !q || `${brand ? brand.name : ''} ${p.name} ${p.category || ''}`.toLowerCase().includes(q);
    }).sort((a, b) => invFilter === 'todos' ? 0 : a.stock - b.stock);
    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-gray-500">Aún no hay productos. <button onclick="openModal(\'modal-product\')" class="text-brand font-semibold hover:underline">Agrega el primero</button></td></tr>';
        return;
    }
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-gray-500">Ningún producto coincide con la búsqueda o el filtro.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(p => {
        const brand = brands.find(b => b.id == p.brandId);
        const colorName = AVAILABLE_COLORS.find(c => c.hex === p.color)?.name || '';
        const stockCls = p.stock === 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : p.stock < 5 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300';
        return `
            <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition">
                <td class="p-4 font-semibold text-brand">${escHtml(brand ? brand.name : 'Sin marca')}</td>
                <td class="p-4"><p class="font-medium">${escHtml(p.name)} ${condBadge(condOf(p))}</p><p class="text-xs text-gray-400">${escHtml(p.category || '')}</p></td>
                <td class="p-4"><span class="inline-flex items-center gap-2 text-sm"><span class="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600" style="background:${p.color}"></span>${escHtml(colorName)}</span></td>
                <td class="p-4 font-semibold">${money(p.price)}</td>
                <td class="p-4"><span class="px-2 py-1 rounded-full text-xs font-bold ${stockCls}">${p.stock === 0 ? 'Agotado' : p.stock + ' u'}</span></td>
                <td class="p-4"><div class="flex justify-center gap-1">
                    <button onclick="duplicateProduct(${p.id})" class="w-9 h-9 rounded-lg text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" title="Duplicar para otro color"><i class="fas fa-copy"></i></button>
                    <button onclick="editProduct(${p.id})" class="w-9 h-9 rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Editar"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteItem('products', ${p.id}, renderInventory)" class="w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
    }).join('');
}


// CUSTOMERS LOGIC
document.getElementById('form-customer').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('cust-id').value;
    const custData = {
        id: id ? parseInt(id) : Date.now(),
        name: document.getElementById('cust-name').value,
        cedula: document.getElementById('cust-cedula').value,
        rif: document.getElementById('cust-rif').value,
        email: document.getElementById('cust-email').value,
        phone: document.getElementById('cust-phone').value,
        totalSpent: id ? customers.find(c => c.id == id).totalSpent : 0
    };
    if(id) {
        const idx = customers.findIndex(c => c.id == id);
        customers[idx] = custData;
    } else {
        customers.push(custData);
    }
    save();
    closeModal('modal-customer');
    renderCustomers();
    renderPOS();
    // Si se creó desde el punto de venta, queda seleccionado y se muestra su ficha
    const custSel = document.getElementById('pos-customer');
    if (custSel && custSel.querySelector(`option[value="${custData.id}"]`)) { custSel.value = String(custData.id); renderCustomerCard(); }
};

function editCustomer(id) {
    const c = customers.find(x => x.id == id);
    document.getElementById('cust-id').value = c.id;
    document.getElementById('cust-name').value = c.name;
    document.getElementById('cust-cedula').value = c.cedula || '';
    document.getElementById('cust-rif').value = c.rif || '';
    document.getElementById('cust-email').value = c.email;
    document.getElementById('cust-phone').value = c.phone;
    document.getElementById('cust-modal-title').innerText = "Editar Cliente";
    openModal('modal-customer');
}

function formatUSD(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getInitials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function getProductHistory(salesList) {
    const map = {};
    salesList.forEach(sl => {
        (sl.items || []).forEach(i => {
            const key = `${i.id}`;
            if(!map[key]) {
                const b = brands.find(br => br.id == i.brandId);
                const colorName = AVAILABLE_COLORS.find(c => c.hex === i.color)?.name || '';
                map[key] = { id: i.id, name: `${b ? b.name + ' ' : ''}${i.name}`, color: i.color, colorName, qty: 0, total: 0, lastDate: sl.date };
            }
            map[key].qty += i.qty;
            map[key].total += i.price * i.qty;
            map[key].lastDate = sl.date;
        });
    });
    return Object.values(map).sort((x, y) => y.qty - x.qty);
}

function toggleCustomerHistory(id) {
    document.getElementById(`cust-history-${id}`).classList.toggle('hidden');
    document.getElementById(`cust-history-icon-${id}`).classList.toggle('rotate-180');
}

function toggleCustomerInvoices(id) {
    document.getElementById(`cust-invoices-${id}`).classList.toggle('hidden');
    document.getElementById(`cust-invoices-icon-${id}`).classList.toggle('rotate-180');
}

function renderCustomers() {
    const container = document.getElementById('customers-cards');
    const data = customers.map(c => {
        const allSales = sales.filter(sl => sl.customerId == c.id);
        const custSales = allSales.filter(sl => sl.status !== 'cancelada');
        const units = custSales.reduce((acc, sl) => acc + (sl.items || []).reduce((a, i) => a + i.qty, 0), 0);
        const total = custSales.reduce((acc, sl) => acc + sl.total, 0);
        return { c, allSales, custSales, units, total, history: getProductHistory(custSales) };
    }).sort((a, b) => b.total - a.total);
    data.forEach((d, i) => d.rank = i);
    const cq = (document.getElementById('cust-search')?.value || '').toLowerCase().trim();
    const view = cq ? data.filter(d => [d.c.name, d.c.cedula, d.c.rif, d.c.phone, d.c.email].join(' ').toLowerCase().includes(cq)) : data;

    if(data.length === 0) {
        container.innerHTML = '<div class="col-span-full p-8 text-center text-gray-500 bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-800">No hay clientes registrados</div>';
        return;
    }
    const openPanels = [...container.querySelectorAll('[id^="cust-history-"]:not(.hidden), [id^="cust-invoices-"]:not(.hidden)')].map(el => el.id).filter(id => !id.includes('icon'));
    if (!view.length) { container.innerHTML = '<div class="col-span-full p-8 text-center text-gray-500">Ningún cliente coincide con la búsqueda.</div>'; return; }
    container.innerHTML = view.map(({ c, allSales, custSales, units, total, history, rank: idx }) => {
        let badge = '';
        if(idx === 0 && total > 0) badge = '<span class="px-2 py-1 text-xs font-bold bg-yellow-400 text-black rounded-full animate-pulse-gold">🥇 GOLD</span>';
        else if(idx === 1 && total > 0) badge = '<span class="px-2 py-1 text-xs font-bold bg-gray-300 text-black rounded-full">🥈 SILVER</span>';
        else if(idx === 2 && total > 0) badge = '<span class="px-2 py-1 text-xs font-bold bg-orange-400 text-white rounded-full">🥉 BRONZE</span>';
        const historyHtml = history.length === 0
            ? '<p class="text-sm text-gray-400 text-center py-2">Sin compras registradas</p>'
            : history.map(h => `
                <div class="flex items-center justify-between gap-3 py-2 border-b last:border-0 dark:border-gray-800">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-3 h-3 rounded-full flex-shrink-0 border dark:border-gray-700" style="background:${h.color || '#ccc'}"></span>
                        <div class="min-w-0">
                            <p class="text-sm font-medium truncate">${h.name}</p>
                            <p class="text-[11px] text-gray-400">${h.colorName ? h.colorName + ' · ' : ''}Última: ${h.lastDate}</p>
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <p class="text-sm font-bold">x${h.qty}</p>
                        <p class="text-[11px] text-green-600">${formatUSD(h.total)}</p>
                    </div>
                </div>`).join('');
        const invoicesHtml = allSales.length === 0
            ? '<p class="text-sm text-gray-400 text-center py-2">Sin facturas</p>'
            : [...allSales].reverse().map(sl => {
                const cancelled = sl.status === 'cancelada';
                const units = (sl.items || []).reduce((a, i) => a + i.qty, 0);
                return `
                <div class="py-2 border-b last:border-0 dark:border-gray-800">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-sm font-mono font-medium">${sl.id} ${cancelled ? '<span class="ml-1 px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-600 rounded-full">ANULADA</span>' : ''}</p>
                            <p class="text-[11px] text-gray-400">${isResaleSale(sl) ? '<b class="text-emerald-600">Reventa</b> · ' : ''}${sl.docType || ''} · ${sl.date} · ${units} equipo(s)</p>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <p class="text-sm font-bold ${cancelled ? 'line-through text-gray-400' : ''}">${formatUSD(sl.total)}</p>
                            <div class="flex justify-end gap-3 text-xs mt-1">
                                <button onclick="reprint('${sl.id}', true)" class="text-brand hover:underline" title="Descargar PDF"><i class="fas fa-file-pdf"></i></button>
                                ${cancelled
                                    ? `<button onclick="deleteSale('${sl.id}')" class="text-red-500 hover:text-red-700" title="Eliminar venta"><i class="fas fa-trash"></i></button>`
                                    : `<button onclick="openCancelSale('${sl.id}')" class="text-red-500 hover:text-red-700 font-semibold" title="Anular venta"><i class="fas fa-ban mr-1"></i>Anular</button>`}
                            </div>
                        </div>
                    </div>
                    ${cancelled ? `<p class="text-[11px] text-red-500 mt-1"><i class="fas fa-comment-alt mr-1"></i>Motivo: ${sl.cancelReason}</p>` : ''}
                </div>`;
            }).join('');
        return `
            <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border dark:border-gray-800 overflow-hidden hover:shadow-lg transition-all">
                <div class="bg-gradient-to-r from-brand to-brand-dark p-5 text-white relative">
                    <div class="absolute top-3 right-3 flex gap-2">
                        <button onclick="editCustomer(${c.id})" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 transition"><i class="fas fa-edit text-sm"></i></button>
                        <button onclick="deleteItem('customers', ${c.id}, renderCustomers)" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-red-500 transition"><i class="fas fa-trash text-sm"></i></button>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="w-14 h-14 rounded-full bg-white text-brand flex items-center justify-center text-xl font-bold shadow-lg">${getInitials(c.name)}</div>
                        <div class="min-w-0 pr-20">
                            <h3 class="text-lg font-bold truncate">${c.name}</h3>
                            <p class="text-xs text-white/80">#${idx + 1} · ${c.cedula || c.rif || 'S/D'}</p>
                        </div>
                    </div>
                    ${badge ? `<div class="mt-3">${badge}</div>` : ''}
                </div>
                <div class="p-5">
                    <div class="grid grid-cols-2 gap-3 mb-4">
                        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                            <p class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Equipos comprados</p>
                            <p class="text-2xl font-bold">${units}</p>
                        </div>
                        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                            <p class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Compras</p>
                            <p class="text-2xl font-bold">${custSales.length}</p>
                        </div>
                    </div>
                    <div class="text-center border-t dark:border-gray-800 pt-4">
                        <p class="text-xs uppercase font-semibold text-gray-400 tracking-wider">Total comprado</p>
                        <p class="text-xl font-bold text-green-600">${formatUSD(total)} <span class="text-xs text-gray-400">USD</span></p>
                    </div>
                    <button onclick="toggleCustomerHistory(${c.id})" class="w-full mt-4 flex items-center justify-between text-sm font-semibold text-brand hover:bg-brand/10 rounded-xl px-3 py-2 transition">
                        <span><i class="fas fa-box-open mr-2"></i>Productos consumidos (${history.length})</span>
                        <i id="cust-history-icon-${c.id}" class="fas fa-chevron-down transition-transform"></i>
                    </button>
                    <div id="cust-history-${c.id}" class="hidden mt-2 max-h-64 overflow-y-auto px-1">${historyHtml}</div>
                    <button onclick="toggleCustomerInvoices(${c.id})" class="w-full mt-2 flex items-center justify-between text-sm font-semibold text-brand hover:bg-brand/10 rounded-xl px-3 py-2 transition">
                        <span><i class="fas fa-file-invoice mr-2"></i>Facturas / Ventas (${allSales.length})</span>
                        <i id="cust-invoices-icon-${c.id}" class="fas fa-chevron-down transition-transform"></i>
                    </button>
                    <div id="cust-invoices-${c.id}" class="hidden mt-2 max-h-72 overflow-y-auto px-1">${invoicesHtml}</div>
                </div>
            </div>
        `;
    }).join('');
    openPanels.forEach(id => {
        const el = document.getElementById(id);
        if(el) { el.classList.remove('hidden'); document.getElementById(id.replace(/-(\d+)$/, '-icon-$1'))?.classList.add('rotate-180'); }
    });
}

// SELLERS LOGIC
document.getElementById('form-seller').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('sell-id').value;
    const sellData = {
        id: id ? parseInt(id) : Date.now(),
        name: document.getElementById('sell-name').value,
        comm: parseFloat(document.getElementById('sell-comm').value)
    };
    if(id) {
        const idx = sellers.findIndex(s => s.id == id);
        sellers[idx] = sellData;
    } else {
        sellers.push(sellData);
    }
    save();
    closeModal('modal-seller');
    renderSellers();
};

function editSeller(id) {
    const s = sellers.find(x => x.id == id);
    document.getElementById('sell-id').value = s.id;
    document.getElementById('sell-name').value = s.name;
    document.getElementById('sell-comm').value = s.comm;
    document.getElementById('sell-modal-title').innerText = "Editar Vendedor";
    openModal('modal-seller');
}

function renderSellers() {
    const container = document.getElementById('sellers-cards');
    if(sellers.length === 0) {
        container.innerHTML = '<div class="col-span-full p-8 text-center text-gray-500 bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-800">No hay vendedores registrados</div>';
        return;
    }
    container.innerHTML = sellers.map(s => {
        const sellerSales = sales.filter(sl => sl.sellerId == s.id && sl.status !== 'cancelada');
        const totalSold = sellerSales.reduce((acc, cur) => acc + cur.total - feeOf(cur), 0);
        const commissionEarned = totalSold * s.comm;
        const units = sellerSales.reduce((acc, sl) => acc + (sl.items || []).reduce((a, i) => a + i.qty, 0), 0);
        return `
            <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border dark:border-gray-800 overflow-hidden hover:shadow-lg transition-all">
                <div class="bg-gradient-to-r from-brand to-brand-dark p-5 text-white relative">
                    <div class="absolute top-3 right-3 flex gap-2">
                        <button onclick="editSeller(${s.id})" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 transition"><i class="fas fa-edit text-sm"></i></button>
                        <button onclick="deleteItem('sellers', ${s.id}, renderSellers)" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-red-500 transition"><i class="fas fa-trash text-sm"></i></button>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="w-14 h-14 rounded-full bg-white text-brand flex items-center justify-center text-xl font-bold shadow-lg">${getInitials(s.name)}</div>
                        <div class="min-w-0 pr-20">
                            <h3 class="text-lg font-bold truncate">${s.name}</h3>
                            <p class="text-xs text-white/80"><i class="fas fa-percent mr-1"></i>Comisión ${(s.comm * 100).toFixed(1)}%</p>
                        </div>
                    </div>
                </div>
                <div class="p-5">
                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                            <p class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Equipos vendidos</p>
                            <p class="text-2xl font-bold">${units}</p>
                        </div>
                        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                            <p class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Comisión</p>
                            <p class="text-2xl font-bold text-green-600">${formatUSD(commissionEarned)}</p>
                        </div>
                    </div>
                    <div class="text-center border-t dark:border-gray-800 pt-4 mt-4">
                        <p class="text-xs uppercase font-semibold text-gray-400 tracking-wider">Total en ventas</p>
                        <p class="text-xl font-bold">${formatUSD(totalSold)} <span class="text-xs text-gray-400">USD</span></p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// PAYMENT METHODS LOGIC
document.getElementById('form-payment').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('pay-id').value;
    const payData = {
        id: id ? parseInt(id) : Date.now(),
        name: document.getElementById('pay-name').value
    };
    if(id) {
        const idx = payments.findIndex(p => p.id == id);
        payments[idx] = payData;
    } else {
        payments.push(payData);
    }
    save();
    closeModal('modal-payment');
    renderPayments();
    renderPOS();
};

function editPayment(id) {
    const p = payments.find(x => x.id == id);
    document.getElementById('pay-id').value = p.id;
    document.getElementById('pay-name').value = p.name;
    document.getElementById('pay-modal-title').innerText = "Editar Método de Pago";
    openModal('modal-payment');
}

function renderPayments() {
    const tbody = document.getElementById('payments-table-body');
    if(payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="p-4 text-center text-gray-500">No hay métodos de pago registrados</td></tr>';
        return;
    }
    tbody.innerHTML = payments.map(p => `
        <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            <td class="p-4 font-medium">${p.name}</td>
            <td class="p-4 text-center flex justify-center gap-3">
                <button onclick="editPayment(${p.id})" class="text-blue-500 hover:text-blue-700"><i class="fas fa-edit"></i></button>
                <button onclick="deleteItem('payments', ${p.id}, renderPayments)" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

// POS LOGIC
function cartSource() { return cart.length ? (cart[0].source || 'tienda') : appMode; }
function findCartProduct(item) {
    return item.source === 'reventa' ? resale.find(x => x.id == item.id) : products.find(x => x.id == item.id);
}

function renderPOS() {
    const grid = document.getElementById('pos-products-grid');
    bindSeg('pos-cond', 'c', posCond, (c) => { posCond = c; renderPOS(); });
    if (appMode === 'reventa') {
        const items = resale.filter(r => r.stock > 0 && condMatch(posCond, r));
        const quick = `
            <div onclick="openResaleModal(null, true)" data-quick class="admin-only flex flex-col items-center justify-center gap-2 p-4 min-h-[128px] rounded-2xl border-2 border-dashed border-emerald-400/70 text-emerald-600 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition">
                <i class="fas fa-plus text-xl"></i><p class="text-sm font-bold text-center">Equipo por encargo</p><p class="text-[11px] text-center text-gray-400">Registrar y vender</p>
            </div>`;
        grid.innerHTML = quick + (items.length === 0
            ? '<div class="col-span-full md:col-span-2 text-center p-10 text-gray-500">No hay equipos de reventa disponibles</div>'
            : items.map(r => `
                <div onclick="addToCart(${r.id})" class="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-sm border dark:border-gray-800 cursor-pointer hover:border-emerald-500 transition-all group hover:-translate-y-1 hover:shadow-xl">
                    <div class="flex justify-between items-start gap-2">
                        <p class="text-xs font-bold text-emerald-600 uppercase truncate">${r.brand || 'Reventa'}</p>${condBadge(condOf(r))}
                        <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold">${r.stock} u</span>
                    </div>
                    <p class="font-bold group-hover:text-emerald-600 transition-colors">${r.name}</p>
                    <p class="text-[11px] text-gray-400 truncate">${[r.color, r.supplier ? 'Prov: ' + r.supplier : ''].filter(Boolean).join(' · ')}</p>
                    <div class="flex justify-between items-center mt-3">
                        <span class="font-bold text-emerald-600">${appCurrency}${Number(r.price).toFixed(2)}</span>
                        <span class="admin-only text-[11px] font-semibold text-gray-400">+${appCurrency}${(r.price - r.cost).toFixed(2)}</span>
                    </div>
                </div>`).join(''));
    } else if(products.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center p-10 text-gray-500">No hay productos disponibles</div>';
    } else {
        const groups = {};
        products.filter(p => condMatch(posCond, p)).forEach(p => {
            const key = `${p.brandId}_${p.name}_${p.category}_${condOf(p)}`;
            if(!groups[key]) groups[key] = [];
            groups[key].push(p);
        });

        grid.innerHTML = Object.values(groups).map(variants => {
            const p = variants[0];
            const brand = brands.find(b => b.id == p.brandId);
            return `
                <div onclick="openVariantSelector('${p.name}', ${JSON.stringify(variants).replace(/"/g, '&quot;')})" class="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-sm border dark:border-gray-800 cursor-pointer hover:border-brand transition-all group hover:-translate-y-1 hover:shadow-xl">
                    <div class="flex justify-between items-start">
                        <p class="text-xs font-bold text-brand uppercase">${brand ? brand.name : 'N/A'}</p>
                        <div class="flex gap-1">
                            ${variants.map(v => `<div class="color-dot" style="background-color: ${v.color}; width:8px; height:8px"></div>`).join('')}
                        </div>
                    </div>
                    <p class="font-bold group-hover:text-brand transition-colors">${p.name}</p>${condBadge(condOf(p))}
                    <div class="flex justify-between items-center mt-3">
                        <span class="font-bold text-brand">${appCurrency}${Math.min(...variants.map(v => v.price)).toFixed(2)}</span>
                        <span class="text-xs ${variants.some(v => v.stock < 5) ? 'text-red-500' : 'text-gray-400'}">Ver Variantes</span>
                    </div>
                </div>
            `;
        }).join('');
    }
    const custSel = document.getElementById('pos-customer'), sellSel = document.getElementById('pos-seller');
    const prevCust = custSel.value, prevSell = sellSel.value;
    custSel.innerHTML = customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('') || '<option value="">Sin Cliente</option>';
    sellSel.innerHTML = sellers.map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '<option value="">Sin Vendedor</option>';
    if (prevCust && customers.some(c => c.id == prevCust)) custSel.value = prevCust;
    if (prevSell && sellers.some(s => s.id == prevSell)) sellSel.value = prevSell;
    custSel.onchange = renderCustomerCard;
    renderCustomerCard();
    filterPOS();
}

function openVariantSelector(name, variants) {
    document.getElementById('variant-title').innerText = name;
    const list = document.getElementById('variant-list');
    list.innerHTML = variants.map(v => {
        const colorName = AVAILABLE_COLORS.find(c => c.hex === v.color)?.name || 'Desconocido';
        return `
            <div onclick="addToCart(${v.id})" class="flex items-center justify-between p-3 border dark:border-gray-800 rounded-xl cursor-pointer hover:bg-brand hover:text-white transition-all group">
                <div class="flex items-center gap-3">
                    <div class="color-dot" style="background-color: ${v.color}; width:16px; height:16px"></div>
                    <span class="font-medium">${colorName}</span> ${condBadge(condOf(v))}
                </div>
                <div class="flex items-center gap-4">
                    <span class="text-sm font-bold">${appCurrency}${v.price.toFixed(2)}</span>
                    <span class="text-xs ${v.stock < 5 ? 'text-red-500' : 'text-gray-400'}">${v.stock} u</span>
                </div>
            </div>
        `;
    }).join('');
    openModal('modal-variants');
}

function filterPOS() {
    const q = document.getElementById('pos-search').value.toLowerCase();
    document.querySelectorAll('#pos-products-grid > div').forEach(el => {
        if (el.hasAttribute('data-quick')) return;
        el.style.display = el.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
}

function addToCart(id) {
    const source = appMode;
    if (cart.length && cartSource() !== source) {
        if (!confirm('El carrito tiene equipos de ' + cartSource() + '. No se pueden mezclar tienda y reventa en un mismo documento. ¿Vaciar el carrito?')) return;
        cart = [];
    }
    const p = source === 'reventa' ? resale.find(x => x.id == id) : products.find(x => x.id == id);
    if(!p) return;
    if(p.stock <= 0) return alert(source === 'reventa' ? 'Este equipo ya fue vendido' : 'Sin stock');
    const item = cart.find(x => x.id == id);
    if(item) {
        if(item.qty < p.stock) item.qty++;
        else alert('Límite de stock alcanzado');
    } else if (source === 'reventa') {
        cart.push({ id: p.id, name: [p.brand, p.name].filter(Boolean).join(' '), brand: p.brand || '', colorLabel: p.color || '', serial: p.serial || '', condition: condOf(p), price: Number(p.price), cost: Number(p.cost), qty: 1, source: 'reventa' });
    } else {
        cart.push({...p, qty: 1, source: 'tienda'});
    }
    closeModal('modal-variants');
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items');
    let total = 0, cost = 0;
    container.innerHTML = cart.length ? cart.map((item, idx) => {
        total += item.price * item.qty;
        cost += (item.cost || 0) * item.qty;
        const label = item.source === 'reventa'
            ? (item.colorLabel || 'Reventa')
            : (AVAILABLE_COLORS.find(c => c.hex === item.color)?.name || 'S/C');
        const dot = item.source === 'reventa'
            ? '<i class="fas fa-recycle text-emerald-500 text-xs"></i>'
            : `<div class="color-dot shrink-0" style="background-color: ${item.color}; width:12px; height:12px"></div>`;
        return `
            <div class="flex justify-between items-center gap-2 text-sm bg-gray-50 dark:bg-white/5 p-3 rounded-xl border dark:border-gray-700">
                <div class="flex items-center gap-2 min-w-0">
                    ${dot}
                    <div class="min-w-0"><p class="font-bold truncate">${item.name} (${label})</p><p class="text-xs text-gray-500 flex items-center gap-1">${condBadge(condOf(item))} ${appCurrency}${item.price} x ${item.qty}</p></div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="changeQty(${idx}, -1)" class="w-7 h-7 bg-white dark:bg-gray-700 rounded-lg shadow-sm">-</button>
                    <span class="font-bold">${item.qty}</span>
                    <button onclick="changeQty(${idx}, 1)" class="w-7 h-7 bg-white dark:bg-gray-700 rounded-lg shadow-sm">+</button>
                </div>
            </div>
        `;
    }).join('') : '<p class="text-sm text-gray-400 text-center py-4">Toque un producto para agregarlo</p>';
    const fee = delivery ? delivery.fee : 0;
    document.getElementById('cart-subtotal').innerText = `${appCurrency}${total.toFixed(2)}`;
    const dRow = document.getElementById('cart-delivery-row');
    dRow.classList.toggle('hidden', !delivery); dRow.classList.toggle('flex', !!delivery);
    if (delivery) { document.getElementById('cart-delivery-label').innerText = delivery.label + ':'; document.getElementById('cart-delivery').innerText = `${appCurrency}${fee.toFixed(2)}`; }
    document.getElementById('cart-total').innerText = `${appCurrency}${(total + fee).toFixed(2)}`;
    const profit = document.getElementById('cart-profit');
    const showProfit = cart.length > 0 && cartSource() === 'reventa';
    profit.classList.toggle('hidden', !showProfit);
    profit.classList.toggle('flex', showProfit);
    profit.lastElementChild.innerText = `${appCurrency}${(total - cost).toFixed(2)}`;
    const fab = document.getElementById('pos-cart-fab');
    const units = cart.reduce((a, i) => a + i.qty, 0);
    fab.classList.toggle('hidden', units === 0);
    fab.querySelector('span').innerText = `${units} · ${appCurrency}${(total + fee).toFixed(2)}`;
}

function changeQty(idx, delta) {
    const item = cart[idx];
    const p = findCartProduct(item);
    if(delta > 0 && (!p || item.qty >= p.stock)) return alert('Sin stock');
    item.qty += delta;
    if(item.qty <= 0) cart.splice(idx, 1);
    renderCart();
}

// DELIVERY (se suma al total de la factura)
const DELIVERY_CARACAS = 5;
let delivery = null; // { type: 'caracas'|'fuera', label, fee, zone }
const feeOf = (s) => Number(s && s.delivery && s.delivery.fee) || 0;
const productsTotal = () => cart.reduce((acc, cur) => acc + (cur.price * cur.qty), 0);
const grandTotal = () => productsTotal() + (delivery ? delivery.fee : 0);

function setDelivery(type, on) {
    const ccs = document.getElementById('deliv-ccs'), out = document.getElementById('deliv-out');
    if (type === 'caracas') { if (on) out.checked = false; }
    else if (on) ccs.checked = false;
    const outOn = out.checked;
    document.getElementById('deliv-out-fields').classList.toggle('hidden', !outOn);
    if (outOn) {
        const feeIn = document.getElementById('deliv-fee');
        if (!feeIn.value) { try { feeIn.value = localStorage.getItem('ns_deliv_out_fee') || ''; } catch { /* sin almacenamiento */ } }
        if (!feeIn.value) setTimeout(() => feeIn.focus(), 50);
    }
    updateDeliveryFromInputs();
}
function updateDeliveryFromInputs() {
    const ccs = document.getElementById('deliv-ccs').checked, out = document.getElementById('deliv-out').checked;
    if (ccs) delivery = { type: 'caracas', label: 'Delivery Caracas', fee: DELIVERY_CARACAS, zone: 'Caracas' };
    else if (out) {
        const zone = document.getElementById('deliv-zone').value.trim();
        const fee = Math.max(0, parseFloat(document.getElementById('deliv-fee').value) || 0);
        delivery = { type: 'fuera', label: `Delivery ${zone || 'fuera de Caracas'}`, fee, zone: zone || 'Fuera de Caracas' };
        if (fee > 0) { try { localStorage.setItem('ns_deliv_out_fee', String(fee)); } catch { /* sin almacenamiento */ } }
    } else delivery = null;
    renderCart();
}
function resetDelivery() {
    delivery = null;
    ['deliv-ccs', 'deliv-out'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    const z = document.getElementById('deliv-zone'); if (z) z.value = '';
    document.getElementById('deliv-out-fields')?.classList.add('hidden');
}

// FICHA DEL CLIENTE EN EL PUNTO DE VENTA
function renderCustomerCard() {
    const box = document.getElementById('pos-customer-card');
    if (!box) return;
    const c = customers.find(x => x.id == document.getElementById('pos-customer').value);
    if (!c) { box.innerHTML = ''; return; }
    const list = sales.filter(s => s.customerId == c.id).sort((a, b) => (saleTime(b) || 0) - (saleTime(a) || 0));
    const act = list.filter(s => s.status !== 'cancelada');
    const spent = act.reduce((a, s) => a + s.total, 0);
    const parts = String(c.name || '').trim().split(/\s+/);
    const row = (icon, label, value) => value ? `<p class="flex items-center gap-2 min-w-0"><i class="fas ${icon} w-4 text-gray-400"></i><span class="text-gray-400 shrink-0">${label}</span><span class="truncate font-medium">${escHtml(value)}</span></p>` : '';
    box.innerHTML = `
        <div class="mt-2 rounded-2xl border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-3 text-sm space-y-1.5">
            <div class="flex items-center gap-3">
                <span class="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center font-bold shrink-0">${escHtml(getInitials(c.name))}</span>
                <div class="min-w-0 flex-1"><p class="font-semibold truncate">${escHtml(c.name)}</p><p class="text-xs text-gray-400">${act.length} compra(s) · ${money(spent)}</p></div>
                <button type="button" onclick="editCustomer(${c.id})" class="w-8 h-8 rounded-lg text-gray-400 hover:text-brand hover:bg-white dark:hover:bg-white/10" title="Editar cliente"><i class="fas fa-pen text-xs"></i></button>
            </div>
            ${row('fa-user', 'Nombre', parts[0])}
            ${row('fa-user', 'Apellido', parts.slice(1).join(' '))}
            ${row('fa-id-card', 'Cédula', c.cedula)}
            ${row('fa-building', 'RIF', c.rif)}
            ${row('fa-envelope', 'Correo', c.email)}
            ${row('fa-phone', 'Teléfono', c.phone)}
            ${list.length ? `<div class="pt-1.5 mt-1.5 border-t border-gray-200 dark:border-white/10">
                <p class="text-xs text-gray-400 mb-1">Facturas anteriores</p>
                ${list.slice(0, 4).map(s => `<button type="button" onclick="openSaleDetail('${s.id}')" class="w-full flex justify-between gap-2 text-xs py-1 hover:text-brand"><span class="font-mono truncate">${s.id} · ${(saleTime(s) || new Date()).toLocaleDateString('es-VE')}</span><span class="tabular-nums ${s.status === 'cancelada' ? 'line-through text-gray-400' : 'font-semibold'}">${money(s.total)}</span></button>`).join('')}
                ${list.length > 4 ? `<p class="text-[11px] text-gray-400">y ${list.length - 4} más en Clientes</p>` : ''}
            </div>` : '<p class="text-xs text-gray-400 pt-1">Primera compra de este cliente</p>'}
        </div>`;
}

// PARTE DE PAGO: equipo usado que entrega el cliente
const payName = (p) => p && p.methodId === 'tradein' ? 'Equipo recibido (parte de pago)' : (payments.find(m => m.id == (p && p.methodId))?.name || 'Método');
const tradeInTitle = (t) => t ? `${t.brand || 'Apple'} ${t.name}`.replace(/^Apple (iPhone)/, '$1') : '';
const tradeInDesc = (t) => t ? [[tradeInTitle(t), t.color].filter(Boolean).join(' '), t.sim, t.imei ? 'IMEI ' + t.imei : '', t.appleId ? 'Cuenta ' + t.appleId : '', t.battery ? 'Batería ' + t.battery + '%' : '', t.notes].filter(Boolean).join(' · ') : '';

function usedMarkup(full) {
    const pool = resale.filter(r => r.cost > 0 && r.price > 0 && (condOf(r) || 'usado') === 'usado');
    const sim = pool.filter(r => similarity(full, `${r.brand} ${r.name}`) >= 0.6);
    const l = sim.length ? sim : pool.length >= 3 ? pool : [];
    const m = l.length ? l.reduce((a, r) => a + (r.price - r.cost) / r.cost, 0) / l.length : DEFAULT_MARKUP.usado;
    return Math.min(Math.max(m, 0.05), 0.6);
}
function tradeInSuggest() {
    const model = document.getElementById('ti-model').value.trim(), cap = '';
    const value = parseFloat(document.getElementById('ti-value').value) || 0;
    const el = document.getElementById('ti-suggest');
    if (!model || !(value > 0)) { el.innerText = ''; return null; }
    const price = roundPrice(value * (1 + usedMarkup(`${document.getElementById('ti-brand').value} ${model} ${cap}`)));
    el.innerHTML = `Precio de reventa sugerido: <b class="text-sky-700 dark:text-sky-300">${money(price)}</b> (ganancia ${money(price - value)}). Podrá ajustarlo en Equipos de reventa.`;
    return price;
}
function openTradeIn(brand = 'Apple') {
    closeTradeIn();
    document.getElementById('ti-brand').value = brand;
    const apple = brand === 'Apple';
    document.getElementById('ti-model').placeholder = apple ? 'Modelo (ej: iPhone 14 Pro 256GB)' : 'Modelo (ej: S26 Ultra 512GB)';
    document.getElementById('ti-title').innerHTML = apple ? '<i class="fab fa-apple mr-1"></i> Recepción de iPhone' : '<span class="font-extrabold tracking-widest text-[#1428A0] dark:text-blue-300 text-xs mr-1">SAMSUNG</span> Recepción de equipo';
    document.getElementById('tradein-form').classList.remove('hidden');
    document.getElementById('ti-model').focus();
}
function closeTradeIn() {
    const f = document.getElementById('tradein-form');
    f.classList.add('hidden');
    f.querySelectorAll('input').forEach(i => i.value = '');
    f.querySelectorAll('select').forEach(s => s.selectedIndex = 0);
    document.getElementById('ti-suggest').innerText = '';
}
function addTradeIn() {
    const g = (id) => (document.getElementById(id)?.value || '').trim();
    const model = g('ti-model'), value = parseFloat(g('ti-value')) || 0;
    if (!model) return alert('Escriba el modelo del equipo recibido');
    if (!(value > 0)) return alert('Indique el valor que se le reconoce al equipo');
    let paidOthers = 0;
    document.querySelectorAll('#settle-payments-list .pay-amount').forEach(i => paidOthers += parseFloat(i.value) || 0);
    if (value > grandTotal()) return alert('El valor del equipo no puede ser mayor que el total de la venta');
    const t = {
        id: Date.now(), brand: g('ti-brand') || 'Apple', name: model.replace(/^(apple|samsung)\s+/i, ''),
        color: g('ti-color'), imei: g('ti-imei'), appleId: g('ti-appleid'), battery: g('ti-battery'), notes: g('ti-state'),
        suggestedPrice: tradeInSuggest() || roundPrice(value * 1.2),
    };
    const row = document.createElement('div');
    row.id = `pay-row-${t.id}`;
    row.className = 'tradein-row flex flex-wrap gap-2 items-center bg-sky-50 dark:bg-sky-900/20 p-3 rounded-xl border border-sky-200 dark:border-sky-800';
    row.dataset.tradein = JSON.stringify(t);
    row.innerHTML = `
        <input type="hidden" class="pay-method" value="tradein">
        <i class="${t.brand === 'Apple' ? 'fab fa-apple' : 'fas fa-mobile-screen'} text-sky-600 text-lg"></i>
        <div class="flex-1 min-w-[140px] text-sm"><p class="font-semibold">Se recibe ${escHtml(tradeInTitle(t))}</p><p class="text-xs text-gray-500 truncate">${escHtml(tradeInDesc(t).replace(tradeInTitle(t), '').replace(/^\s*(· )?/, ''))}</p></div>
        <input type="number" class="pay-amount w-24 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 text-sm font-bold" value="${value.toFixed(2)}" readonly title="Se descuenta del pago">
        <select class="pay-currency hidden"><option value="USD" selected>USD</option></select>
        <button onclick="removePaymentRow(${t.id})" class="text-red-500 hover:text-red-700" title="Quitar"><i class="fas fa-times"></i></button>
        <p class="pay-bs hidden"></p>`;
    const list = document.getElementById('settle-payments-list');
    list.insertBefore(row, list.firstChild);
    // Ajusta el primer pago normal a lo que falta
    const normal = [...list.querySelectorAll(':scope > div:not(.tradein-row) .pay-amount')];
    if (normal.length === 1) { let used = 0; list.querySelectorAll('.tradein-row .pay-amount').forEach(i => used += parseFloat(i.value) || 0); normal[0].value = Math.max(0, grandTotal() - used).toFixed(2); }
    closeTradeIn();
    updateSettleBalance();
}

// Si la nube aún no registró el equipo recibido (ajuste de base de datos pendiente), lo agrega el administrador
async function ensureTradeInsInInventory(sale) {
    const list = (sale.payments || []).filter(p => p.tradeIn);
    if (!list.length || !isAdmin()) return;
    let added = 0;
    for (const p of list) {
        const t = p.tradeIn;
        if (resale.some(r => String(r.id) === String(t.id))) continue;
        const cust = customers.find(c => c.id == sale.customerId);
        resale.push({
            id: t.id, brand: t.brand || 'Apple', name: t.name, color: t.color, serial: t.imei,
            supplier: `${cust ? cust.name : 'Cliente'} (parte de pago)`, cost: p.amount, price: Math.max(t.suggestedPrice || 0, p.amount), stock: 1,
            notes: ['Recibido como parte de pago en ' + sale.id, t.appleId ? 'Apple ID: ' + t.appleId : '', t.battery ? 'Batería: ' + t.battery + '%' : '', t.notes].filter(Boolean).join(' · '),
            acquiredAt: new Date().toLocaleDateString('es-VE'), condition: 'usado', pendingPrice: true, tradeInSale: sale.id, appleId: t.appleId, battery: t.battery,
        });
        added++;
    }
    if (added) await save();
}

// PAYMENT SETTLEMENT LOGIC
let currentSettlePayments = [];
let saleChannel = 'tienda';

function selectSaleChannel(channel) {
    channel = channel === 'reventa' ? 'reventa' : 'tienda';
    if (cart.length && channel !== cartSource()) {
        const what = cartSource() === 'tienda' ? 'productos de tienda' : 'equipos de reventa';
        if (!confirm(`El carrito tiene ${what}. Para facturar como ${channel.toUpperCase()} debe agregar ${channel === 'reventa' ? 'equipos de reventa' : 'productos de tienda'}.\n\n¿Vaciar el carrito y pasar al modo ${channel === 'reventa' ? 'Reventa' : 'Tienda'}?`)) return;
        closeModal('modal-payment-settle');
        cart = []; renderCart();
        setMode(channel, { section: 'pos', keepCart: true });
        return;
    }
    saleChannel = channel;
    const on = channel === 'reventa' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-brand text-white border-brand';
    const off = 'bg-white dark:bg-gray-900 text-gray-500 border-gray-200 dark:border-gray-700';
    document.getElementById('channel-btn-tienda').className = 'py-2 rounded-xl text-sm font-bold border transition ' + (channel === 'tienda' ? on : off);
    document.getElementById('channel-btn-reventa').className = 'py-2 rounded-xl text-sm font-bold border transition ' + (channel === 'reventa' ? on : off);
    document.getElementById('channel-hint').innerText = channel === 'reventa'
        ? 'Se guardará en Ventas Reventa con su costo y ganancia.'
        : 'Se guardará en Ventas Tienda y descuenta del inventario.';
}

function openPaymentModal() {
    if(cart.length === 0) return alert('El carrito está vacío');
    if (delivery && delivery.type === 'fuera' && !(delivery.fee > 0)) return alert('Indique el monto del delivery fuera de Caracas');
    
    const total = grandTotal();
    document.getElementById('settle-total').innerText = `${appCurrency}${total.toFixed(2)}`;
    currentSettlePayments = [];
    document.getElementById('settle-payments-list').innerHTML = '';
    closeTradeIn();
    selectSaleChannel(cartSource());
    if (saleChannel === 'reventa') document.getElementById('settle-doc-type').value = 'Nota de Entrega';
    selectRateType(rateType);

    addPaymentRow();
    updateSettleBalance();
    
    openModal('modal-payment-settle');
}

function addPaymentRow() {
    const id = Date.now();
    const row = document.createElement('div');
    row.className = 'flex gap-3 items-center animate-slide-in bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border dark:border-gray-700';
    row.id = `pay-row-${id}`;
    
    row.className = 'flex flex-wrap gap-2 items-center animate-slide-in bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border dark:border-gray-700';
    const methodsOptions = payments.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const total = grandTotal();
    let paid = 0;
    document.querySelectorAll('#settle-payments-list .pay-amount').forEach(i => paid += parseFloat(i.value) || 0);
    const remaining = Math.max(0, total - paid);

    row.innerHTML = `
        <select onchange="onPayMethodChange(this)" class="pay-method flex-1 min-w-[120px] p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 text-sm outline-none focus:ring-2 focus:ring-brand">
            ${methodsOptions || '<option>Cree un método de pago</option>'}
        </select>
        <input type="number" step="0.01" min="0" oninput="updateSettleBalance()" placeholder="Monto $" value="${remaining > 0 ? remaining.toFixed(2) : ''}" title="Monto en divisas" class="pay-amount w-24 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 text-sm outline-none focus:ring-2 focus:ring-brand">
        <select onchange="updateSettleBalance()" title="¿En qué moneda paga?" class="pay-currency p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 text-sm outline-none focus:ring-2 focus:ring-brand">
            <option value="USD">Paga en $</option>
            <option value="VES">Paga en Bs.</option>
        </select>
        <button onclick="removePaymentRow(${id})" class="text-red-500 hover:text-red-700"><i class="fas fa-times"></i></button>
        <p class="pay-bs w-full text-xs font-bold text-brand hidden"></p>
    `;
    document.getElementById('settle-payments-list').appendChild(row);
    onPayMethodChange(row.querySelector('.pay-method'));
}

function removePaymentRow(id) {
    document.getElementById(`pay-row-${id}`).remove();
    updateSettleBalance();
}

function updateSettleBalance() {
    const total = grandTotal();
    let paid = 0;
    
    const rate = parseFloat(document.getElementById('sale-rate').value) || 0;
    let needsRate = false;

    document.querySelectorAll('#settle-payments-list > div').forEach(row => {
        const amount = parseFloat(row.querySelector('.pay-amount').value) || 0;
        paid += amount;
        const isBs = row.querySelector('.pay-currency').value === 'VES';
        const info = row.querySelector('.pay-bs');
        info.classList.toggle('hidden', !isBs);
        if (isBs) {
            if (!(rate > 0)) needsRate = true;
            info.innerText = rate > 0 ? `Cobrar ${fmtBs(amount * rate)} · Tasa ${rateType} ${rate.toFixed(2)}` : 'Indique la tasa del día';
        }
    });

    const remaining = total - paid;
    const remainingEl = document.getElementById('settle-remaining');
    remainingEl.innerText = `${appCurrency}${remaining.toFixed(2)}`;
    document.getElementById('settle-total-bs').innerText = rate > 0 ? `${fmtBs(total * rate)} (${rateType})` : '';
    document.getElementById('settle-remaining-bs').innerText = rate > 0 && Math.abs(remaining) > 0.005 ? fmtBs(remaining * rate) : '';

    if(remaining <= 0.005 && paid > 0 && !needsRate) {
        remainingEl.className = 'text-xl font-bold text-green-500';
        document.getElementById('btn-finalize-sale').disabled = false;
        document.getElementById('btn-finalize-sale').classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        remainingEl.className = 'text-xl font-bold text-red-500';
        document.getElementById('btn-finalize-sale').disabled = true;
        document.getElementById('btn-finalize-sale').classList.add('opacity-50', 'cursor-not-allowed');
    }
}

async function executeFinalSale() {
    const total = grandTotal();
    const custId = document.getElementById('pos-customer').value;
    const sellId = document.getElementById('pos-seller').value;
    const rate = parseFloat(document.getElementById('sale-rate').value) || 1;
    const docType = document.getElementById('settle-doc-type').value;
    const mainCurrency = document.getElementById('settle-currency').value;

    const paymentsMade = [];
    document.querySelectorAll('#settle-payments-list > div').forEach(row => {
        const amount = parseFloat(row.querySelector('.pay-amount').value) || 0;
        const currency = row.querySelector('.pay-currency').value;
        paymentsMade.push({
            methodId: row.querySelector('.pay-method').value,
            amount: amount,
            currency: currency,
            amountBs: currency === 'VES' ? Math.round(amount * rate * 100) / 100 : null,
            rateType: rateType,
            ...(row.dataset.tradein ? { tradeIn: JSON.parse(row.dataset.tradein) } : {})
        });
    });

    const channel = cartSource();
    const sale = {
        id: (channel === 'reventa' ? 'REV-' : 'INV-') + Date.now().toString().slice(-8),
        channel: channel,
        date: stampCaracas(),
        customerId: custId,
        sellerId: sellId,
        rate: rate,
        rateType: rateType,
        docType: docType,
        mainCurrency: mainCurrency,
        payments: paymentsMade,
        items: cart.map(({ cost, ...i }) => i),
        delivery: delivery ? { ...delivery } : null,
        total: total
    };

    const costTotal = channel === 'reventa' ? cart.reduce((a, i) => a + (Number(i.cost) || 0) * i.qty, 0) : null;
    let savedOffline = false;
    try {
        const saved = await createSale(sale);
        savedOffline = !!saved.offline;
        sale.total = saved.offline ? total : saved.total;
        sale.costTotal = saved.offline ? costTotal : saved.costTotal;
    } catch (err) {
        return alert('No se pudo registrar la venta: ' + err.message);
    }
    if (savedOffline) {
        // Sin internet: se descuenta el stock aquí y la venta queda guardada para enviarse al volver la conexión
        const list = channel === 'reventa' ? resale : products;
        sale.items.forEach(i => { const p = list.find(x => x.id == i.id); if (p) p.stock = Math.max(0, (p.stock || 0) - i.qty); });
        sales.push({ ...sale, status: 'activa', createdAt: new Date().toISOString(), pending: true });
        persistLocal({ brands, products, customers, sellers, payments, resale, sales }, true);
        toast('Venta guardada sin conexión. Se enviará sola cuando vuelva el internet.', 'info', 6000);
    } else {
        await syncChain;
        await reloadData();
        await ensureTradeInsInInventory(sale);
        if ((sale.payments || []).some(p => p.tradeIn)) toast('El equipo recibido se agregó a Equipos de reventa. Confirme su precio de venta.', 'ok', 7000);
    }
    
    fillInvoice(sale);

    cart = [];
    resetDelivery();
    renderCart();
    renderPOS();
    closeModal('modal-payment-settle');

    // Envío automático de la factura al correo del cliente (si tiene correo y está activado)
    const savedSale = sales.find(x => x.id === sale.id) || sale;
    if (autoEmail && customerEmailOf(savedSale) && (savedOffline || !navigator.onLine)) {
        queueEmail(savedSale.id);
    } else if (autoEmail && customerEmailOf(savedSale)) {
        try {
            const base64 = await blobToBase64(await invoicePdfBlob(savedSale));
            emailInvoice(savedSale.id, { auto: true, base64 });
        } catch (err) { toast('No se pudo preparar el PDF para el correo: ' + err.message, 'error'); }
        fillInvoice(savedSale);
    }
    
    if(confirm('¿Desea descargar la factura en PDF?')) {
        await downloadPDF(sale.id);
    } else {
        window.print();
    }
    // Cada venta pasa a su ventana: reventa → Ventas Reventa, tienda → Ventas Tienda
    showSection(channel === 'reventa' ? 'resale-sales' : 'sales');
}

// PDF de la factura (para descargar, compartir o enviar por correo)
const pdfOptions = (saleId) => ({
    margin: 0.5,
    filename: `DgtTec_Factura_${saleId}.pdf`,
    image: { type: 'jpeg', quality: 0.92 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
});
async function withInvoiceVisible(fn) {
    await loadPdfLib();
    const element = document.getElementById('printable-invoice');
    element.classList.remove('print-only');
    element.classList.add('block');
    try { return await fn(element); }
    finally { element.classList.add('print-only'); element.classList.remove('block'); }
}
async function downloadPDF(saleId) {
    await withInvoiceVisible(el => html2pdf().set(pdfOptions(saleId)).from(el).save());
}
async function invoicePdfBlob(sale) {
    fillInvoice(sale);
    return withInvoiceVisible(el => html2pdf().set(pdfOptions(sale.id)).from(el).outputPdf('blob'));
}
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('No se pudo preparar el PDF'));
    r.readAsDataURL(blob);
});

// AVISOS EN PANTALLA
function toast(message, kind = 'info', ms = 4500) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'fixed z-[90] bottom-24 lg:bottom-6 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end no-print'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const el = document.createElement('div');
    const icon = { ok: 'fa-circle-check text-emerald-400', error: 'fa-circle-exclamation text-red-400', info: 'fa-paper-plane text-sky-300' }[kind];
    el.className = 'toast flex items-start gap-3 max-w-sm w-full sm:w-auto rounded-2xl px-4 py-3 text-sm text-white shadow-2xl';
    el.innerHTML = `<i class="fas ${icon} mt-0.5"></i><span></span>`;
    el.querySelector('span').textContent = message;
    box.appendChild(el);
    if (ms) setTimeout(() => el.remove(), ms);
    return el;
}

// ENVÍO POR CORREO
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function customerEmailOf(sale) {
    const c = customers.find(x => x.id == sale.customerId);
    return c && EMAIL_OK.test(String(c.email || '').trim()) ? c.email.trim() : '';
}
const EMAIL_QUEUE = 'ns_email_queue';
function queueEmail(saleId) {
    let q = [];
    try { q = JSON.parse(localStorage.getItem(EMAIL_QUEUE) || '[]'); } catch { /* vacío */ }
    if (!q.includes(saleId)) q.push(saleId);
    try { localStorage.setItem(EMAIL_QUEUE, JSON.stringify(q)); } catch { /* sin almacenamiento */ }
    toast('La factura se enviará por correo cuando vuelva el internet.', 'info');
}
async function sendQueuedEmails() {
    let q = [];
    try { q = JSON.parse(localStorage.getItem(EMAIL_QUEUE) || '[]'); } catch { return; }
    try { localStorage.removeItem(EMAIL_QUEUE); } catch { /* sin almacenamiento */ }
    for (const id of q) if (sales.find(x => x.id === id && !x.pending)) await emailInvoice(id, { auto: true });
}

async function emailInvoice(saleId, opts = {}) {
    const sale = sales.find(x => x.id === saleId);
    if (!sale) return;
    const to = customerEmailOf(sale);
    if (!to) { if (!opts.auto) toast('Este cliente no tiene un correo válido. Agréguelo en Clientes.', 'error'); return; }
    if (!navigator.onLine || sale.pending) return queueEmail(saleId);
    const pending = toast(`Enviando ${sale.docType || 'factura'} a ${to}…`, 'info', 0);
    try {
        const base64 = opts.base64 || await blobToBase64(await invoicePdfBlob(sale));
        await sendInvoiceEmail(sale.id, base64);
        pending.remove();
        toast(`Factura enviada a ${to}`, 'ok');
        sale.emailedAt = new Date().toISOString(); sale.emailedTo = to;
        if (!document.getElementById('modal-sale').classList.contains('hidden')) openSaleDetail(sale.id);
    } catch (err) {
        pending.remove();
        toast(`No se envió la factura a ${to}: ${err.message}`, 'error', 9000);
    }
}

// COMPARTIR (WhatsApp, Gmail…) desde el teléfono
async function shareInvoice(saleId) {
    const sale = sales.find(x => x.id === saleId);
    if (!sale) return;
    const c = customers.find(x => x.id == sale.customerId);
    const text = `${sale.docType || 'Factura'} ${sale.id} · DGT Technology · Total ${money(sale.total)}. ¡Gracias por su compra!`;
    try {
        const blob = await invoicePdfBlob(sale);
        const file = new File([blob], `${sale.id}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: `${sale.docType || 'Factura'} ${sale.id}`, text });
            return;
        }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    // Sin compartir archivos (PC): abre WhatsApp con el mensaje y descarga el PDF para adjuntarlo
    await downloadPDF(sale.id);
    const phone = String(c?.phone || '').replace(/\D/g, '').replace(/^0/, '58');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text + ' (PDF adjunto)')}`, '_blank', 'noopener');
}

let autoEmail = true;
async function setAutoEmail(on) {
    try {
        await saveSetting('invoice_email_auto', on ? '1' : '0');
        autoEmail = on;
        toast(on ? 'Las facturas se enviarán solas por correo al facturar' : 'Envío automático por correo desactivado', 'ok');
    } catch (err) { toast('No se pudo guardar: ' + err.message, 'error'); }
    syncAutoEmailToggle();
}
function syncAutoEmailToggle() {
    const t = document.getElementById('auto-email-toggle');
    if (t) { t.setAttribute('aria-checked', autoEmail); t.classList.toggle('bg-brand', autoEmail); t.classList.toggle('bg-gray-300', !autoEmail); t.firstElementChild.style.transform = autoEmail ? 'translateX(24px)' : ''; }
}



let salesPeriod = loadPeriod('ns_sales_period', 'todo'), salesStatus = 'todas';
let salesView = 'ventas', rsalesView = 'ventas', rsalesPeriod = loadPeriod('ns_rsales_period', 'todo');
function salesTableRows(list, withProfit) {
    return [...list].sort((a, b) => (saleTime(b) || 0) - (saleTime(a) || 0)).map(s => {
        const cust = customers.find(c => c.id == s.customerId);
        const cancelled = s.status === 'cancelada';
        const t = saleTime(s);
        const paySummary = (s.payments || []).map(payName).join(', ');
        const names = (s.items || []).map(i => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ');
        const profit = s.total - (Number(s.costTotal) || 0);
        return `
        <tr class="border-b dark:border-gray-800 row-click hover:bg-gray-50 dark:hover:bg-white/5 transition ${cancelled ? 'opacity-70' : ''}" onclick="if(!event.target.closest('button'))openSaleDetail('${s.id}')" tabindex="0" onkeydown="if(event.key==='Enter')openSaleDetail('${s.id}')">
            <td class="p-4"><p class="font-mono font-medium">${s.id}${s.pending ? ' <span class="cond-badge usado" title="Se enviará a la nube al volver la conexión"><i class="fas fa-cloud-arrow-up"></i>Sin enviar</span>' : ''}${s.emailedAt ? ' <i class="fas fa-envelope-circle-check text-emerald-500 text-xs" title="Enviada por correo"></i>' : ''}</p><p class="text-xs text-gray-400">${escHtml(s.docType || '')} · ${t ? t.toLocaleString('es-VE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : escHtml(s.date)}</p>
                ${cancelled ? `<span class="inline-block mt-1 px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-600 rounded-full">Anulada</span>` : ''}</td>
            <td class="p-4">${escHtml(cust ? cust.name : 'Cliente general')}</td>
            ${withProfit ? `<td class="p-4 text-sm">${escHtml(names)}</td><td class="p-4 admin-only">${money(s.costTotal)}</td>` : `<td class="p-4 text-xs">${escHtml(paySummary)}</td>`}
            <td class="p-4 font-bold ${cancelled ? 'line-through text-gray-400' : ''}">${money(s.total)}</td>
            ${withProfit ? `<td class="p-4 admin-only font-bold ${cancelled ? 'line-through text-gray-400' : profit >= 0 ? 'text-emerald-600' : 'text-red-500'}">${money(profit)}</td>` : ''}
            <td class="p-4"><div class="flex justify-center gap-1">
                <button onclick="reprint('${s.id}', true)" class="w-9 h-9 rounded-lg text-brand hover:bg-brand/10" title="Descargar PDF"><i class="fas fa-file-pdf"></i></button>
                <button onclick="reprint('${s.id}', false)" class="w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" title="Imprimir"><i class="fas fa-print"></i></button>
                ${cancelled
                    ? `<button onclick="deleteSale('${s.id}')" class="w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="Eliminar"><i class="fas fa-trash"></i></button>`
                    : `<button onclick="openCancelSale('${s.id}')" class="w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="Anular"><i class="fas fa-ban"></i></button>`}
            </div></td>
        </tr>`;
    }).join('');
}

function matchSale(s, q) {
    if (!q) return true;
    const c = customers.find(x => x.id == s.customerId);
    return `${s.id} ${c ? c.name + ' ' + (c.cedula || '') : ''} ${(s.items || []).map(i => i.name + ' ' + (i.serial || '')).join(' ')}`.toLowerCase().includes(q);
}

function summaryCards(list, extra = []) {
    const act = list.filter(s => s.status !== 'cancelada');
    const tot = act.reduce((a, s) => a + s.total, 0);
    return [['Vendido', money(tot), ''], ['Ventas', `${act.length}${list.length - act.length ? ` <span class="text-xs font-normal text-gray-400">+${list.length - act.length} anuladas</span>` : ''}`, ''], ...extra]
        .map(([l, v, c]) => `<div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4"><p class="text-xs text-gray-400">${l}</p><p class="text-lg md:text-xl font-bold tabular-nums ${c}">${v}</p></div>`).join('');
}

function renderSales() {
    bindSeg('sales-status', 's', salesStatus, (v) => { salesStatus = v; renderSales(); });
    const tbody = document.getElementById('sales-table-body');
    const all = sales.filter(s => !isResaleSale(s));
    const r = periodRangeOf(salesPeriod, all);
    bindPeriod('sales-period', salesPeriod, r, (st) => { salesPeriod = st; savePeriod('ns_sales_period', st); renderSales(); });
    const q = (document.getElementById('sales-search').value || '').toLowerCase().trim();
    const list = all.filter(s => (r.all || inRange(s, r)) && (salesStatus === 'todas' || (s.status || 'activa') === salesStatus) && matchSale(s, q));
    const act = list.filter(s => s.status !== 'cancelada');
    document.getElementById('sales-summary').innerHTML = summaryCards(list, [['Ticket promedio', money(act.length ? act.reduce((a, s) => a + s.total, 0) / act.length : 0), '']]);
    if (!all.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-gray-500">Aún no hay ventas de tienda. <button onclick="showSection(\'pos\')" class="text-brand font-semibold hover:underline">Registrar la primera</button></td></tr>';
        return;
    }
    tbody.innerHTML = list.length ? salesTableRows(list, false) : '<tr><td colspan="5" class="p-10 text-center text-gray-500">Ninguna venta coincide con la búsqueda o el filtro.</td></tr>';
    showSalesView('sales', salesView, list, periodTitle(salesPeriod, r), () => renderSales(), (v) => { salesView = v; renderSales(); });
}
function showSalesView(prefix, view, list, title, rerender, setView) {
    bindSeg(prefix + '-view', 'v', view, setView);
    const clients = view === 'clientes';
    document.getElementById(prefix + '-clients')?.classList.toggle('hidden', !clients);
    document.getElementById(prefix + '-table-wrap')?.classList.toggle('hidden', clients);
    if (clients) {
        refreshClientsPanel = () => { const f = document.activeElement?.hasAttribute('data-cl-search'); renderClientsPanel(prefix + '-clients', list, title); if (f) { const i = document.querySelector(`#${prefix}-clients [data-cl-search]`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } };
        refreshClientsPanel();
    }
}

async function reprint(id, asPDF) {
    const s = sales.find(x => x.id === id);
    if(!s) return;
    fillInvoice(s);
    if(asPDF) {
        await downloadPDF(id);
    } else {
        window.print();
    }
}

function fmtMoney(n) {
    return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fillInvoice(sale) {
    const cust = customers.find(c => c.id == sale.customerId);
    const seller = sellers.find(x => x.id == sale.sellerId);
    const cancelled = sale.status === 'cancelada';
    const rate = sale.rate || 1;
    const set = (id, val) => document.getElementById(id).innerText = val;

    set('inv-title', sale.docType || 'Nota de Entrega');
    const ch = document.getElementById('inv-channel');
    ch.innerText = isResaleSale(sale) ? 'REVENTA' : 'TIENDA';
    set('inv-number', `N.º ${sale.id}`);
    set('inv-date', sale.date);
    set('inv-seller', seller ? seller.name : 'S/D');
    const status = document.getElementById('inv-status');
    status.innerText = cancelled ? 'ANULADA' : 'Pagado';
    status.style.color = cancelled ? '#DC2626' : '#16A34A';
    set('inv-customer', cust ? cust.name : 'Cliente General');
    set('inv-customer-id', cust ? (cust.cedula || cust.rif || 'S/D') : 'S/D');
    set('inv-customer-email', cust ? (cust.email || 'S/D') : 'S/D');
    set('inv-customer-phone', cust ? (cust.phone || 'S/D') : 'S/D');

    document.getElementById('inv-watermark').classList.toggle('hidden', !cancelled);
    document.getElementById('inv-cancel-box').classList.toggle('hidden', !cancelled);
    set('inv-cancel-reason', cancelled ? `Motivo: ${sale.cancelReason} (${sale.cancelDate})` : '');

    document.getElementById('inv-items').innerHTML = sale.items.map((i, idx) => {
        const b = brands.find(br => br.id == i.brandId);
        const colorName = i.source === 'reventa' ? (i.colorLabel || '') : (AVAILABLE_COLORS.find(c => c.hex === i.color)?.name || '');
        const cond = condOf(i) ? ' · ' + COND_LABEL[condOf(i)] : '';
        const desc = `${b ? b.name + ' ' : ''}${i.name}${colorName ? ' ' + colorName : ''}${cond}${i.serial ? ' · S/N ' + i.serial : ''}`.toUpperCase();
        return `
            <tr style="border-bottom:1px solid #ECECF3;">
                <td class="py-3 px-3" style="color:#8A8AA0;">${String(idx + 1).padStart(2, '0')}</td>
                <td class="py-3 px-3">${desc}</td>
                <td class="py-3 px-3 text-right">${fmtMoney(i.price)}</td>
                <td class="py-3 px-3 text-center">${i.qty}</td>
                <td class="py-3 px-3 text-right"><span style="color:#8A8AA0;">${appCurrency}</span> <strong>${fmtMoney(i.price * i.qty)}</strong></td>
            </tr>
        `;
    }).join('');

    document.getElementById('inv-payment-details').innerHTML = (sale.payments || []).map(p => {
        const m = { name: payName(p) };
        if (p.tradeIn) return `<div style="max-width:300px;"><div class="flex justify-between"><span>Se recibe ${escHtml(tradeInTitle(p.tradeIn))}</span><span class="font-semibold">${appCurrency} ${fmtMoney(p.amount)}</span></div><p style="font-size:10px;color:#8A8AA0;">Equipo como parte de pago · ${escHtml(tradeInDesc(p.tradeIn))}</p></div>`;
        if (p.currency === 'VES') {
            const bs = p.amountBs != null ? p.amountBs : p.amount * rate;
            return `<div style="max-width:300px;"><div class="flex justify-between"><span>${m ? m.name : 'Método'}</span><span class="font-semibold">Bs. ${fmtMoney(bs)}</span></div><p class="text-right" style="font-size:10px;color:#8A8AA0;">${appCurrency} ${fmtMoney(p.amount)} · Tasa ${p.rateType || sale.rateType || ''} ${fmtMoney(rate)}</p></div>`;
        }
        return `<div class="flex justify-between" style="max-width:300px;"><span>${m ? m.name : 'Método'}</span><span class="font-semibold">${appCurrency} ${fmtMoney(p.amount)}</span></div>`;
    }).join('') || '<p style="color:#8A8AA0;">S/D</p>';

    const units = sale.items.reduce((a, i) => a + i.qty, 0);
    const totalUsd = sale.total;
    const dFee = feeOf(sale);
    const dRow = document.getElementById('inv-delivery-row');
    dRow.classList.toggle('hidden', !dFee);
    if (dFee) { set('inv-delivery-label', sale.delivery.label || 'Delivery'); set('inv-delivery', `${appCurrency} ${fmtMoney(dFee)}`); }
    const totalBs = sale.total * rate;
    set('inv-count', units);
    set('inv-subtotal', `${appCurrency} ${fmtMoney(totalUsd - dFee)}`);
    const main = document.getElementById('inv-total-main');
    if(sale.mainCurrency === 'BS' || sale.mainCurrency === 'Bs' || sale.mainCurrency === 'VES') {
        main.innerHTML = `<span style="font-size:12px;opacity:.8;">Bs.</span> ${fmtMoney(totalBs)}`;
        set('inv-total-sec', `${appCurrency} ${fmtMoney(totalUsd)} (Tasa ${sale.rateType ? sale.rateType + ' ' : ''}${fmtMoney(rate)})`);
    } else {
        main.innerHTML = `<span style="font-size:12px;opacity:.8;">${appCurrency}</span> ${fmtMoney(totalUsd)}`;
        set('inv-total-sec', `Bs. ${fmtMoney(totalBs)} (Tasa ${sale.rateType ? sale.rateType + ' ' : ''}${fmtMoney(rate)})`);
    }
}

// CANCEL / DELETE SALES
let cancelSaleId = null;

function openCancelSale(id) {
    const s = sales.find(x => x.id === id);
    if(!s || s.status === 'cancelada') return;
    cancelSaleId = id;
    const cust = customers.find(c => c.id == s.customerId);
    document.getElementById('cancel-sale-info').innerText = `${s.docType || 'Venta'} ${s.id} · ${cust ? cust.name : 'Cliente General'} · ${formatUSD(s.total)}`;
    openModal('modal-cancel-sale');
}

document.getElementById('form-cancel-sale').onsubmit = async (e) => {
    e.preventDefault();
    const reason = document.getElementById('cancel-sale-reason').value.trim();
    if(!reason) return alert('Debe indicar el motivo de la cancelación');
    const s = sales.find(x => x.id === cancelSaleId);
    if(!s || s.status === 'cancelada') return;
    try {
        await cancelSale(s.id, reason);
    } catch (err) {
        return alert('No se pudo anular: ' + err.message);
    }
    await reloadData();
    closeModal('modal-cancel-sale');
    cancelSaleId = null;
    refreshSalesViews();
};

async function deleteSale(id) {
    const s = sales.find(x => x.id === id);
    if(!s) return;
    if(s.status !== 'cancelada') return alert('Primero debe anular la venta indicando el motivo.');
    if(!confirm(`¿Eliminar definitivamente la venta ${s.id}? Se perderá el registro y el motivo de anulación.`)) return;
    try {
        await deleteSaleRemote(id);
    } catch (err) {
        return alert('No se pudo eliminar: ' + err.message);
    }
    await reloadData();
    refreshSalesViews();
}

function refreshSalesViews() {
    renderCustomers();
    renderSellers();
    renderSales();
    renderResaleSales();
    renderResaleItems();
    renderResaleDashboard();
    renderInventory();
    updateDashboard();
}

// FECHAS DE VENTA: ver src/fechas.js (hora de la nube; la escrita solo para ventas sin conexión)
const saleTime = (s) => saleTimeOf(s);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const money = (v) => `${appCurrency}${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortMoney = (v) => Math.abs(v) >= 1000 ? `${appCurrency}${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : `${appCurrency}${Math.round(v)}`;
const dayLabel = (d) => d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace('.', '');
const unitsOf = (s) => (s.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// PERÍODOS: estado { k } o { k:'custom', a, b } → rango [desde, hasta)  (src/periodo.js)
function periodRangeOf(st, list = []) { return rangeOf(st, list.map(saleTime)); }
function previousRange(r) { return prevRangeOf(r); }
const inRange = (s, r) => { const t = saleTime(s); return !!t && t >= r.from && t < r.to; };
function buckets(r) { return bucketsOf(r); }
function bindPeriod(id, st, r, onChange) { mountPeriod(document.getElementById(id), { state: st, range: r, onChange }); }

// Controles segmentados (botones con data-*)
function bindSeg(id, attr, value, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('button').forEach(b => {
        b.classList.toggle('on', b.dataset[attr] === value);
        b.setAttribute('aria-pressed', b.dataset[attr] === value);
        b.onclick = () => onChange(b.dataset[attr]);
    });
}

let dashPeriod = loadPeriod('ns_dash_period', '30');
let dashMetric = 'monto';
const METRIC = {
    monto: { name: 'Vendido', fn: (s) => s.total, fmt: (v) => shortMoney(v), full: (v) => money(v) },
    ventas: { name: 'Ventas', fn: () => 1, fmt: (v) => String(Math.round(v)), full: (v) => `${Math.round(v)} venta(s)` },
    equipos: { name: 'Equipos', fn: unitsOf, fmt: (v) => String(Math.round(v)), full: (v) => `${Math.round(v)} equipo(s)` },
};

function deltaText(cur, prev) {
    if (prev == null) return '';
    if (!prev) return cur > 0 ? '<span class="text-emerald-600">Nuevo frente al período anterior</span>' : '<span class="text-gray-400">Sin ventas en el período anterior</span>';
    const d = ((cur - prev) / prev) * 100;
    const up = d >= 0;
    return `<span class="${up ? 'text-emerald-600' : 'text-red-500'}"><i class="fas fa-arrow-${up ? 'up' : 'down'} text-[10px]"></i> ${Math.abs(d).toFixed(0)}%</span> <span class="text-gray-400">vs. período anterior</span>`;
}

// Las cifras cuentan hasta su valor (respeta "reducir movimiento")
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function countTo(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const target = parseFloat(String(text).replace(/[^0-9.-]/g, ''));
    const from = parseFloat(el.dataset.v || '0');
    el.dataset.v = isNaN(target) ? '0' : String(target);
    if (reduceMotion || isNaN(target) || target === from || el.closest('section')?.classList.contains('hidden')) { el.innerText = text; return; }
    const isMoney = /\$|Bs/.test(text), t0 = performance.now(), dur = 650;
    const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = from + (target - from) * e;
        el.innerText = k < 1 ? (isMoney ? money(v) : String(Math.round(v))) : text;
        if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// Píldora de variación (▲ 12 %) frente al período anterior
function kpiDelta(cur, prev) {
    if (prev == null) return '';
    if (!prev) return cur > 0 ? '<span class="up"><i class="fas fa-arrow-up"></i> nuevo</span>' : '';
    const d = ((cur - prev) / prev) * 100;
    const up = d >= 0;
    return `<span class="${up ? 'up' : 'down'}" title="Frente al período anterior"><i class="fas fa-caret-${up ? 'up' : 'down'}"></i> ${Math.abs(d) >= 100 ? Math.round(Math.abs(d)) : Math.abs(d).toFixed(1)}%</span>`;
}

// Meta de ventas mensual (Configuración → admin)
let salesGoal = 0;
function setSalesGoal(v) {
    const n = Math.max(0, Math.round(Number(String(v).replace(/[^0-9.]/g, '')) || 0));
    salesGoal = n;
    saveSetting('sales_goal', n).then(() => toast(n ? `Meta mensual: ${money(n)}` : 'Meta eliminada', 'ok', 2500)).catch(err => alert('No se pudo guardar la meta: ' + err.message));
    const cfg = document.getElementById('config-goal'); if (cfg) cfg.value = n || '';
    updateDashboard();
}
function editSalesGoal() {
    const foot = document.getElementById('dash-goal-foot');
    if (!foot) return;
    foot.innerHTML = `<form class="v-goal-form" onsubmit="event.preventDefault();setSalesGoal(this.goal.value)">
        <label for="goal-input">Meta de ventas del mes (${escHtml(appCurrency)})</label>
        <div><input id="goal-input" name="goal" type="number" min="0" step="100" inputmode="numeric" value="${salesGoal || ''}" placeholder="Ej. 10000" required>
        <button type="submit" class="v-cta !py-2">Guardar</button><button type="button" class="v-link" onclick="updateDashboard()">Cancelar</button></div></form>`;
    document.getElementById('goal-input')?.focus();
}

// Ventas del período en Excel (CSV con ; para Excel en español)
let dashPeriodSales = [], dashPeriodTitle = '';
function exportPeriodCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [...dashPeriodSales].sort((a, b) => (saleTime(a) || 0) - (saleTime(b) || 0)).map(s => {
        const t = saleTime(s), c = customers.find(x => x.id == s.customerId), sl = sellers.find(x => x.id == s.sellerId);
        return [t ? t.toLocaleDateString('es-VE') : s.date, t ? t.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '', s.id, s.docType || '', c ? c.name : 'Cliente general', c ? (c.cedula || '') : '', itemsText(s), unitsOf(s), (s.payments || []).map(payName).join(', '), sl ? sl.name : '', Number(s.total).toFixed(2).replace('.', ',')].map(q).join(';');
    });
    if (!rows.length) return toast('No hay ventas en este período para descargar.', 'info', 3000);
    const head = ['Fecha', 'Hora', 'Documento', 'Tipo', 'Cliente', 'Cédula/RIF', 'Productos', 'Equipos', 'Pago', 'Vendedor', 'Total'].map(q).join(';');
    const blob = new Blob(['﻿' + [head, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ventas ${dashPeriodTitle}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

let dashSellerLists = [];
function openSellerSales(i) { const it = dashSellerLists[i]; if (it) openSalesList(`Ventas de ${it.label}`, it.list); }

function updateDashboard() {
    const storeSales = sales.filter(s => !isResaleSale(s));
    const active = storeSales.filter(s => s.status !== 'cancelada');
    const r = periodRangeOf(dashPeriod, active);
    const inP = active.filter(s => inRange(s, r));
    const prevR = previousRange(r);
    const prev = prevR ? active.filter(s => inRange(s, prevR)) : null;
    const sum = (l) => l.reduce((a, s) => a + s.total, 0);
    const units = (l) => l.reduce((a, s) => a + unitsOf(s), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    const html = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    const title = periodTitle(dashPeriod, r);
    dashPeriodSales = inP; dashPeriodTitle = title;

    bindPeriod('dash-period', dashPeriod, r, (st) => { dashPeriod = st; savePeriod('ns_dash_period', st); updateDashboard(); });
    bindSeg('dash-metric', 'm', dashMetric, (m) => { dashMetric = m; updateDashboard(); });
    set('dash-hello', currentProfile ? ((currentProfile.full_name || currentProfile.email || '').split(/[\s@]/)[0] || '—') : '—');
    set('current-date', new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' }));

    // Indicadores
    const total = sum(inP), n = inP.length, u = units(inP);
    const pTotal = prev ? sum(prev) : null, pN = prev ? prev.length : null, pU = prev ? units(prev) : null;
    countTo('dash-total-sales', money(total));
    set('dash-kpi-period', title.charAt(0).toLowerCase() + title.slice(1));
    html('dash-total-delta', kpiDelta(total, pTotal));
    countTo('dash-count-sales', n);
    html('dash-count-delta', kpiDelta(n, pN));
    countTo('dash-ticket', money(n ? total / n : 0));
    html('dash-ticket-delta', kpiDelta(n ? total / n : 0, prev ? (pN ? pTotal / pN : 0) : null));
    countTo('dash-units', u);
    html('dash-units-delta', kpiDelta(u, pU));
    const onKpi = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    onKpi('kpi-total', () => openSalesList(`Ventas · ${title}`, inP));
    onKpi('kpi-count', () => openSalesList(`Ventas · ${title}`, inP));
    onKpi('kpi-ticket', () => openSalesList(`Ventas · ${title} (de mayor a menor)`, [...inP].sort((a, b) => b.total - a.total)));
    onKpi('kpi-units', () => { productSalesScope = inP; openSalesList(`Equipos vendidos · ${title}`, inP); });

    const comm = inP.reduce((a, s) => { const sl = sellers.find(x => x.id == s.sellerId); return a + (sl ? (s.total - feeOf(s)) * sl.comm : 0); }, 0);
    set('dash-total-commissions', money(comm));
    const low = products.filter(p => p.stock < 5);
    set('dash-low-stock', low.length);
    set('dash-total-products', products.length);

    // Hoy
    const todayK = dayKey(new Date());
    const today = active.filter(s => { const t = saleTime(s); return t && dayKey(t) === todayK; });
    html('dash-today-line', ` · <button type="button" class="v-today" onclick="openSalesList('Ventas de hoy', boardLists.hoy)">Hoy: <b>${money(sum(today))}</b> en ${today.length} venta${today.length === 1 ? '' : 's'}</button>`);
    const bcv = getRate('BCV'), bin = getRate('Binance P2P');
    set('dash-rate-gap', bcv > 0 && bin > 0 ? `${(((bin - bcv) / bcv) * 100).toFixed(1)}%` : '—');

    // Gráfica principal
    const bk = buckets(r);
    const M = METRIC[dashMetric];
    const values = bk.map(b => inP.filter(s => inRange(s, b)).reduce((a, s) => a + M.fn(s), 0));
    set('dash-chart-sub', `${title} · ${M.full(values.reduce((a, b) => a + b, 0))}`);
    const visible = (el) => el && !el.closest('section').classList.contains('hidden');
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const pickRange = (i, j) => {
        const span = { from: bk[i].from, to: bk[j].to };
        if (bk[0].unit === 'hora') return openSalesList(`${bk[i].title.split(' de ')[0]} de ${bk[i].from.getHours()}:00 a ${bk[j].to.getHours() || 24}:00`, inP.filter(s => inRange(s, span)));
        const last = new Date(span.to); last.setDate(last.getDate() - 1);
        dashPeriod = { k: 'custom', a: ymd(span.from), b: ymd(last) }; savePeriod('ns_dash_period', dashPeriod);
        updateDashboard();
        toast(`Período: ${rangeLabel({ from: span.from, to: span.to })}`, 'info', 2500);
    };
    const area = document.getElementById('dash-area');
    if (visible(area)) {
        mountAreaChart(area, {
            labels: bk.map(b => b.label),
            series: [{ name: M.name, values, color: 'var(--chart)' }],
            format: M.fmt,
            tipFormat: dashMetric === 'monto' ? money : M.fmt,
            ariaLabel: `${M.name} por ${bk[0] ? bk[0].unit : 'día'}. Use las flechas para recorrer y Enter para ver las ventas.`,
            detail: (i) => { const l = inP.filter(s => inRange(s, bk[i])); return dashMetric === 'monto' ? `${l.length} venta(s)` : money(sum(l)); },
            onSelect: (i) => openSalesList(bk[i].title, inP.filter(s => inRange(s, bk[i]))),
            onRange: pickRange,
        });
    }

    // Ventas vs meta: lo vendido en cada día/mes contra la meta de ese día/mes
    const goalEl = document.getElementById('dash-goal');
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthSold = sum(active.filter(s => { const t = saleTime(s); return t && t >= monthStart; }));
    const unit = bk[0] ? bk[0].unit : 'día';
    const goalPer = !salesGoal ? 0 : unit === 'mes' ? salesGoal : unit === 'día' ? salesGoal / daysInMonth : salesGoal / daysInMonth / 24;
    const sold = bk.map(b => sum(inP.filter(s => inRange(s, b))));
    const hit = goalPer ? sold.filter(v => v >= goalPer).length : 0;
    set('dash-goal-sub', salesGoal ? `Meta por ${unit}: ${money(goalPer)} · se cumplió ${hit} de ${bk.length} ${unit === 'mes' ? 'meses' : unit === 'día' ? 'días' : 'horas'}` : 'Fija una meta mensual para comparar');
    if (visible(goalEl)) {
        if (salesGoal) {
            mountAreaChart(goalEl, {
                labels: bk.map(b => b.label),
                series: [{ name: 'Vendido', values: sold, color: 'var(--chart)' }, { name: 'Meta', values: bk.map(() => goalPer), color: 'var(--ink-rgb)', flat: true }],
                format: shortMoney, tipFormat: money, height: 220,
                ariaLabel: `Vendido contra meta por ${unit}`,
                detail: (i) => { const d = sold[i] - goalPer; return d >= 0 ? `Superó la meta por ${money(d)}` : `Faltaron ${money(-d)}`; },
                onSelect: (i) => openSalesList(bk[i].title, inP.filter(s => inRange(s, bk[i]))),
                onRange: pickRange,
            });
        } else {
            goalEl.innerHTML = `<div class="v-empty"><i class="fas fa-bullseye"></i><p>Con una meta mensual verás cada día si vendiste más o menos de lo esperado.</p>${isAdmin() ? '<button class="v-cta" onclick="editSalesGoal()"><i class="fas fa-plus"></i><span>Fijar meta</span></button>' : '<p class="text-xs">La fija un administrador.</p>'}</div>`;
        }
    }
    const pct = salesGoal ? monthSold / salesGoal : 0;
    html('dash-goal-foot', salesGoal ? `
        <div class="v-goal-bar"><span style="width:${Math.min(100, pct * 100)}%"></span></div>
        <div class="v-goal-meta"><span>${now.toLocaleDateString('es-VE', { month: 'long' })}: <b>${money(monthSold)}</b> de ${money(salesGoal)} · <b class="${pct >= 1 ? 'text-emerald-600' : ''}">${Math.round(pct * 100)}%</b>${pct < 1 ? ` · faltan ${money(salesGoal - monthSold)}` : ' · ¡meta cumplida!'}</span>${isAdmin() ? '<button class="v-link" onclick="editSalesGoal()"><i class="fas fa-pen"></i> Cambiar meta</button>' : ''}</div>` : '');

    // Quién te compró
    const cs = clientStats(inP).sort(CLIENT_SORT.monto);
    html('dash-clients', clientRowsHtml(cs, { limit: 5 }));
    set('dash-clients-sub', cs.length ? `${cs.length} cliente${cs.length === 1 ? '' : 's'} · ${title.toLowerCase()} · toca uno para ver sus compras` : 'Clientes del período');

    // Mejores vendedores (estilo "top sales reps")
    const bySeller = {};
    inP.forEach(s => { const k = s.sellerId || '—'; (bySeller[k] = bySeller[k] || []).push(s); });
    dashSellerLists = Object.entries(bySeller).map(([id, l]) => {
        const sl = sellers.find(x => x.id == id);
        return { label: sl ? sl.name : 'Sin vendedor', value: sum(l), n: l.length, comm: sl ? sum(l) * sl.comm : 0, list: l };
    }).sort((a, b) => b.value - a.value);
    const maxS = Math.max(1, ...dashSellerLists.map(x => x.value));
    html('dash-by-seller', dashSellerLists.length ? `<ul class="v-reps">${dashSellerLists.slice(0, 5).map((x, i) => `
        <li><button type="button" onclick="openSellerSales(${i})" class="v-rep">
            <span class="v-rep-top"><span class="avatar w-7 h-7 text-[10px] shrink-0">${escHtml(getInitials(x.label))}</span><b class="truncate flex-1">${escHtml(x.label)}</b><b class="tabular-nums">${money(x.value)}</b></span>
            <span class="v-bar"><span style="width:${(x.value / maxS) * 100}%"></span></span>
            <span class="v-rep-sub">${x.n} venta${x.n === 1 ? '' : 's'}${isAdmin() ? ' · comisión ' + money(x.comm) : ''}</span>
        </button></li>`).join('')}</ul>` : '<p class="v-none">Sin ventas en este período</p>');

    // Cómo te pagan (anillo)
    const byMethod = {};
    inP.forEach(s => (s.payments || []).forEach(p => {
        const k = payName(p);
        (byMethod[k] = byMethod[k] || { value: 0, list: new Set(), bs: 0 });
        byMethod[k].value += Number(p.amount) || 0;
        if (p.currency === 'VES') byMethod[k].bs += Number(p.amountBs) || 0;
        byMethod[k].list.add(s);
    }));
    const methodItems = Object.entries(byMethod).map(([k, v]) => ({ label: k, value: v.value, sub: `${v.list.size} venta(s)${v.bs ? ' · ' + fmtBs(v.bs) : ''}`, list: [...v.list] })).sort((a, b) => b.value - a.value);
    const methodEl = document.getElementById('dash-by-method');
    if (methodEl) mountDonut(methodEl, {
        items: methodItems,
        format: money,
        onSelect: (it) => openSalesList(`Pagos con ${it.label}`, it.list),
    });

    // Inventario
    const healthy = products.length ? products.filter(p => p.stock >= 5).length / products.length : 0;
    html('dash-gauge', gauge(healthy, { size: 120, label: 'stock sano' }));
    set('dash-units-stock', products.reduce((a, p) => a + (p.stock || 0), 0).toLocaleString('en-US'));
    set('dash-stock-value', money(products.reduce((a, p) => a + (p.stock || 0) * (p.price || 0), 0)));
    html('dash-low-list', low.length ? [...low].sort((a, b) => a.stock - b.stock).slice(0, 4).map(p => {
        const b = brands.find(x => x.id == p.brandId);
        const color = AVAILABLE_COLORS.find(c => c.hex === p.color)?.name || '';
        return `<li><button onclick="editProduct(${p.id})" class="v-low">
            <span class="truncate">${escHtml((b ? b.name + ' ' : '') + p.name)} <span class="text-gray-400 text-xs">${escHtml(color)}</span></span>
            <span class="v-pill ${p.stock === 0 ? 'is-bad' : 'is-warn'}">${p.stock === 0 ? 'Agotado' : p.stock + ' u'}</span></button></li>`;
    }).join('') : '<li class="text-sm text-gray-400 py-1">Todo el inventario tiene 5 u o más.</li>');

    // Más vendidos (barras tipo embudo)
    const top = getProductHistory(inP).slice(0, 6);
    const maxQty = Math.max(1, ...top.map(t => t.qty));
    const totalUnits = units(inP) || 1;
    set('dash-top-total', top.length ? `${u} u` : '');
    html('dash-top-products', top.length ? `<ul class="v-funnel">${top.map(t => `
        <li><button type="button" class="v-fun" data-pid="${escHtml(String(t.id))}" data-name="${escHtml(t.name)}" onclick="openProductSales(this)" title="${escHtml(t.name)} · ${t.qty} u · ${money(t.total)}">
            <span class="v-fun-name">${escHtml(t.name)}</span>
            <span class="v-fun-track"><span class="v-fun-bar" style="width:${Math.max(14, (t.qty / maxQty) * 100)}%">${t.qty}</span></span>
            <span class="v-fun-pct">${Math.round((t.qty / totalUnits) * 100)}%</span>
        </button></li>`).join('')}</ul>` : `<p class="v-none">No hay ventas en este período. <button onclick="showSection('pos')" class="v-link">Registrar una venta</button></p>`);
    productSalesScope = inP;

    // Últimas ventas
    const todayList = active.filter(s => { const t = saleTime(s); return t && dayKey(t) === todayK; });
    const cancelled = storeSales.filter(s => s.status === 'cancelada' && inRange(s, r));
    boardLists = { todas: inP, hoy: todayList, anuladas: cancelled };
    renderBoard();
}

// ===== Últimas ventas =====
let boardTab = 'todas', boardSel = null, boardLists = { todas: [], hoy: [], anuladas: [] }, dashMethodLists = [];
const BOARD_TITLE = { todas: 'Últimas ventas', hoy: 'Ventas de hoy', anuladas: 'Ventas anuladas' };
function openMethodSales(i) { const m = dashMethodLists[i]; if (m) openSalesList(`Pagos con ${m.k}`, m.list); }
function relTime(t) {
    if (!t) return '';
    const diff = (Date.now() - t) / 60000;
    if (diff < 1) return 'Hace un momento';
    if (diff < 60) return `Hace ${Math.round(diff)} min`;
    if (diff < 60 * 12 && dayKey(t) === dayKey(new Date())) return `Hace ${Math.round(diff / 60)} h`;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const hm = t.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });
    if (dayKey(t) === dayKey(new Date())) return `Hoy ${hm}`;
    if (dayKey(t) === dayKey(y)) return `Ayer ${hm}`;
    return t.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }) + ' · ' + hm;
}
function saleStatus(s) {
    if (s.status === 'cancelada') return { text: 'Anulada', cls: 'is-bad' };
    if (s.pending) return { text: 'Sin enviar', cls: 'is-warn' };
    const p = (s.payments || [])[0];
    return { text: p ? payName(p) : 'Pagada', cls: '' };
}
function renderBoard() {
    const tabs = document.getElementById('dash-board-tabs');
    if (!tabs) return;
    bindSeg('dash-board-tabs', 't', boardTab, (t) => { boardTab = t; renderBoard(); });
    tabs.querySelectorAll('button').forEach(b => { const n = boardLists[b.dataset.t]?.length || 0; b.querySelector('.n').textContent = n ? n : ''; });
    const list = [...(boardLists[boardTab] || [])].sort((a, b) => (saleTime(b) || 0) - (saleTime(a) || 0));
    document.getElementById('dash-board-title').textContent = BOARD_TITLE[boardTab];
    const shown = list.slice(0, 5);
    document.getElementById('dash-recent').innerHTML = shown.length ? shown.map(s => {
        const c = customers.find(x => x.id == s.customerId), st = saleStatus(s);
        return `<li><button onclick="openSaleDetail('${s.id}')" class="v-sale">
            <span class="avatar w-9 h-9 text-[11px] shrink-0">${escHtml(getInitials(c ? c.name : 'Cliente general'))}</span>
            <span class="min-w-0 flex-1"><span class="block text-sm font-semibold truncate">${escHtml(c ? c.name : 'Cliente general')}</span><span class="block text-[11px] text-gray-400 truncate">${escHtml(relTime(saleTime(s)))} · ${escHtml(s.id)}</span></span>
            <span class="text-right shrink-0"><b class="block text-sm tabular-nums ${s.status === 'cancelada' ? 'line-through opacity-50' : ''}">${money(s.total)}</b><span class="v-pill ${st.cls}">${escHtml(st.text)}</span></span></button></li>`;
    }).join('') + (list.length > shown.length ? `<li><button onclick="openBoardAll()" class="v-more">Ver ${list.length - shown.length} más <i class="fas fa-arrow-right text-[10px]"></i></button></li>` : '')
        : `<li class="v-none">${boardTab === 'anuladas' ? 'No hay ventas anuladas en este período' : boardTab === 'hoy' ? 'Aún no hay ventas hoy' : 'Sin ventas en este período'}</li>`;
}
function openBoardAll() { openSalesList(BOARD_TITLE[boardTab], boardLists[boardTab] || []); }
function selectBoardSale(id) {
    boardSel = id;
    document.querySelectorAll('#dash-recent .board-row').forEach(b => { const on = b.getAttribute('onclick').includes(`'${id}'`); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    renderBoardInvoice();
    if (window.innerWidth < 1024) document.getElementById('dash-invoice').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
}
function renderBoardInvoice() {
    const el = document.getElementById('dash-invoice');
    if (!el) return;
    const s = sales.find(x => x.id === boardSel);
    if (!s) {
        el.innerHTML = `<div class="h-full min-h-[220px] flex flex-col items-center justify-center text-center gap-3 text-white/80"><i class="fas fa-file-invoice text-3xl opacity-60"></i><p class="text-sm">Cuando registres una venta, su detalle aparecerá aquí.</p><button onclick="showSection('pos')" class="pill-light"><i class="fas fa-plus"></i> Nueva venta</button></div>`;
        return;
    }
    const c = customers.find(x => x.id == s.customerId);
    const sl = sellers.find(x => x.id == s.sellerId);
    const st = saleStatus(s), fee = feeOf(s), items = s.items || [];
    const itemName = (it) => { const b = brands.find(x => x.id == it.brandId); return (it.source === 'reventa' || !b ? '' : b.name + ' ') + (it.name || 'Producto'); };
    const tiles = items.slice(0, 3).map(it => `
        <button onclick="openSaleDetail('${s.id}')" class="inv-tile" title="${escHtml(itemName(it))}">
            <span class="flex items-start justify-between gap-2"><b class="tabular-nums">${money((Number(it.price) || 0) * (Number(it.qty) || 1))}</b><i class="fas fa-arrow-right -rotate-45 text-[11px] opacity-70 mt-1"></i></span>
            <span class="text-[11px] opacity-75 truncate">${Number(it.qty) > 1 ? it.qty + '× ' : ''}${escHtml(itemName(it))}</span>
        </button>`).join('');
    const extra = items.length > 3
        ? `<button onclick="openSaleDetail('${s.id}')" class="inv-tile inv-add"><i class="fas fa-ellipsis"></i><span class="text-[11px]">+${items.length - 3} producto(s)</span></button>`
        : `<button onclick="showSection('pos')" class="inv-tile inv-add"><i class="fas fa-plus"></i><span class="text-[11px]">Nueva venta</span></button>`;
    const paid = (s.payments || []).map(payName).filter((v, i, a) => a.indexOf(v) === i).join(' + ') || '—';
    el.innerHTML = `<div class="inv-anim">
        <div class="grid grid-cols-2 md:grid-cols-[1.2fr_1fr_1.2fr] gap-4 items-start">
            <div class="min-w-0"><p class="inv-label">${escHtml(s.docType || 'Factura')}</p><p class="text-2xl md:text-[1.7rem] font-bold tracking-tight truncate"># ${escHtml(s.id)}</p><span class="row-pill ${st.cls} mt-1.5">${escHtml(st.text)}</span></div>
            <div class="min-w-0 hidden md:block"><p class="inv-label">Vendedor</p><p class="font-semibold truncate">${escHtml(sl ? sl.name : 'Sin vendedor')}</p><p class="text-[11px] text-white/60 truncate">${escHtml(relTime(saleTime(s)))}</p></div>
            <div class="min-w-0"><p class="inv-label">Cliente</p><div class="flex items-center gap-2.5 min-w-0"><span class="avatar avatar-light w-9 h-9 text-xs shrink-0">${escHtml(getInitials(c ? c.name : 'CG'))}</span><span class="min-w-0"><span class="block text-sm font-semibold truncate">${escHtml(c ? c.name : 'Cliente general')}</span><span class="block text-[11px] text-white/60 truncate">${escHtml(c ? (c.cedula || c.rif || c.phone || c.email || '') : '')}</span></span></div></div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">${tiles}${extra}</div>
        <div class="inv-foot">
            <div class="flex flex-wrap gap-x-8 gap-y-2">
                <div><p class="inv-label">Productos</p><p class="font-bold tabular-nums">${money(s.total - fee)}</p></div>
                ${fee ? `<div><p class="inv-label">Delivery</p><p class="font-bold tabular-nums">${money(fee)}</p></div>` : `<div class="min-w-0 max-w-[10rem]"><p class="inv-label">Pagado con</p><p class="font-bold truncate">${escHtml(paid)}</p></div>`}
                <div><p class="inv-label">Total</p><p class="text-lg font-bold tabular-nums">${money(s.total)}</p></div>
            </div>
            <div class="flex items-center gap-2 sm:ml-auto">
                <button onclick="shareInvoice('${s.id}')" class="inv-ic" title="Compartir" aria-label="Compartir"><i class="fas fa-share-nodes"></i></button>
                <button onclick="emailInvoice('${s.id}')" class="inv-ic" title="Enviar por correo" aria-label="Enviar por correo"><i class="fas fa-envelope"></i></button>
                <button onclick="openSaleDetail('${s.id}')" class="pill-light">Ver factura</button>
            </div>
        </div>
    </div>`;
}

function saleRowHtml(s) {
    const c = customers.find(x => x.id == s.customerId);
    const cancelled = s.status === 'cancelada';
    const t = saleTime(s);
    return `<li><button onclick="openSaleDetail('${s.id}')" class="w-full flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition">
        <span class="w-9 h-9 rounded-xl ${isResaleSale(s) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-brand/10 text-brand'} flex items-center justify-center shrink-0"><i class="fas ${isResaleSale(s) ? 'fa-recycle' : 'fa-receipt'} text-xs"></i></span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-semibold truncate">${escHtml(c ? c.name : 'Cliente general')}</span><span class="block text-[11px] text-gray-500 dark:text-gray-400 truncate">${t ? escHtml(fullStamp(t)) : escHtml(s.date)} · ${s.id}</span><span class="block text-[11px] text-gray-400 truncate">${escHtml(itemsText(s))}${(s.payments || []).length ? ' · ' + escHtml((s.payments || []).map(payName).join(', ')) : ''}</span></span>
        <span class="text-sm font-bold tabular-nums ${cancelled ? 'line-through text-gray-400' : ''}">${money(s.total)}</span></button></li>`;
}

// ===== Clientes de un período: quién compró, cuánto, cuándo =====
const fullStamp = (t) => `${t.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')}, ${t.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' })}`;
const itemsText = (s) => (s.items || []).map(i => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ');
let clientIndex = {};
function clientStats(list) {
    const map = {};
    list.filter(s => s.status !== 'cancelada').forEach(s => {
        const k = s.customerId == null || s.customerId === '' ? '_general' : String(s.customerId);
        const c = customers.find(x => String(x.id) === k);
        const m = map[k] || (map[k] = { key: k, name: c ? c.name : 'Cliente general', phone: c ? (c.phone || '') : '', cedula: c ? (c.cedula || '') : '', count: 0, total: 0, units: 0, last: null, first: null, list: [] });
        const t = saleTime(s);
        m.count++; m.total += Number(s.total) || 0; m.units += unitsOf(s); m.list.push(s);
        if (t && (!m.last || t > m.last)) m.last = t;
        if (t && (!m.first || t < m.first)) m.first = t;
    });
    const out = Object.values(map);
    const grand = out.reduce((a, m) => a + m.total, 0) || 1;
    out.forEach(m => { m.share = m.total / grand; });
    out.forEach(m => { clientIndex[m.key] = m; });
    return out;
}
const CLIENT_SORT = {
    monto: (a, b) => b.total - a.total,
    compras: (a, b) => b.count - a.count || b.total - a.total,
    reciente: (a, b) => (b.last || 0) - (a.last || 0),
    nombre: (a, b) => a.name.localeCompare(b.name, 'es'),
};
function clientRowsHtml(stats, { limit = 0 } = {}) {
    const rows = limit ? stats.slice(0, limit) : stats;
    if (!rows.length) return '<p class="py-8 text-center text-sm text-gray-400">Nadie compró en este período.</p>';
    const max = Math.max(...stats.map(m => m.share), 0.0001);
    return `<ul class="cl-list">${rows.map((m, i) => `
        <li><button type="button" class="cl-row" onclick="openClientSales('${escHtml(m.key)}')">
            <span class="cl-rank">${i + 1}</span>
            <span class="avatar w-10 h-10 text-xs shrink-0">${escHtml(getInitials(m.name))}</span>
            <span class="cl-main">
                <span class="cl-top"><b class="truncate">${escHtml(m.name)}</b><b class="tabular-nums shrink-0">${money(m.total)}</b></span>
                <span class="cl-bar"><span style="width:${Math.max(2, (m.share / max) * 100)}%"></span></span>
                <span class="cl-meta"><span class="cl-pct">${(m.share * 100).toFixed(m.share < 0.1 ? 1 : 0)}%</span> · ${m.count} compra${m.count === 1 ? '' : 's'} · ${m.units} equipo${m.units === 1 ? '' : 's'}${m.last ? ' · última ' + escHtml(fullStamp(m.last)) : ''}</span>
            </span>
        </button></li>`).join('')}</ul>`;
}
// Vista completa (Ventas → Por cliente): buscar, ordenar y exportar
const clientView = { sort: 'monto', q: '' };
let clientViewStats = [], clientViewTitle = '';
function renderClientsPanel(hostId, list, title) {
    const host = document.getElementById(hostId);
    if (!host) return;
    clientViewTitle = title;
    const all = clientStats(list);
    const q = clientView.q.toLowerCase().trim();
    clientViewStats = all.filter(m => !q || `${m.name} ${m.cedula} ${m.phone}`.toLowerCase().includes(q)).sort(CLIENT_SORT[clientView.sort]);
    const tot = all.reduce((a, m) => a + m.total, 0);
    host.innerHTML = `
        <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div><p class="card-title">Clientes · ${escHtml(title)}</p><p class="card-sub">${all.length} cliente${all.length === 1 ? '' : 's'} · ${money(tot)} · toca uno para ver qué compró, cuándo y a qué hora</p></div>
            <div class="flex flex-wrap items-center gap-2">
                <div class="search-box"><i class="fas fa-search"></i><input type="search" value="${escHtml(clientView.q)}" placeholder="Buscar cliente" oninput="setClientQuery(this.value)" data-cl-search></div>
                <div class="seg" data-cl-sort>${[['monto', 'Monto'], ['compras', 'Compras'], ['reciente', 'Reciente'], ['nombre', 'A–Z']].map(([k, t]) => `<button type="button" data-k="${k}" class="${clientView.sort === k ? 'on' : ''}" onclick="setClientSort('${k}')">${t}</button>`).join('')}</div>
                <button type="button" onclick="exportClientsCsv()" class="period-custom"><i class="fas fa-file-excel"></i><span>Exportar</span></button>
            </div>
        </div>
        ${clientRowsHtml(clientViewStats)}`;
}
let refreshClientsPanel = () => {};
function setClientQuery(v) { clientView.q = v; refreshClientsPanel(); }
function setClientSort(k) { clientView.sort = k; refreshClientsPanel(); }
function openClientSales(key) {
    const m = clientIndex[key];
    if (!m) return;
    openSalesList(`Compras de ${m.name}`, m.list);
}
function exportClientsCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Cliente', 'Cédula/RIF', 'Teléfono', 'Compras', 'Equipos', 'Total', '% del total', 'Primera compra', 'Última compra'];
    const lines = clientViewStats.map(m => [m.name, m.cedula, m.phone, m.count, m.units, m.total.toFixed(2).replace('.', ','), (m.share * 100).toFixed(1).replace('.', ','), m.first ? m.first.toLocaleString('es-VE') : '', m.last ? m.last.toLocaleString('es-VE') : ''].map(q).join(';'));
    const detail = ['', q('Detalle de compras'), ['Cliente', 'Documento', 'Fecha', 'Hora', 'Productos', 'Pago', 'Total'].map(q).join(';'),
        ...clientViewStats.flatMap(m => [...m.list].sort((a, b) => (saleTime(a) || 0) - (saleTime(b) || 0)).map(s => { const t = saleTime(s); return [m.name, s.id, t ? t.toLocaleDateString('es-VE') : s.date, t ? t.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '', itemsText(s), (s.payments || []).map(payName).join(', '), Number(s.total).toFixed(2).replace('.', ',')].map(q).join(';'); }))];
    const blob = new Blob(['﻿' + [head.map(q).join(';'), ...lines, ...detail].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clientes ${clientViewTitle}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function openClientsFromDash() {
    salesPeriod = { ...dashPeriod }; savePeriod('ns_sales_period', salesPeriod);
    salesView = 'clientes';
    showSection('sales');
}

let productSalesScope = [];
function openProductSales(row) {
    const pid = row.dataset.pid;
    openSalesList('Ventas de ' + row.dataset.name, productSalesScope.filter(s => (s.items || []).some(i => String(i.id) === pid)));
}

// Lista de ventas de un día / vendedor / método
function openSalesList(title, list) {
    const sorted = [...list].sort((a, b) => (saleTime(b) || 0) - (saleTime(a) || 0));
    document.getElementById('day-title').innerText = title.charAt(0).toUpperCase() + title.slice(1);
    const act = sorted.filter(s => s.status !== 'cancelada');
    document.getElementById('day-sub').innerText = sorted.length ? `${act.length} venta(s) · ${money(act.reduce((a, s) => a + s.total, 0))} · ${act.reduce((a, s) => a + unitsOf(s), 0)} equipo(s)` : 'No hubo ventas';
    document.getElementById('day-list').innerHTML = sorted.length ? sorted.map(saleRowHtml).join('') : '<li class="py-8 text-center text-gray-400 text-sm">No hay ventas aquí.</li>';
    openModal('modal-day');
}

// Detalle de una venta
function openSaleDetail(id) {
    const s = sales.find(x => x.id === id);
    if (!s) return;
    const c = customers.find(x => x.id == s.customerId);
    const sl = sellers.find(x => x.id == s.sellerId);
    const cancelled = s.status === 'cancelada';
    const resaleS = isResaleSale(s);
    const t = saleTime(s);
    const items = (s.items || []).map(i => {
        const b = brands.find(x => x.id == i.brandId);
        const label = (i.source === 'reventa' ? (i.colorLabel || '') : (AVAILABLE_COLORS.find(cc => cc.hex === i.color)?.name || '')) + (condOf(i) ? ' · ' + COND_LABEL[condOf(i)] : '');
        return `<li class="flex items-center justify-between gap-3 py-2"><span class="min-w-0"><span class="block text-sm font-medium truncate">${escHtml((b ? b.name + ' ' : '') + i.name)}</span><span class="block text-xs text-gray-400">${escHtml(label)}${i.serial ? ' · S/N ' + escHtml(i.serial) : ''} · ${money(i.price)} × ${i.qty}</span></span><b class="tabular-nums text-sm">${money(i.price * i.qty)}</b></li>`;
    }).join('');
    const pays = (s.payments || []).map(p => {
        if (p.tradeIn) return `<li class="text-sm py-1"><p class="flex justify-between gap-3"><span><i class="fas fa-right-left text-sky-600 mr-1"></i>Se recibe ${escHtml(tradeInTitle(p.tradeIn))}</span><span class="tabular-nums">${money(p.amount)}</span></p><p class="text-xs text-gray-400">${escHtml(tradeInDesc(p.tradeIn))}</p></li>`;
        return `<li class="flex justify-between gap-3 text-sm py-1"><span>${escHtml(payName(p))}</span><span class="tabular-nums">${money(p.amount)}${p.currency === 'VES' && p.amountBs != null ? ` <span class="text-xs text-gray-400">(${fmtBs(p.amountBs)})</span>` : ''}</span></li>`;
    }).join('') || '<li class="text-sm text-gray-400">Sin detalle de pago</li>';
    const profit = resaleS ? s.total - (Number(s.costTotal) || 0) : null;
    document.getElementById('sale-detail').innerHTML = `
        <div class="p-6 pb-4 ${cancelled ? 'bg-red-50 dark:bg-red-900/10' : ''} rounded-t-3xl">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm text-gray-500">${escHtml(s.docType || 'Venta')} · <span class="${resaleS ? 'text-emerald-600' : 'text-brand'} font-semibold">${resaleS ? 'Reventa' : 'Tienda'}</span></p>
                    <h3 class="text-2xl font-bold tracking-tight font-mono">${s.id}</h3>
                    <p class="text-sm text-gray-500">${t ? t.toLocaleString('es-VE', { dateStyle: 'full', timeStyle: 'short' }) : escHtml(s.date)}</p>
                </div>
                <button onclick="closeModal('modal-sale')" class="w-9 h-9 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 shrink-0" aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
            </div>
            ${cancelled ? `<p class="mt-3 text-sm text-red-600"><b>Anulada</b> · ${escHtml(s.cancelReason || '')}</p>` : ''}
        </div>
        <div class="px-6 pb-6 space-y-5">
            <div class="grid grid-cols-2 gap-3 text-sm">
                <div class="rounded-xl bg-gray-50 dark:bg-white/5 p-3"><p class="text-xs text-gray-400">Cliente</p><p class="font-semibold truncate">${escHtml(c ? c.name : 'Cliente general')}</p><p class="text-xs text-gray-400 truncate">${escHtml(c ? (c.cedula || c.rif || '') : '')}</p></div>
                <div class="rounded-xl bg-gray-50 dark:bg-white/5 p-3"><p class="text-xs text-gray-400">Vendedor</p><p class="font-semibold truncate">${escHtml(sl ? sl.name : 'Sin vendedor')}</p><p class="text-xs text-gray-400">Tasa ${escHtml(s.rateType || '')} ${fmtMoney(s.rate)}</p></div>
            </div>
            <div><p class="text-sm font-semibold mb-1">Productos</p><ul class="divide-y dark:divide-gray-800">${items}</ul></div>
            <div><p class="text-sm font-semibold mb-1">Pagos</p><ul>${pays}</ul></div>
            ${feeOf(s) ? `<p class="flex justify-between text-sm"><span><i class="fas fa-motorcycle text-brand mr-1"></i>${escHtml(s.delivery.label || 'Delivery')}</span><b class="tabular-nums">${money(feeOf(s))}</b></p>` : ''}
            <div class="rounded-2xl p-4 text-white" style="background:linear-gradient(90deg, rgb(var(--brand-dark)), rgb(var(--brand)))">
                <div class="flex justify-between items-center"><span class="text-sm opacity-80">Total</span><span class="text-2xl font-bold tabular-nums ${cancelled ? 'line-through opacity-70' : ''}">${money(s.total)}</span></div>
                <p class="text-right text-xs opacity-80">${fmtBs(s.total * (s.rate || 0))}</p>
                ${profit != null ? `<p class="admin-only flex justify-between text-sm mt-2 pt-2 border-t border-white/20"><span class="opacity-80">Costo ${money(s.costTotal)}</span><b>Ganancia ${money(profit)}</b></p>` : ''}
            </div>
            <div class="rounded-xl border border-gray-100 dark:border-white/10 p-3 flex flex-wrap items-center gap-3">
                <div class="min-w-0 flex-1 text-sm">${s.emailedAt
                    ? `<p class="font-semibold text-emerald-600"><i class="fas fa-circle-check mr-1"></i>Enviada por correo</p><p class="text-xs text-gray-400 truncate">${escHtml(s.emailedTo || '')} · ${new Date(s.emailedAt).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>`
                    : customerEmailOf(s) ? `<p class="font-semibold">Aún no se ha enviado</p><p class="text-xs text-gray-400 truncate">${escHtml(customerEmailOf(s))}</p>` : '<p class="font-semibold">El cliente no tiene correo</p><p class="text-xs text-gray-400">Agréguelo en Clientes para poder enviarla</p>'}</div>
                <button onclick="emailInvoice('${s.id}')" ${customerEmailOf(s) ? '' : 'disabled'} class="btn-ghost disabled:opacity-40"><i class="fas fa-envelope"></i> ${s.emailedAt ? 'Reenviar' : 'Enviar'}</button>
                <button onclick="shareInvoice('${s.id}')" class="btn-ghost"><i class="fab fa-whatsapp"></i> Compartir</button>
            </div>
            <div class="flex flex-wrap gap-2">
                <button onclick="reprint('${s.id}', true)" class="btn-primary flex-1 justify-center"><i class="fas fa-file-pdf"></i> PDF</button>
                <button onclick="reprint('${s.id}', false)" class="btn-ghost flex-1 justify-center"><i class="fas fa-print"></i> Imprimir</button>
                ${cancelled
                    ? `<button onclick="closeModal('modal-sale'); deleteSale('${s.id}')" class="admin-only btn-ghost !text-red-500 hover:!border-red-400 flex-1 justify-center"><i class="fas fa-trash"></i> Eliminar</button>`
                    : `<button onclick="closeModal('modal-sale'); openCancelSale('${s.id}')" class="admin-only btn-ghost !text-red-500 hover:!border-red-400 flex-1 justify-center"><i class="fas fa-ban"></i> Anular</button>`}
            </div>
        </div>`;
    openModal('modal-sale');
}

// Atajo: inventario filtrado por stock bajo
let invFilter = 'todos';
function showLowStock() {
    invFilter = 'bajo';
    showSection('inventory');
}

// REVENTA: EQUIPOS
let resaleFilter = 'disponible';
function setResaleFilter(f) { resaleFilter = f; renderResaleItems(); }

function renderResaleItems() {
    document.querySelectorAll('#resale-filter button').forEach(b => {
        const on = b.dataset.f === resaleFilter;
        b.className = 'px-4 py-1.5 rounded-full text-sm font-semibold border transition ' + (on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-900 text-gray-500 dark:border-gray-700');
    });
    const tbody = document.getElementById('resale-table-body');
    bindSeg('resale-cond', 'c', resaleCond, (c) => { resaleCond = c; renderResaleItems(); });
    const pend = resale.filter(r => r.pendingPrice && r.stock > 0);
    document.getElementById('resale-pending-banner').innerHTML = pend.length ? `<div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 text-sm">
        <p><i class="fab fa-apple text-sky-600 mr-1"></i><b>${pend.length} equipo(s) recibido(s) como parte de pago</b> esperan que confirme el precio de venta.</p>
        <button onclick="editResale(${pend[0].id})" class="px-3 py-1.5 rounded-lg bg-sky-600 text-white font-semibold">Definir precio</button></div>` : '';
    const rq = (document.getElementById('resale-search')?.value || '').toLowerCase().trim();
    const list = resale.filter(r => (resaleFilter === 'todos' || (resaleFilter === 'disponible' ? r.stock > 0 : r.stock <= 0)) && condMatch(resaleCond, r) && (!rq || [r.brand, r.name, r.color, r.serial, r.supplier].join(' ').toLowerCase().includes(rq)));
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-500">${resale.length ? 'No hay equipos en este filtro' : 'Aún no hay equipos de reventa. Use "Nuevo equipo" para registrar uno conseguido por fuera.'}</td></tr>`;
        return;
    }
    tbody.innerHTML = [...list].reverse().map(r => {
        const profit = r.price - r.cost;
        const margin = r.price > 0 ? (profit / r.price) * 100 : 0;
        return `
        <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition">
            <td class="p-4"><p class="font-bold">${[r.brand, r.name].filter(Boolean).join(' ')} ${condBadge(condOf(r))}${r.pendingPrice ? ' <span class="cond-badge sellado"><i class="fas fa-tag"></i>Definir precio</span>' : ''}</p><p class="text-xs text-gray-400">${[r.color, r.serial ? 'S/N ' + r.serial : '', r.acquiredAt].filter(Boolean).join(' · ')}</p></td>
            <td class="p-4 text-sm">${r.supplier || '—'}</td>
            <td class="p-4">${appCurrency}${Number(r.cost).toFixed(2)}</td>
            <td class="p-4 font-semibold">${appCurrency}${Number(r.price).toFixed(2)}</td>
            <td class="p-4"><span class="font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-500'}">${appCurrency}${profit.toFixed(2)}</span><p class="text-[11px] text-gray-400">${margin.toFixed(0)}%</p></td>
            <td class="p-4">${r.stock > 0 ? `<span class="px-2 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Disponible · ${r.stock}</span>` : '<span class="px-2 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500 dark:bg-white/10">Vendido</span>'}</td>
            <td class="p-4"><div class="flex justify-center gap-3">
                ${r.stock > 0 ? `<button onclick="sellResale(${r.id})" class="text-emerald-600 hover:text-emerald-800 font-semibold text-sm" title="Vender"><i class="fas fa-cash-register"></i></button>` : ''}
                <button onclick="editResale(${r.id})" class="text-blue-500 hover:text-blue-700" title="Editar"><i class="fas fa-edit"></i></button>
                <button onclick="deleteItem('resale', ${r.id}, renderResaleItems)" class="text-red-500 hover:text-red-700" title="Eliminar"><i class="fas fa-trash"></i></button>
            </div></td>
        </tr>`;
    }).join('');
}

function openResaleModal(id, thenCart) {
    document.getElementById('resale-brand-list').innerHTML = [...new Set([...brands.map(b => b.name), ...resale.map(r => r.brand).filter(Boolean)])].map(n => `<option value="${n}">`).join('');
    document.getElementById('resale-modal-title').innerText = id ? 'Editar equipo de reventa' : (thenCart ? 'Equipo por encargo' : 'Nuevo equipo de reventa');
    document.getElementById('resale-then-cart').value = thenCart ? '1' : '';
    openModal('modal-resale');
    if (!id) setCondPick('resale-condition', 'usado');
}

function editResale(id) {
    const r = resale.find(x => x.id == id);
    if (!r) return;
    openResaleModal(id);
    const set = (k, v) => document.getElementById('resale-' + k).value = v ?? '';
    set('id', r.id); set('brand', r.brand); set('name', r.name); set('color', r.color); set('serial', r.serial);
    set('supplier', r.supplier); set('cost', r.cost); set('price', r.price); set('stock', r.stock); set('notes', r.notes);
    setCondPick('resale-condition', condOf(r) || 'usado');
    updateResaleProfitHint();
    if (r.pendingPrice) suggestPrice();
}

function updateResaleProfitHint() {
    const c = parseFloat(document.getElementById('resale-cost').value), p = parseFloat(document.getElementById('resale-price').value);
    const el = document.getElementById('resale-profit-hint');
    if (!(c >= 0) || !(p >= 0) || isNaN(c) || isNaN(p)) { el.innerText = ''; return; }
    const g = p - c;
    el.className = 'text-sm font-semibold ' + (g >= 0 ? 'text-emerald-600' : 'text-red-500');
    el.innerText = `Ganancia por equipo: ${appCurrency}${g.toFixed(2)}${p > 0 ? ` (${((g / p) * 100).toFixed(0)}%)` : ''}`;
}

document.getElementById('form-resale').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('resale-id').value;
    const v = (k) => document.getElementById('resale-' + k).value.trim();
    const prev = id ? resale.find(x => x.id == id) : null;
    const item = {
        ...(prev ? { tradeInSale: prev.tradeInSale, appleId: prev.appleId, battery: prev.battery } : {}),
        id: id ? parseInt(id) : Date.now(),
        brand: v('brand'), name: v('name'), color: v('color'), serial: v('serial'), supplier: v('supplier'),
        cost: parseFloat(v('cost')) || 0, price: parseFloat(v('price')) || 0, stock: parseInt(v('stock')) || 0,
        notes: v('notes'), acquiredAt: prev ? prev.acquiredAt : new Date().toLocaleDateString('es-VE'),
        condition: v('condition') || 'usado',
    };
    if (item.price < item.cost && !confirm('El precio de venta es menor que el costo (pérdida). ¿Guardar de todos modos?')) return;
    const thenCart = document.getElementById('resale-then-cart').value === '1';
    if (prev) resale[resale.findIndex(x => x.id == id)] = item; else resale.push(item);
    closeModal('modal-resale');
    await save();
    renderResaleItems(); renderResaleDashboard();
    if (thenCart) { setMode('reventa', { keepCart: true, section: 'pos' }); addToCart(item.id); }
    else if (currentSection === 'pos') renderPOS();
};

// ASISTENTE DE PRECIOS (reventa)
// 1) Con el historial propio: margen de equipos parecidos y de la misma condición.
// 2) Con IA (opcional): consulta precios de mercado en internet.
const DEFAULT_MARKUP = { sellado: 0.12, usado: 0.20 };
const normModel = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function modelTokens(t) { return normModel(t).split(' ').filter(w => w.length > 1 && !['gb', 'de', 'con', 'usado', 'sellado', 'nuevo'].includes(w)); }
function similarity(a, b) {
    const A = new Set(modelTokens(a)), B = new Set(modelTokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(w => { if (B.has(w)) inter++; });
    return inter / Math.max(A.size, B.size);
}
const roundPrice = (v) => v >= 100 ? Math.ceil(v / 5) * 5 : Math.ceil(v);

function readAssistantForm() {
    const v = (k) => (document.getElementById('resale-' + k)?.value || '').trim();
    return { id: v('id'), brand: v('brand'), name: v('name'), color: v('color'), condition: v('condition') || 'usado', cost: parseFloat(v('cost')) || 0 };
}

function clearPriceAssistant() {
    const body = document.getElementById('price-assistant-body');
    if (body) body.innerHTML = 'Escriba el modelo, la condición y el costo; el asistente le propone el precio de venta y el margen.';
}

function suggestPrice() {
    const f = readAssistantForm();
    const body = document.getElementById('price-assistant-body');
    if (!f.name || !(f.cost > 0)) { body.innerHTML = '<span class="text-amber-600">Escriba el modelo y el costo primero.</span>'; return; }
    const full = `${f.brand} ${f.name}`;
    const pool = resale.filter(r => String(r.id) !== f.id && r.cost > 0 && r.price > 0);
    const sameCond = pool.filter(r => (condOf(r) || 'usado') === f.condition);
    const similar = sameCond.map(r => ({ r, sim: similarity(full, `${r.brand} ${r.name}`) })).filter(x => x.sim >= 0.6).sort((a, b) => b.sim - a.sim);
    const markupOf = (r) => (r.price - r.cost) / r.cost;
    const avg = (l) => l.reduce((a, b) => a + b, 0) / l.length;
    let markup, basis;
    if (similar.length) {
        markup = avg(similar.slice(0, 5).map(x => markupOf(x.r)));
        basis = `${similar.length} equipo(s) parecido(s) ${COND_LABEL[f.condition].toLowerCase()}(s) que ya registró`;
    } else if (sameCond.length >= 3) {
        markup = avg(sameCond.map(markupOf));
        basis = `el margen promedio de sus ${sameCond.length} equipos ${COND_LABEL[f.condition].toLowerCase()}s`;
    } else {
        markup = DEFAULT_MARKUP[f.condition];
        basis = `un margen de referencia para equipos ${COND_LABEL[f.condition].toLowerCase()}s (aún no hay historial suficiente)`;
    }
    markup = Math.min(Math.max(markup, 0.04), 0.6);
    const opts = [
        { name: 'Venta rápida', m: markup * 0.6, note: 'Para rotarlo pronto' },
        { name: 'Recomendado', m: markup, note: 'Equilibrio entre precio y rapidez' },
        { name: 'Máximo', m: markup * 1.4, note: 'Si el cliente no tiene apuro' },
    ].map(o => { const price = roundPrice(f.cost * (1 + o.m)); return { ...o, price, gain: price - f.cost, margin: (price - f.cost) / price }; });
    const ref = similar[0] ? `<p class="text-xs text-gray-500 mt-2">Referencia: ${escHtml([similar[0].r.brand, similar[0].r.name].filter(Boolean).join(' '))} costó ${money(similar[0].r.cost)} y se puso en ${money(similar[0].r.price)}.</p>` : '';
    body.innerHTML = `<p class="text-xs text-gray-500 mb-2">Basado en ${basis}.</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">${opts.map((o, i) => `
            <button type="button" onclick="applySuggestedPrice(${o.price}, this)" class="sugg ${i === 1 ? 'on' : ''}">
                <span class="block text-xs text-gray-500">${o.name}</span>
                <span class="block text-lg font-bold tabular-nums">${money(o.price)}</span>
                <span class="block text-xs font-semibold text-emerald-600">+${money(o.gain)} · ${(o.margin * 100).toFixed(0)}% margen</span>
                <span class="block text-[11px] text-gray-400">${o.note}</span>
            </button>`).join('')}</div>${ref}
        <p class="text-[11px] text-gray-400 mt-2">Toque una opción para usar ese precio.</p>`;
    if (!document.getElementById('resale-price').value) applySuggestedPrice(opts[1].price);
}

function applySuggestedPrice(price, btn) {
    document.getElementById('resale-price').value = price;
    updateResaleProfitHint();
    if (btn) { btn.parentElement.querySelectorAll('.sugg').forEach(b => b.classList.remove('on')); btn.classList.add('on'); }
}

async function askPriceAI() {
    const f = readAssistantForm();
    const body = document.getElementById('price-assistant-body');
    if (!f.name || !(f.cost > 0)) { body.innerHTML = '<span class="text-amber-600">Escriba el modelo y el costo primero.</span>'; return; }
    if (!navigator.onLine) { body.innerHTML = '<span class="text-amber-600">La consulta a la IA necesita internet. Use "Sugerir con mi historial".</span>'; return; }
    // Ahorro: la misma consulta (modelo + condición) se reutiliza por 3 días sin volver a pagar a la IA
    const cacheKey = 'ns_ai_' + normModel(`${f.brand} ${f.name} ${f.condition}`);
    let cached = null;
    try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (c && Date.now() - c.at < 3 * 864e5) cached = c.r; } catch { /* sin caché */ }
    body.innerHTML = '<p class="flex items-center gap-2"><i class="fas fa-circle-notch fa-spin text-emerald-600"></i> Buscando precios de mercado… puede tardar unos segundos.</p>';
    const history = resale.filter(r => r.cost > 0 && r.price > 0).slice(-6).map(r => ({ modelo: [r.brand, r.name].filter(Boolean).join(' '), condicion: condOf(r) || 'usado', costo: r.cost, precio: r.price, vendido: r.stock <= 0 }));
    try {
        const r = cached || await askPriceAssistant({ brand: f.brand, name: f.name, color: f.color, condition: f.condition, cost: f.cost, currency: appCurrency, history });
        if (!cached) { try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), r })); } catch { /* sin almacenamiento */ } }
        const gain = r.precio - f.cost;
        const sources = (r.fuentes || []).slice(0, 3).map(x => `<a href="${escHtml(x.url)}" target="_blank" rel="noopener" class="underline hover:text-emerald-600">${escHtml(x.title || x.url)}</a>`).join(' · ');
        body.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button type="button" onclick="applySuggestedPrice(${roundPrice(r.minimo || r.precio)}, this)" class="sugg"><span class="block text-xs text-gray-500">Mínimo sugerido</span><span class="block text-lg font-bold tabular-nums">${money(roundPrice(r.minimo || r.precio))}</span></button>
                <button type="button" onclick="applySuggestedPrice(${roundPrice(r.precio)}, this)" class="sugg on"><span class="block text-xs text-gray-500">Precio sugerido por IA</span><span class="block text-lg font-bold tabular-nums">${money(roundPrice(r.precio))}</span><span class="block text-xs font-semibold ${gain >= 0 ? 'text-emerald-600' : 'text-red-500'}">${gain >= 0 ? '+' : ''}${money(gain)} · ${r.precio > 0 ? ((gain / r.precio) * 100).toFixed(0) : 0}% margen</span></button>
                <button type="button" onclick="applySuggestedPrice(${roundPrice(r.maximo || r.precio)}, this)" class="sugg"><span class="block text-xs text-gray-500">Máximo de mercado</span><span class="block text-lg font-bold tabular-nums">${money(roundPrice(r.maximo || r.precio))}</span></button>
            </div>
            <p class="mt-2">${escHtml(r.explicacion || '')}</p>
            ${sources ? `<p class="text-[11px] text-gray-400 mt-1">Fuentes: ${sources}</p>` : ''}
            <p class="text-[11px] text-gray-400 mt-1">Es una sugerencia: confirme el precio antes de publicarlo.</p>`;
        if (!document.getElementById('resale-price').value) applySuggestedPrice(roundPrice(r.precio));
    } catch (err) {
        body.innerHTML = `<p class="text-amber-700 dark:text-amber-300">${escHtml(err.message)}</p><p class="text-xs text-gray-500 mt-1">Mientras tanto puede usar "Sugerir con mi historial".</p>`;
    }
}

function sellResale(id) {
    setMode('reventa', { section: 'pos' });
    addToCart(id);
}

// REVENTA: VENTAS
function resaleProfit(s) { return s.total - feeOf(s) - (Number(s.costTotal) || 0); }

function renderResaleSales() {
    const tbody = document.getElementById('resale-sales-table-body');
    const all = sales.filter(isResaleSale);
    const q = (document.getElementById('rsales-search').value || '').toLowerCase().trim();
    const r = periodRangeOf(rsalesPeriod, all);
    bindPeriod('rsales-period', rsalesPeriod, r, (st) => { rsalesPeriod = st; savePeriod('ns_rsales_period', st); renderResaleSales(); });
    const list = all.filter(s => (r.all || inRange(s, r)) && matchSale(s, q));
    const act = list.filter(s => s.status !== 'cancelada');
    const tot = act.reduce((a, s) => a + s.total, 0), cost = act.reduce((a, s) => a + (Number(s.costTotal) || 0), 0);
    document.getElementById('resale-sales-summary').innerHTML = [['Vendido', money(tot), ''], ['Costo', money(cost), ''], ['Ganancia', money(tot - cost), 'text-emerald-600']]
        .map(([l, v, c]) => `<div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4"><p class="text-xs text-gray-400">${l}</p><p class="text-lg md:text-xl font-bold tabular-nums ${c}">${v}</p></div>`).join('');
    if (!all.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-10 text-center text-gray-500">Aún no hay ventas de reventa. <button onclick="setMode(\'reventa\',{section:\'pos\'})" class="text-emerald-600 font-semibold hover:underline">Vender un equipo</button></td></tr>';
        return;
    }
    tbody.innerHTML = list.length ? salesTableRows(list, true) : '<tr><td colspan="7" class="p-10 text-center text-gray-500">Ninguna venta coincide con la búsqueda o el período.</td></tr>';
    showSalesView('rsales', rsalesView, list, periodTitle(rsalesPeriod, r), () => renderResaleSales(), (v) => { rsalesView = v; renderResaleSales(); });
}

let rsPeriod = loadPeriod('ns_rs_period', '30');
function renderResaleDashboard() {
    const allAct = sales.filter(s => isResaleSale(s) && s.status !== 'cancelada');
    const r = periodRangeOf(rsPeriod, allAct);
    bindPeriod('rs-period', rsPeriod, r, (st) => { rsPeriod = st; savePeriod('ns_rs_period', st); renderResaleDashboard(); });
    const active = allAct.filter(s => inRange(s, r));
    const tot = active.reduce((a, s) => a + s.total, 0), cost = active.reduce((a, s) => a + (Number(s.costTotal) || 0), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set('rs-total', money(tot));
    set('rs-cost', money(cost));
    set('rs-profit', money(tot - cost));
    set('rs-margin', tot > 0 ? `${(((tot - cost) / tot) * 100).toFixed(1)}%` : '0%');
    const avail = resale.filter(r => r.stock > 0);
    set('rs-available', avail.reduce((a, r) => a + r.stock, 0));
    set('rs-capital', money(avail.reduce((a, r) => a + r.stock * r.cost, 0)));
    set('rs-expected', money(avail.reduce((a, r) => a + r.stock * (r.price - r.cost), 0)));
    const bk = buckets(r);
    const sold = bk.map(b => active.filter(s => inRange(s, b)).reduce((a, s) => a + s.total, 0));
    const gain = bk.map(b => active.filter(s => inRange(s, b)).reduce((a, s) => a + resaleProfit(s), 0));
    set('rs-chart-sub', `${periodTitle(rsPeriod, r)} · ganancia ${money(tot - cost)}`);
    const recentEl = document.getElementById('rs-recent');
    if (recentEl) recentEl.innerHTML = active.length ? [...active].sort((a, b) => (saleTime(b) || 0) - (saleTime(a) || 0)).slice(0, 6).map(saleRowHtml).join('') : '<li class="text-sm text-gray-400 text-center py-8">Sin ventas de reventa en este período</li>';
    const availEl = document.getElementById('rs-avail-list');
    if (availEl) availEl.innerHTML = avail.length ? [...avail].sort((a, b) => (b.price - b.cost) - (a.price - a.cost)).slice(0, 6).map(it => `
        <li><button onclick="sellResale(${it.id})" class="w-full flex items-center gap-3 rounded-xl px-2 py-2 -mx-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition">
            <span class="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center justify-center shrink-0"><i class="fas fa-mobile-screen text-xs"></i></span>
            <span class="min-w-0 flex-1"><span class="block text-sm font-semibold truncate">${escHtml([it.brand, it.name].filter(Boolean).join(' '))}</span><span class="block text-[11px] text-gray-400 truncate">${escHtml(it.supplier || 'Sin proveedor')} · costo ${money(it.cost)}</span></span>
            <span class="text-right shrink-0"><span class="block text-sm font-bold tabular-nums">${money(it.price)}</span><span class="block text-[11px] font-semibold text-emerald-600">+${money(it.price - it.cost)}</span></span>
        </button></li>`).join('') : '<li class="text-sm text-gray-400 text-center py-8">No hay equipos disponibles. <button onclick="openResaleModal()" class="text-emerald-600 font-semibold hover:underline">Registrar uno</button></li>';
    const el = document.getElementById('rs-area');
    if (el && !el.closest('section').classList.contains('hidden')) mountAreaChart(el, {
        labels: bk.map(b => b.label),
        series: [{ name: 'Vendido', values: sold, color: 'var(--chart)' }, { name: 'Ganancia', values: gain, color: '16 185 129' }],
        format: shortMoney,
        tipFormat: money,
        ariaLabel: 'Ventas y ganancia de reventa',
        onSelect: (i) => openSalesList(bk[i].title, active.filter(s => inRange(s, bk[i]))),
    });
}

// LOGO Y COLORES DE LA TIENDA
let logoDraft = null;
function openLogoModal(fromLogin) {
    if (!isAdmin()) return;
    logoDraft = null;
    document.getElementById('logo-file').value = '';
    document.getElementById('logo-preview').classList.add('hidden');
    document.getElementById('logo-drop-hint').classList.remove('hidden');
    document.getElementById('logo-warning').classList.add('hidden');
    document.getElementById('logo-colors-wrap').classList.add('hidden');
    document.getElementById('logo-save').disabled = true;
    document.getElementById('modal-logo').dataset.fromLogin = fromLogin ? '1' : '';
    document.getElementById('modal-logo').classList.remove('hidden');
}

function closeLogoModal(saved) {
    document.getElementById('modal-logo').classList.add('hidden');
    if (!saved) {
        applyPalette(brandColor || DEFAULT_COLOR);
        applyLogo(brandLogo);
        if (document.getElementById('modal-logo').dataset.fromLogin) sessionStorage.setItem('ns_logo_later', '1');
    }
}

async function onLogoFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const warn = document.getElementById('logo-warning');
    warn.classList.add('hidden');
    if (file.type !== 'image/png') {
        warn.innerText = 'El archivo debe ser PNG (idealmente con fondo transparente).';
        warn.classList.remove('hidden');
        return;
    }
    try {
        const img = await loadImageFile(file);
        const info = analyzeLogo(img);
        logoDraft = { logo: info.dataUrl, color: info.colors[0] || brandColor || DEFAULT_COLOR };
        const prev = document.getElementById('logo-preview');
        prev.src = info.dataUrl;
        prev.classList.remove('hidden');
        document.getElementById('logo-drop-hint').classList.add('hidden');
        const notes = [];
        if (!info.transparent) notes.push('La imagen no tiene fondo transparente; se verá con su fondo. Para mejor resultado use un PNG sin fondo.');
        if (!info.colors.length) notes.push('El logo es blanco/negro o gris: se mantiene la paleta actual. Puede elegir un color abajo.');
        if (notes.length) { warn.innerText = notes.join(' '); warn.classList.remove('hidden'); }
        const choices = [...new Set([...info.colors, brandColor || DEFAULT_COLOR, DEFAULT_COLOR])];
        document.getElementById('logo-colors').innerHTML = choices.map(c => `
            <button type="button" onclick="pickLogoColor('${c}')" data-c="${c}" class="logo-color w-11 h-11 rounded-xl border-2 border-transparent shadow transition" style="background:${c}" title="${c}"></button>`).join('') +
            `<label class="w-11 h-11 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer text-gray-400" title="Otro color"><i class="fas fa-eye-dropper"></i><input type="color" class="hidden" onchange="pickLogoColor(this.value)"></label>`;
        document.getElementById('logo-colors-wrap').classList.remove('hidden');
        pickLogoColor(logoDraft.color);
        applyLogo(info.dataUrl);
        document.getElementById('logo-save').disabled = false;
    } catch (err) {
        warn.innerText = err.message;
        warn.classList.remove('hidden');
    }
}

function pickLogoColor(c) {
    const color = normalizeBrand(c);
    if (logoDraft) logoDraft.color = color;
    applyPalette(color);
    document.querySelectorAll('.logo-color').forEach(b => {
        const on = b.dataset.c.toUpperCase() === color.toUpperCase() || b.dataset.c.toUpperCase() === String(c).toUpperCase();
        b.style.borderColor = on ? 'currentColor' : 'transparent';
        b.style.transform = on ? 'scale(1.12)' : '';
    });
}

async function saveLogoModal() {
    if (!logoDraft) return;
    const btn = document.getElementById('logo-save');
    btn.disabled = true;
    try {
        await saveSetting('brand_logo', logoDraft.logo);
        await saveSetting('brand_logo_at', String(Date.now()));
        await saveSetting('brand_color', logoDraft.color);
        brandLogo = logoDraft.logo; brandColor = logoDraft.color;
        cacheBrand(brandColor, brandLogo);
        closeLogoModal(true);
        refreshAllViews();
    } catch (err) {
        alert('No se pudo guardar el logo: ' + err.message);
        btn.disabled = false;
    }
}

async function saveBrandColor(c) {
    const color = normalizeBrand(c);
    try {
        await saveSetting('brand_color', color);
        brandColor = color;
        applyPalette(color);
        cacheBrand(brandColor, brandLogo);
        if (color.toUpperCase() !== String(c).toUpperCase()) alert('El color se oscureció un poco para que el texto blanco se lea bien: ' + color);
        refreshAllViews();
    } catch (err) { alert('No se pudo guardar: ' + err.message); }
}

async function resetBrand() {
    if (!confirm('¿Volver al logo y colores originales del sistema?')) return;
    try {
        await saveSetting('brand_logo', '');
        await saveSetting('brand_logo_at', String(Date.now()));
        await saveSetting('brand_color', '');
        brandLogo = ''; brandColor = '';
        applyPalette(DEFAULT_COLOR); applyLogo('');
        cacheBrand('', '');
        refreshAllViews();
    } catch (err) { alert('No se pudo restaurar: ' + err.message); }
}

function deleteItem(arrayName, id, callback) {
    if(confirm('¿Eliminar registro permanentemente?')) {
        if(arrayName === 'products') products = products.filter(x => x.id != id);
        if(arrayName === 'brands') brands = brands.filter(x => x.id != id);
        if(arrayName === 'customers') customers = customers.filter(x => x.id != id);
        if(arrayName === 'sellers') sellers = sellers.filter(x => x.id != id);
        if(arrayName === 'payments') payments = payments.filter(x => x.id != id);
        if(arrayName === 'resale') resale = resale.filter(x => x.id != id);
        save();
        callback();
    }
}

let syncChain = Promise.resolve();
function save() {
    const state = { brands, products, customers, sellers, payments, resale, sales };
    persistLocal(state);
    syncChain = syncChain.then(() => syncTables(state)).catch(async err => {
        alert('No se pudo guardar en la nube: ' + err.message + '\nSe recargarán los datos.');
        await reloadData();
        refreshAllViews();
    });
    return syncChain;
}

async function reloadData() {
    const d = await fetchAll();
    products = d.products; brands = d.brands; customers = d.customers;
    sellers = d.sellers; payments = d.payments; sales = d.sales; resale = d.resale;
    autoEmail = d.autoEmail; syncAutoEmailToggle();
    document.querySelectorAll('.resale-not-ready').forEach(el => el.classList.toggle('hidden', d.resaleReady));
    if (d.brandColor !== brandColor || d.brandLogo !== brandLogo) {
        brandColor = d.brandColor; brandLogo = d.brandLogo;
        applyPalette(brandColor || DEFAULT_COLOR);
        applyLogo(brandLogo);
        cacheBrand(brandColor, brandLogo);
    }
    const colorInput = document.getElementById('config-brand-color');
    if (colorInput) colorInput.value = (brandColor || DEFAULT_COLOR).toLowerCase();
    appCurrency = d.appCurrency; globalRate = d.globalRate;
    bcvRate = d.bcvRate; binanceRate = d.binanceRate; rateDate = d.rateDate;
    salesGoal = Number(d.salesGoal) || 0;
    const goalIn = document.getElementById('config-goal'); if (goalIn) goalIn.value = salesGoal || '';
    syncRateInputs();
    document.getElementById('config-currency').value = appCurrency;
    document.getElementById('config-rate').value = globalRate;
}

// Sólo se redibuja la pantalla visible; las demás se dibujan al abrirlas (showSection)
const SECTION_RENDER = {
    dashboard: () => updateDashboard(), brands: () => renderBrands(), inventory: () => renderInventory(), pos: () => renderPOS(),
    customers: () => renderCustomers(), sellers: () => renderSellers(), payments: () => renderPayments(), sales: () => renderSales(),
    'resale-items': () => renderResaleItems(), 'resale-sales': () => renderResaleSales(), 'resale-dashboard': () => renderResaleDashboard(),
};
let refreshQueued = false;
function refreshAllViews() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
        refreshQueued = false;
        for (const f of [SECTION_RENDER[currentSection], renderCart]) { try { f && f(); } catch (e) { console.error(e); } }
    });
}

// USUARIOS Y AUDITORÍA (sólo admin)
async function renderUsersAdmin() {
    const tbody = document.getElementById('users-table-body');
    try {
        const users = await listProfiles();
        tbody.innerHTML = users.map(u => `
            <tr class="border-t dark:border-gray-800">
                <td class="p-2"><p class="font-semibold">${clean(u.full_name || '')}</p><p class="text-xs text-gray-400">${clean(u.email || '')}</p></td>
                <td class="p-2"><select onchange="updateUser('${u.id}', {role: this.value})" class="p-1 border rounded-lg dark:bg-gray-800 dark:border-gray-700" ${u.id === currentProfile.id ? 'disabled' : ''}>
                    <option value="vendedor" ${u.role === 'vendedor' ? 'selected' : ''}>Vendedor</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option></select></td>
                <td class="p-2"><select onchange="updateUser('${u.id}', {seller_id: this.value ? Number(this.value) : null})" class="p-1 border rounded-lg dark:bg-gray-800 dark:border-gray-700">
                    <option value="">—</option>${sellers.map(sl => `<option value="${sl.id}" ${u.seller_id == sl.id ? 'selected' : ''}>${sl.name}</option>`).join('')}</select></td>
                <td class="p-2">${u.id === currentProfile.id ? '<span class="text-green-600 font-bold text-xs">Usted</span>' :
                    `<button onclick="updateUser('${u.id}', {active: ${!u.active}})" class="px-3 py-1 rounded-full text-xs font-bold ${u.active ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">${u.active ? 'Activo' : 'Pendiente · Activar'}</button>`}</td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-2 text-red-500">${clean(err.message)}</td></tr>`;
    }
}

async function updateUser(id, patch) {
    if (patch.active === false && !confirm('¿Desactivar este usuario? Ya no podrá entrar al sistema.')) return renderUsersAdmin();
    try { await updateProfile(id, patch); } catch (err) { alert('No se pudo actualizar: ' + err.message); }
    renderUsersAdmin();
}

const AUDIT_LABELS = { insert: 'Creó', update: 'Modificó', delete: 'Eliminó', create_sale: 'Registró venta', cancel_sale: 'Anuló venta', delete_sale: 'Eliminó venta' };
async function renderAudit() {
    const tbody = document.getElementById('audit-table-body');
    try {
        const rows = await listAudit(150);
        tbody.innerHTML = rows.map(r => `
            <tr class="border-t dark:border-gray-800">
                <td class="p-2 whitespace-nowrap">${new Date(r.at).toLocaleString('es-VE')}</td>
                <td class="p-2">${clean(r.user_email || '—')}</td>
                <td class="p-2 font-semibold">${AUDIT_LABELS[r.action] || clean(r.action)}${r.details && r.details.reason ? `<p class="text-red-500 font-normal">Motivo: ${clean(r.details.reason)}</p>` : ''}</td>
                <td class="p-2">${clean(r.entity || '')} ${clean(r.entity_id || '')}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="p-2 text-gray-400">Sin registros</td></tr>';
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-2 text-red-500">${clean(err.message)}</td></tr>`;
    }
}

function exportData() {
    const data = { products, brands, customers, sellers, payments, sales, resale, appCurrency, globalRate, bcvRate, binanceRate, rateType, rateDate };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup_dgttecnology_${new Date().toLocaleDateString()}.json`;
    a.click();
}

// IMPORTAR / RECUPERAR VENTAS ANTERIORES
// Sólo agrega lo que falta en la nube: nunca reemplaza el stock, clientes ni ventas que ya existen.
function missingOnly(incoming, current) {
    const have = new Set((current || []).map(x => String(x.id)));
    return (Array.isArray(incoming) ? incoming : []).filter(x => x && x.id != null && !have.has(String(x.id)));
}

function buildMerge(data) {
    const add = {
        brands: missingOnly(data.brands, brands),
        products: missingOnly(data.products, products),
        customers: missingOnly(data.customers, customers),
        sellers: missingOnly(data.sellers, sellers),
        payments: missingOnly(data.payments, payments),
        resale: missingOnly(data.resale, resale),
        sales: missingOnly(data.sales, sales).map(s => ({ ...s, channel: s.channel || 'tienda' })),
    };
    const count = Object.values(add).reduce((a, l) => a + l.length, 0);
    return { add, count };
}

function describeMerge(add) {
    const parts = [['sales', 'ventas'], ['customers', 'clientes'], ['products', 'productos'], ['brands', 'marcas'], ['sellers', 'vendedores'], ['payments', 'métodos de pago'], ['resale', 'equipos de reventa']]
        .filter(([k]) => add[k].length).map(([k, l]) => `${add[k].length} ${l}`);
    const total = add.sales.filter(s => s.status !== 'cancelada').reduce((a, s) => a + (Number(s.total) || 0), 0);
    return parts.join(', ') + (add.sales.length ? `\nTotal en ventas: ${money(total)}` : '');
}

async function mergeIntoCloud(add) {
    await importAll(add, { settings: false });
    await reloadData();
    refreshAllViews();
}

function importData(event) {
    if (!isAdmin()) return alert('Solo un administrador puede importar datos');
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let data;
        try { data = JSON.parse(e.target.result); } catch { return alert('El archivo no es un respaldo válido (.json)'); }
        const { add, count } = buildMerge(data);
        if (!count) return alert('Todo lo que trae ese respaldo ya está en el sistema. No hay nada nuevo que agregar.');
        if (!confirm(`Se agregarán al sistema:\n${describeMerge(add)}\n\nNo se modifica nada de lo que ya existe (stock, ventas ni clientes). ¿Continuar?`)) return;
        try {
            await mergeIntoCloud(add);
            alert('Datos importados con éxito.');
        } catch (err) { alert('Error al importar: ' + err.message); }
    };
    reader.readAsText(file);
}

// El sistema anterior (antes de la nube) guardaba todo en este navegador. Si quedan datos aquí, se ofrecen para subirlos.
function readLegacyLocal() {
    const out = {};
    const looks = {
        sales: (a) => a.some(x => x && Array.isArray(x.items) && 'total' in x),
        products: (a) => a.some(x => x && 'stock' in x && 'price' in x && !('cost' in x)),
        customers: (a) => a.some(x => x && ('cedula' in x || 'totalSpent' in x)),
        sellers: (a) => a.some(x => x && 'comm' in x),
    };
    const byName = { brands: 'ns_brands', payments: 'ns_payments' };
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!/^ns_/.test(key)) continue;
            let val;
            try { val = JSON.parse(localStorage.getItem(key)); } catch { continue; }
            if (!Array.isArray(val) || !val.length) continue;
            for (const [k, test] of Object.entries(looks)) if (!out[k] && test(val)) out[k] = val;
            for (const [k, name] of Object.entries(byName)) if (key === name) out[k] = val;
        }
    } catch { /* almacenamiento bloqueado */ }
    return out;
}

async function offerLegacyRecovery() {
    if (!isAdmin() || sessionStorage.getItem('ns_legacy_checked') === '1') return;
    sessionStorage.setItem('ns_legacy_checked', '1');
    const legacy = readLegacyLocal();
    if (!legacy.sales || !legacy.sales.length) return;
    const { add, count } = buildMerge(legacy);
    if (!count || !add.sales.length) return;
    if (!confirm(`Se encontraron datos del sistema anterior guardados en este navegador que no están en la nube:\n\n${describeMerge(add)}\n\n¿Desea recuperarlos ahora? (No se modifica nada de lo que ya existe)`)) return;
    try {
        await mergeIntoCloud(add);
        alert('Ventas anteriores recuperadas con éxito.');
    } catch (err) { alert('No se pudieron recuperar: ' + err.message); }
}

// ESTADO DE CONEXIÓN
function updateNetUI(st) {
    document.body.classList.toggle('is-offline', st.offline);
    const text = st.syncing ? 'Guardando cambios…'
        : st.offline ? `Modo sin conexión${st.pending ? ` · ${st.pending} pendiente(s)` : ''}`
        : st.pending ? `${st.pending} cambio(s) por guardar` : '';
    const cls = st.syncing ? 'text-sky-500' : st.offline ? 'text-amber-500' : 'text-amber-500';
    const icon = st.syncing ? 'fa-rotate fa-spin' : st.offline ? 'fa-wifi' : 'fa-cloud-arrow-up';
    for (const id of ['net-status', 'net-pill']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.classList.toggle('hidden', !text);
        el.dataset.state = st.syncing ? 'syncing' : st.offline ? 'offline' : 'pending';
        el.innerHTML = text ? `<i class="fas ${icon} ${st.offline && !st.syncing ? 'line-through' : ''}"></i> <span>${text}</span>` : '';
        if (id === 'net-status') el.className = `${text ? '' : 'hidden '}text-[11px] font-semibold flex items-center gap-1.5 mt-0.5 ${cls}`;
    }
}

let reconnecting = false;
async function syncAfterReconnect() {
    if (reconnecting || !navigator.onLine) return;
    reconnecting = true;
    try {
        const hadPending = netState().pending;
        const r = await flushOutbox();
        if (r.done) toast(`Listo: se guardaron en la nube ${r.done} cambio(s) hechos sin conexión.`, 'ok', 6000);
        if (r.conflicts.length) alert('Algunas ventas hechas sin conexión no se pudieron registrar:\n\n' + r.conflicts.map(c => `• ${c.op.sale ? c.op.sale.id : c.op.key}: ${c.error}`).join('\n') + '\n\nRevise el inventario y vuelva a registrarlas.');
        if (hadPending || r.done) { await reloadData(); refreshAllViews(); }
        await sendQueuedEmails();
    } catch (err) {
        console.error(err);
    } finally { reconnecting = false; }
}

// INITIALIZATION
async function startApp(profile) {
    currentProfile = profile;
    document.body.classList.add(profile.role === 'admin' ? 'role-admin' : 'role-vendedor');
    await reloadData();
    fetchLiveRates(false);
    document.getElementById('current-date').innerText = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    applyModeClasses();
    renderCart();
    const admin = profile.role === 'admin';
    showSection(appMode === 'reventa' ? (admin ? 'resale-dashboard' : 'pos') : (admin ? 'dashboard' : 'pos'));
    if (admin) { renderUsersAdmin(); renderAudit(); }
    // Al entrar, el administrador sin logo configurado recibe la invitación a subir el PNG
    if (admin) setTimeout(async () => {
        await offerLegacyRecovery();
        if (!brandLogo && sessionStorage.getItem('ns_logo_later') !== '1') openLogoModal(true);
    }, 600);
    subscribeChanges(() => syncChain.then(reloadData).then(refreshAllViews).catch(console.error));
    onNetChange(updateNetUI);
    window.addEventListener('online', () => setTimeout(syncAfterReconnect, 800));
    setInterval(() => { if (navigator.onLine && netState().pending) syncAfterReconnect(); }, 30000);
    if (navigator.onLine) sendQueuedEmails();
}

// Funciones usadas desde los atributos onclick/onchange del HTML
Object.assign(window, { setTheme, openMoreMenu, openUserMenu, setSalesGoal, editSalesGoal, exportPeriodCsv, openSellerSales, openClientSales, exportClientsCsv, openClientsFromDash, setClientQuery, setClientSort, selectBoardSale, openBoardAll, openMethodSales, openTradeIn, closeTradeIn, addTradeIn, tradeInSuggest, setDelivery, updateDeliveryFromInputs, renderCustomerCard, pickCondition, suggestPrice, applySuggestedPrice, askPriceAI, emailInvoice, shareInvoice, setAutoEmail, openSaleDetail, openSalesList, openProductSales, showLowStock, offerLegacyRecovery, closeLogoModal, editResale, isAdmin, onLogoFile, openLogoModal, openResaleModal, pickLogoColor, renderResaleDashboard, renderResaleItems, renderResaleSales, resetBrand, saveBrandColor, saveLogoModal, selectSaleChannel, sellResale, setMode, setResaleFilter, toggleNav, togglePassword, updateResaleProfitHint, addPaymentRow, addToCart, changeQty, closeModal, deleteItem, deleteSale, downloadPDF, duplicateProduct, editBrand, editCustomer, editPayment, editProduct, editSeller, executeFinalSale, exportData, fetchLiveRates, fillInvoice, filterPOS, fmtBs, fmtMoney, formatUSD, getInitials, getProductHistory, getRate, importData, onPayMethodChange, onSaleRateInput, openCancelSale, openModal, openPaymentModal, openVariantSelector, refreshAllViews, refreshSalesViews, reloadData, removePaymentRow, renderAudit, renderBrands, renderCart, renderCustomers, renderInventory, renderPOS, renderPayments, renderSales, renderSellers, renderUsersAdmin, reprint, resetModal, save, selectColor, selectRateType, setDailyRate, setupProductModal, showSection, startApp, syncRateInputs, toggleCustomerHistory, toggleCustomerInvoices, toggleDarkMode, updateCurrency, updateDashboard, updateRate, updateSettleBalance, updateUser })

export { startApp }

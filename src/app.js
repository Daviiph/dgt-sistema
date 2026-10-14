import html2pdf from 'html2pdf.js'
import { fetchAll, syncTables, saveSetting, createSale, cancelSale, deleteSaleRemote, importAll, listProfiles, updateProfile, listAudit, subscribeChanges, clean } from './data.js'

// STATE
let products = [], brands = [], customers = [], sellers = [], payments = [], sales = [];
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

// THEME
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('ns_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}
if (localStorage.getItem('ns_theme') === 'dark') document.documentElement.classList.add('dark');

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
function getRate(type) {
    return parseFloat(type === 'Binance P2P' ? binanceRate : bcvRate) || 0;
}
function setDailyRate(type, value) {
    const v = parseFloat(value);
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

// NAVIGATION
function showSection(sectionId) {
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`section-${sectionId}`).classList.remove('hidden');
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active-link'));
    document.getElementById(`link-${sectionId}`).classList.add('active-link');
    
    if(sectionId === 'dashboard') updateDashboard();
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
        document.getElementById('prod-id').value = '';
        document.getElementById('prod-color').value = '#000000';
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    }
    if(modalId === 'modal-customer') document.getElementById('cust-id').value = '';
    if(modalId === 'modal-seller') document.getElementById('sell-id').value = '';
    if(modalId === 'modal-payment') document.getElementById('pay-id').value = '';
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
        stock: parseInt(document.getElementById('prod-stock').value)
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
    
    document.getElementById('prod-color').value = p.color;
    document.querySelectorAll('.color-dot').forEach(d => {
        if(d.style.backgroundColor === p.color) d.classList.add('active');
        else d.classList.remove('active');
    });
    document.getElementById('prod-modal-title').innerText = "Editar Producto";
}

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    if(products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay productos en stock</td></tr>';
        return;
    }
    tbody.innerHTML = products.map(p => {
        const brand = brands.find(b => b.id == p.brandId);
        return `
            <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                <td class="p-4 font-bold text-brand">${brand ? brand.name : 'S/M'}</td>
                <td class="p-4">${p.name}</td>
                <td class="p-4"><div class="color-dot" style="background-color: ${p.color}; border: 1px solid #ccc"></div></td>
                <td class="p-4">${appCurrency}${p.price.toFixed(2)}</td>
                <td class="p-4"><span class="${p.stock < 5 ? 'text-red-500 font-bold' : ''}">${p.stock} u</span></td>
                <td class="p-4 text-center flex justify-center gap-3">
                    <button onclick="duplicateProduct(${p.id})" class="text-green-500 hover:text-green-700" title="Duplicar"><i class="fas fa-copy"></i></button>
                    <button onclick="editProduct(${p.id})" class="text-blue-500 hover:text-blue-700"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteItem('products', ${p.id}, renderInventory)" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
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
                map[key] = { name: `${b ? b.name + ' ' : ''}${i.name}`, color: i.color, colorName, qty: 0, total: 0, lastDate: sl.date };
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

    if(data.length === 0) {
        container.innerHTML = '<div class="col-span-full p-8 text-center text-gray-500 bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-800">No hay clientes registrados</div>';
        return;
    }
    const openPanels = [...container.querySelectorAll('[id^="cust-history-"]:not(.hidden), [id^="cust-invoices-"]:not(.hidden)')].map(el => el.id).filter(id => !id.includes('icon'));
    container.innerHTML = data.map(({ c, allSales, custSales, units, total, history }, idx) => {
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
                            <p class="text-[11px] text-gray-400">${sl.docType || ''} · ${sl.date} · ${units} equipo(s)</p>
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
        const totalSold = sellerSales.reduce((acc, cur) => acc + cur.total, 0);
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
function renderPOS() {
    const grid = document.getElementById('pos-products-grid');
    if(products.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center p-10 text-gray-500">No hay productos disponibles</div>';
    } else {
        const groups = {};
        products.forEach(p => {
            const key = `${p.brandId}_${p.name}_${p.category}`;
            if(!groups[key]) groups[key] = [];
            groups[key].push(p);
        });

        grid.innerHTML = Object.values(groups).map(variants => {
            const p = variants[0];
            const brand = brands.find(b => b.id == p.brandId);
            return `
                <div onclick="openVariantSelector('${p.name}', ${JSON.stringify(variants).replace(/"/g, '&quot;')})" class="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-sm border dark:border-gray-800 cursor-pointer hover:border-brand transition-all group hover:scale-105 hover:shadow-xl">
                    <div class="flex justify-between items-start">
                        <p class="text-xs font-bold text-brand uppercase">${brand ? brand.name : 'N/A'}</p>
                        <div class="flex gap-1">
                            ${variants.map(v => `<div class="color-dot" style="background-color: ${v.color}; width:8px; height:8px"></div>`).join('')}
                        </div>
                    </div>
                    <p class="font-bold group-hover:text-brand transition-colors">${p.name}</p>
                    <div class="flex justify-between items-center mt-3">
                        <span class="font-bold text-brand">${appCurrency}${Math.min(...variants.map(v => v.price)).toFixed(2)}</span>
                        <span class="text-xs ${variants.some(v => v.stock < 5) ? 'text-red-500' : 'text-gray-400'}">Ver Variantes</span>
                    </div>
                </div>
            `;
        }).join('');
    }
    document.getElementById('pos-customer').innerHTML = customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('') || '<option value="">Sin Cliente</option>';
    document.getElementById('pos-seller').innerHTML = sellers.map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '<option value="">Sin Vendedor</option>';
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
                    <span class="font-medium">${colorName}</span>
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
        el.style.display = el.innerText.toLowerCase().includes(q) ? 'block' : 'none';
    });
}

function addToCart(id) {
    const p = products.find(x => x.id == id);
    if(p.stock <= 0) return alert('Sin stock');
    const item = cart.find(x => x.id == id);
    if(item) {
        if(item.qty < p.stock) item.qty++;
        else alert('Límite de stock alcanzado');
    } else {
        cart.push({...p, qty: 1});
    }
    closeModal('modal-variants');
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items');
    let total = 0;
    container.innerHTML = cart.map((item, idx) => {
        total += item.price * item.qty;
        const colorName = AVAILABLE_COLORS.find(c => c.hex === item.color)?.name || 'S/C';
        return `
            <div class="flex justify-between items-center text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border dark:border-gray-700">
                <div class="flex items-center gap-2">
                    <div class="color-dot" style="background-color: ${item.color}; width:12px; height:12px"></div>
                    <div><p class="font-bold">${item.name} (${colorName})</p><p class="text-xs text-gray-500">${appCurrency}${item.price} x ${item.qty}</p></div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="changeQty(${idx}, -1)" class="w-6 h-6 bg-white dark:bg-gray-700 rounded-lg shadow-sm">-</button>
                    <span class="font-bold">${item.qty}</span>
                    <button onclick="changeQty(${idx}, 1)" class="w-6 h-6 bg-white dark:bg-gray-700 rounded-lg shadow-sm">+</button>
                </div>
            </div>
        `;
    }).join('');
    document.getElementById('cart-subtotal').innerText = `${appCurrency}${total.toFixed(2)}`;
    document.getElementById('cart-total').innerText = `${appCurrency}${total.toFixed(2)}`;
}

function changeQty(idx, delta) {
    const item = cart[idx];
    const p = products.find(x => x.id == item.id);
    if(delta > 0 && item.qty >= p.stock) return alert('Sin stock');
    item.qty += delta;
    if(item.qty <= 0) cart.splice(idx, 1);
    renderCart();
}

// PAYMENT SETTLEMENT LOGIC
let currentSettlePayments = [];

function openPaymentModal() {
    if(cart.length === 0) return alert('El carrito está vacío');
    
    const total = cart.reduce((acc, cur) => acc + (cur.price * cur.qty), 0);
    document.getElementById('settle-total').innerText = `${appCurrency}${total.toFixed(2)}`;
    currentSettlePayments = [];
    document.getElementById('settle-payments-list').innerHTML = '';
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
    const total = cart.reduce((acc, cur) => acc + (cur.price * cur.qty), 0);
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
    const total = cart.reduce((acc, cur) => acc + (cur.price * cur.qty), 0);
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
    const total = cart.reduce((acc, cur) => acc + (cur.price * cur.qty), 0);
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
            rateType: rateType
        });
    });

    const sale = {
        id: 'INV-' + Date.now().toString().slice(-8),
        date: new Date().toLocaleString(),
        customerId: custId,
        sellerId: sellId,
        rate: rate,
        rateType: rateType,
        docType: docType,
        mainCurrency: mainCurrency,
        payments: paymentsMade,
        items: [...cart],
        total: total
    };

    try {
        const saved = await createSale(sale);
        sale.total = saved.total;
    } catch (err) {
        return alert('No se pudo registrar la venta: ' + err.message);
    }
    await syncChain;
    await reloadData();
    
    fillInvoice(sale);

    cart = [];
    renderCart();
    renderPOS();
    closeModal('modal-payment-settle');
    
    if(confirm('¿Desea descargar la factura en PDF?')) {
        await downloadPDF(sale.id);
    } else {
        window.print();
    }
}

async function downloadPDF(saleId) {
    const element = document.getElementById('printable-invoice');
    element.classList.remove('print-only');
    element.classList.add('block');

    const opt = {
        margin: 0.5,
        filename: `DgtTec_Factura_${saleId}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    await html2pdf().set(opt).from(element).save();
    
    element.classList.add('print-only');
    element.classList.remove('block');
}

function renderSales() {
    const tbody = document.getElementById('sales-table-body');
    if(sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay ventas registradas</td></tr>';
        return;
    }
    tbody.innerHTML = [...sales].reverse().map(s => {
        const cust = customers.find(c => c.id == s.customerId);
        const cancelled = s.status === 'cancelada';
        const paySummary = (s.payments || []).map(p => {
            const m = payments.find(meth => meth.id == p.methodId);
            return m ? m.name : 'N/A';
        }).join(', ');

        return `
            <tr class="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition ${cancelled ? 'opacity-70' : ''}">
                <td class="p-4">
                    <p class="font-mono">${s.id}</p>
                    <p class="text-xs text-gray-400">${s.docType || ''} · ${s.date}</p>
                    ${cancelled ? `<span class="inline-block mt-1 px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-600 rounded-full">ANULADA</span><p class="text-xs text-red-500 mt-1">Motivo: ${s.cancelReason}</p>` : ''}
                </td>
                <td class="p-4">${cust ? cust.name : 'General'}</td>
                <td class="p-4 text-xs">${paySummary}</td>
                <td class="p-4 font-bold ${cancelled ? 'line-through text-gray-400' : ''}">${appCurrency}${s.total.toFixed(2)}</td>
                <td class="p-4 text-center">
                    <div class="flex justify-center gap-3">
                        <button onclick="reprint('${s.id}', true)" class="text-brand hover:underline">PDF</button>
                        <button onclick="reprint('${s.id}', false)" class="text-gray-600 hover:underline">Imprimir</button>
                        ${cancelled
                            ? `<button onclick="deleteSale('${s.id}')" class="text-red-500 hover:text-red-700" title="Eliminar"><i class="fas fa-trash"></i></button>`
                            : `<button onclick="openCancelSale('${s.id}')" class="text-red-500 hover:text-red-700" title="Anular"><i class="fas fa-ban"></i></button>`}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
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
        const colorName = AVAILABLE_COLORS.find(c => c.hex === i.color)?.name || '';
        const desc = `${b ? b.name + ' ' : ''}${i.name}${colorName ? ' ' + colorName : ''}`.toUpperCase();
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
        const m = payments.find(meth => meth.id == p.methodId);
        if (p.currency === 'VES') {
            const bs = p.amountBs != null ? p.amountBs : p.amount * rate;
            return `<div style="max-width:300px;"><div class="flex justify-between"><span>${m ? m.name : 'Método'}</span><span class="font-semibold">Bs. ${fmtMoney(bs)}</span></div><p class="text-right" style="font-size:10px;color:#8A8AA0;">${appCurrency} ${fmtMoney(p.amount)} · Tasa ${p.rateType || sale.rateType || ''} ${fmtMoney(rate)}</p></div>`;
        }
        return `<div class="flex justify-between" style="max-width:300px;"><span>${m ? m.name : 'Método'}</span><span class="font-semibold">${appCurrency} ${fmtMoney(p.amount)}</span></div>`;
    }).join('') || '<p style="color:#8A8AA0;">S/D</p>';

    const units = sale.items.reduce((a, i) => a + i.qty, 0);
    const totalUsd = sale.total;
    const totalBs = sale.total * rate;
    set('inv-count', units);
    set('inv-subtotal', `${appCurrency} ${fmtMoney(totalUsd)}`);
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
    renderInventory();
    updateDashboard();
}

function updateDashboard() {
    const activeSales = sales.filter(s => s.status !== 'cancelada');
    const total = activeSales.reduce((acc, cur) => acc + cur.total, 0);
    const totalComm = activeSales.reduce((acc, s) => {
        const sell = sellers.find(sl => sl.id == s.sellerId);
        return acc + (sell ? s.total * sell.comm : 0);
    }, 0);
    document.getElementById('dash-total-sales').innerText = `${appCurrency}${total.toFixed(2)}`;
    document.getElementById('dash-total-commissions').innerText = `${appCurrency}${totalComm.toFixed(2)}`;
    document.getElementById('dash-total-products').innerText = products.length;
    document.getElementById('dash-low-stock').innerText = products.filter(p => p.stock < 5).length;
}

function deleteItem(arrayName, id, callback) {
    if(confirm('¿Eliminar registro permanentemente?')) {
        if(arrayName === 'products') products = products.filter(x => x.id != id);
        if(arrayName === 'brands') brands = brands.filter(x => x.id != id);
        if(arrayName === 'customers') customers = customers.filter(x => x.id != id);
        if(arrayName === 'sellers') sellers = sellers.filter(x => x.id != id);
        if(arrayName === 'payments') payments = payments.filter(x => x.id != id);
        save();
        callback();
    }
}

let syncChain = Promise.resolve();
function save() {
    const state = { brands, products, customers, sellers, payments };
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
    sellers = d.sellers; payments = d.payments; sales = d.sales;
    appCurrency = d.appCurrency; globalRate = d.globalRate;
    bcvRate = d.bcvRate; binanceRate = d.binanceRate; rateDate = d.rateDate;
    syncRateInputs();
    document.getElementById('config-currency').value = appCurrency;
    document.getElementById('config-rate').value = globalRate;
}

function refreshAllViews() {
    [updateDashboard, renderBrands, renderInventory, renderPOS, renderCart, renderCustomers, renderSellers, renderPayments, renderSales]
        .forEach(f => { try { f(); } catch (e) { console.error(e); } });
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
    const data = { products, brands, customers, sellers, payments, sales, appCurrency, globalRate, bcvRate, binanceRate, rateType, rateDate };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup_dgttecnology_${new Date().toLocaleDateString()}.json`;
    a.click();
}

function importData(event) {
    if (!currentProfile || currentProfile.role !== 'admin') return alert('Solo un administrador puede importar datos');
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = JSON.parse(e.target.result);
        products = data.products || [];
        brands = data.brands || [];
        customers = data.customers || [];
        sellers = data.sellers || [];
        payments = data.payments || [];
        sales = data.sales || [];
        appCurrency = data.appCurrency || '$';
        globalRate = data.globalRate || '36.50';
        bcvRate = data.bcvRate || globalRate;
        binanceRate = data.binanceRate || globalRate;
        rateType = data.rateType || 'BCV';
        rateDate = data.rateDate || '';
        importAll({ products, brands, customers, sellers, payments, sales, appCurrency, globalRate, bcvRate, binanceRate, rateDate })
            .then(() => { alert('Datos importados a la nube con éxito'); location.reload(); })
            .catch(err => alert('Error al importar: ' + err.message));
    };
    reader.readAsText(file);
}

// INITIALIZATION
async function startApp(profile) {
    currentProfile = profile;
    document.body.classList.add(profile.role === 'admin' ? 'role-admin' : 'role-vendedor');
    await reloadData();
    document.getElementById('current-date').innerText = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    showSection(profile.role === 'admin' ? 'dashboard' : 'pos');
    if (profile.role === 'admin') { renderUsersAdmin(); renderAudit(); }
    subscribeChanges(() => syncChain.then(reloadData).then(refreshAllViews).catch(console.error));
}

// Funciones usadas desde los atributos onclick/onchange del HTML
Object.assign(window, { addPaymentRow, addToCart, changeQty, closeModal, deleteItem, deleteSale, downloadPDF, duplicateProduct, editBrand, editCustomer, editPayment, editProduct, editSeller, executeFinalSale, exportData, fillInvoice, filterPOS, fmtBs, fmtMoney, formatUSD, getInitials, getProductHistory, getRate, importData, onPayMethodChange, onSaleRateInput, openCancelSale, openModal, openPaymentModal, openVariantSelector, refreshAllViews, refreshSalesViews, reloadData, removePaymentRow, renderAudit, renderBrands, renderCart, renderCustomers, renderInventory, renderPOS, renderPayments, renderSales, renderSellers, renderUsersAdmin, reprint, resetModal, save, selectColor, selectRateType, setDailyRate, setupProductModal, showSection, startApp, syncRateInputs, toggleCustomerHistory, toggleCustomerInvoices, toggleDarkMode, updateCurrency, updateDashboard, updateRate, updateSettleBalance, updateUser })

export { startApp }

import re
SRC='/home/ubuntu/out/sistema.html'
L=open(SRC,encoding='utf-8').read().split('\n')
b0=next(i for i,l in enumerate(L) if l.startswith('<body'))
s0=max(i for i,l in enumerate(L) if l.strip()=='<script>')
s1=max(i for i,l in enumerate(L) if l.strip()=='</script>')
body_inner='\n'.join(L[b0+1:s0])
script='\n'.join(L[s0+1:s1])

def subfirst(pat, rep, s, flags=re.S):
    assert re.search(pat, s, flags), pat
    return re.sub(pat, lambda m: rep, s, count=1, flags=flags)

def sub1(pat, rep, s, flags=re.S):
    n=len(re.findall(pat, s, flags))
    assert n==1, (pat, n)
    return re.sub(pat, lambda m: rep, s, count=1, flags=flags)

# ---------- index.html ----------
user_box='''            <div class="p-4 border-t border-gray-100 dark:border-gray-800">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center"><i class="fas fa-user"></i></div>
                    <div class="min-w-0 flex-1">
                        <p id="user-email" class="text-sm font-semibold truncate"></p>
                        <p id="user-role" class="text-[10px] uppercase tracking-widest text-brand font-bold"></p>
                    </div>
                    <button onclick="logout()" title="Cerrar sesión" class="w-9 h-9 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-gray-800 transition"><i class="fas fa-right-from-bracket"></i></button>
                </div>
            </div>
        </aside>'''
body_inner=sub1(r'        </aside>', user_box, body_inner)

admin_cards='''                <div class="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-sm border dark:border-gray-800 max-w-4xl space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-xl font-bold"><i class="fas fa-user-shield text-brand mr-2"></i>Usuarios y roles</h3>
                        <button onclick="renderUsersAdmin()" class="text-sm text-brand hover:underline"><i class="fas fa-rotate"></i> Actualizar</button>
                    </div>
                    <p class="text-sm text-gray-500">Las cuentas nuevas quedan <b>pendientes</b> hasta que usted las active. El Vendedor sólo puede vender, registrar clientes y ver sus propias ventas.</p>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead><tr class="text-left text-gray-400 text-xs uppercase"><th class="p-2">Usuario</th><th class="p-2">Rol</th><th class="p-2">Vendedor asociado</th><th class="p-2">Estado</th></tr></thead>
                            <tbody id="users-table-body"></tbody>
                        </table>
                    </div>
                </div>
                <div class="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-sm border dark:border-gray-800 max-w-4xl space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-xl font-bold"><i class="fas fa-clipboard-list text-brand mr-2"></i>Registro de auditoría</h3>
                        <button onclick="renderAudit()" class="text-sm text-brand hover:underline"><i class="fas fa-rotate"></i> Actualizar</button>
                    </div>
                    <div class="overflow-x-auto max-h-96 overflow-y-auto">
                        <table class="w-full text-xs">
                            <thead><tr class="text-left text-gray-400 uppercase"><th class="p-2">Fecha</th><th class="p-2">Usuario</th><th class="p-2">Acción</th><th class="p-2">Registro</th></tr></thead>
                            <tbody id="audit-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </section>'''
i=body_inner.index('id="section-config"'); j=body_inner.index('</section>', i)
body_inner=body_inner[:j].rstrip(' ')+admin_cards.lstrip(' ').replace('                <div','                <div',1)[0:0]+admin_cards[admin_cards.index('<div'):]+body_inner[j+len('</section>'):]

inp='w-full p-3 border rounded-xl dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-brand'
btn='w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl transition disabled:opacity-60'
auth_screen=f'''    <div id="auth-screen" class="hidden min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
        <div class="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-xl border dark:border-gray-800 p-8">
            <div class="text-center mb-6">
                <img src="/logo.png" alt="DGT Technology" class="h-20 mx-auto mb-3">
                <h1 class="text-2xl font-bold">DgtTecnology<span class="text-brand">Vzla</span></h1>
                <p class="text-xs text-gray-400 uppercase tracking-widest">Sistema de ventas</p>
            </div>
            <form id="form-login" class="space-y-4 hidden" id-view="login">
                <input id="login-email" type="email" required autocomplete="username" placeholder="Correo electrónico" class="{inp}">
                <input id="login-password" type="password" required autocomplete="current-password" placeholder="Contraseña" class="{inp}">
                <button class="{btn}"><i class="fas fa-right-to-bracket mr-2"></i>Iniciar sesión</button>
                <div class="flex justify-between text-sm"><a href="#" data-auth-view="forgot" class="text-brand hover:underline">¿Olvidó su contraseña?</a><a href="#" data-auth-view="signup" class="text-brand hover:underline">Crear cuenta</a></div>
            </form>
            <form id="form-signup" class="space-y-4 hidden">
                <input id="signup-name" required placeholder="Nombre completo" class="{inp}">
                <input id="signup-email" type="email" required autocomplete="username" placeholder="Correo electrónico" class="{inp}">
                <input id="signup-password" type="password" required minlength="8" autocomplete="new-password" placeholder="Contraseña (mín. 8 caracteres)" class="{inp}">
                <input id="signup-password2" type="password" required minlength="8" autocomplete="new-password" placeholder="Repetir contraseña" class="{inp}">
                <button class="{btn}">Crear cuenta</button>
                <p class="text-xs text-gray-500 text-center">El administrador debe aprobar la cuenta antes de usarla.</p>
                <a href="#" data-auth-view="login" class="block text-center text-sm text-brand hover:underline">Volver a iniciar sesión</a>
            </form>
            <form id="form-forgot" class="space-y-4 hidden">
                <p class="text-sm text-gray-500">Escriba su correo y le enviaremos un enlace para crear una nueva contraseña.</p>
                <input id="forgot-email" type="email" required placeholder="Correo electrónico" class="{inp}">
                <button class="{btn}">Enviar enlace</button>
                <a href="#" data-auth-view="login" class="block text-center text-sm text-brand hover:underline">Volver a iniciar sesión</a>
            </form>
            <form id="form-recovery" class="space-y-4 hidden">
                <p class="text-sm text-gray-500">Escriba su nueva contraseña.</p>
                <input id="recovery-password" type="password" required minlength="8" autocomplete="new-password" placeholder="Nueva contraseña" class="{inp}">
                <button class="{btn}">Guardar contraseña</button>
            </form>
            <div id="auth-pending" class="hidden text-center space-y-4">
                <i class="fas fa-hourglass-half text-4xl text-amber-500"></i>
                <p class="font-semibold">Cuenta pendiente de aprobación</p>
                <p class="text-sm text-gray-500">La cuenta <b id="pending-email"></b> fue creada. Un administrador debe activarla antes de que pueda usar el sistema.</p>
                <button onclick="logout()" class="{btn}">Cerrar sesión</button>
            </div>
            <div id="auth-config" class="hidden text-center space-y-3">
                <i class="fas fa-plug-circle-exclamation text-4xl text-red-500"></i>
                <p class="font-semibold">Falta conectar la base de datos</p>
                <p class="text-sm text-gray-500">Configure VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY y vuelva a publicar la aplicación.</p>
            </div>
            <p id="auth-message" class="text-sm text-center mt-4"></p>
        </div>
    </div>'''
auth_screen=auth_screen.replace(' id-view="login"','')
for v in ['login','signup','forgot','recovery']:
    auth_screen=auth_screen.replace(f'<form id="form-{v}" class="', f'<form id="form-{v}" data-view="{v}" class="')
# auth.js toggles elements with id auth-<view>; wrap forms
for v in ['login','signup','forgot','recovery']:
    auth_screen=re.sub(rf'(<form id="form-{v}".*?</form>)', rf'<div id="auth-{v}" class="hidden">\1</div>', auth_screen, flags=re.S)
    auth_screen=auth_screen.replace(f'<form id="form-{v}" data-view="{v}" class="space-y-4 hidden">', f'<form id="form-{v}" class="space-y-4">')

index=f'''<!DOCTYPE html>
<html lang="es" class="">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#7C3AED">
    <meta name="description" content="Sistema de ventas e inventario de DGT Technology">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title>DgtTecnologyVzla | Sistema</title>
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <script>if (localStorage.getItem('ns_theme') === 'dark') document.documentElement.classList.add('dark');</script>
</head>
<body class="bg-slate-50 text-gray-800 dark:bg-gray-950 dark:text-gray-100">
{auth_screen}
    <div id="app-shell" class="hidden">
{body_inner}
    </div>
    <script type="module" src="/src/main.js"></script>
</body>
</html>
'''
open('index.html','w',encoding='utf-8').write(index)

# ---------- app.js ----------
s=script
s=sub1(r"let products = JSON\.parse.*?let globalRate = localStorage\.getItem\('ns_rate'\) \|\| '36\.50';",
 "let products = [], brands = [], customers = [], sellers = [], payments = [], sales = [];\n        let appCurrency = '$';\n        let globalRate = '36.50';\n        let currentProfile = null;", s)
s=subfirst(r"localStorage\.setItem\('ns_currency', appCurrency\);", "saveSetting('currency', appCurrency).catch(err => alert('No se pudo guardar: ' + err.message));", s)
s=subfirst(r"localStorage\.setItem\('ns_rate', globalRate\);", "saveSetting('rate', globalRate).catch(err => alert('No se pudo guardar: ' + err.message));", s)
for key, name in [('ns_rate_binance', "'rate_binance', binanceRate"), ('ns_rate_bcv', "'rate_bcv', bcvRate"), ('ns_rate_date', "'rate_date', rateDate")]:
    s=subfirst(r"localStorage\.setItem\('%s', \w+\);" % key, "saveSetting(%s).catch(err => alert('No se pudo guardar la tasa: ' + err.message));" % name, s)
s=sub1(r"id: 'INV-' \+ Date\.now\(\)\.toString\(\)\.slice\(-6\)", "id: 'INV-' + Date.now().toString().slice(-8)", s)
s=sub1(r"cart\.forEach\(item => \{\s*const p = products\.find\(x => x\.id == item\.id\);\s*p\.stock -= item\.qty;\s*\}\);.*?sales\.push\(sale\);\s*save\(\);",
"""try {
                const saved = await createSale(sale);
                sale.total = saved.total;
            } catch (err) {
                return alert('No se pudo registrar la venta: ' + err.message);
            }
            await syncChain;
            await reloadData();""", s)
s=sub1(r"document\.getElementById\('form-cancel-sale'\)\.onsubmit = \(e\) =>", "document.getElementById('form-cancel-sale').onsubmit = async (e) =>", s)
s=sub1(r"s\.status = 'cancelada';.*?save\(\);",
"""try {
                await cancelSale(s.id, reason);
            } catch (err) {
                return alert('No se pudo anular: ' + err.message);
            }
            await reloadData();""", s)
s=sub1(r"function deleteSale\(id\)", "async function deleteSale(id)", s)
s=sub1(r"sales = sales\.filter\(x => x\.id !== id\);\s*save\(\);",
"""try {
                await deleteSaleRemote(id);
            } catch (err) {
                return alert('No se pudo eliminar: ' + err.message);
            }
            await reloadData();""", s)
s=sub1(r"function importData\(event\) \{", "function importData(event) {\n            if (!currentProfile || currentProfile.role !== 'admin') return alert('Solo un administrador puede importar datos');", s)
s=sub1(r"save\(\);\s*alert\('Datos importados con éxito'\);\s*location\.reload\(\);",
"""importAll({ products, brands, customers, sellers, payments, sales, appCurrency, globalRate, bcvRate, binanceRate, rateDate })
                    .then(() => { alert('Datos importados a la nube con éxito'); location.reload(); })
                    .catch(err => alert('Error al importar: ' + err.message));""", s)
s=sub1(r"function save\(\) \{.*?\n        \}",
"""let syncChain = Promise.resolve();
        function save() {
            const state = { brands, products, customers, sellers, payments };
            syncChain = syncChain.then(() => syncTables(state)).catch(async err => {
                alert('No se pudo guardar en la nube: ' + err.message + '\\nSe recargarán los datos.');
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
        }""", s)
s=sub1(r"// INITIALIZATION.*$",
"""// INITIALIZATION
        async function startApp(profile) {
            currentProfile = profile;
            document.body.classList.add(profile.role === 'admin' ? 'role-admin' : 'role-vendedor');
            await reloadData();
            document.getElementById('current-date').innerText = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            showSection(profile.role === 'admin' ? 'dashboard' : 'pos');
            if (profile.role === 'admin') { renderUsersAdmin(); renderAudit(); }
            subscribeChanges(() => syncChain.then(reloadData).then(refreshAllViews).catch(console.error));
        }""", s)

s=sub1(r"if \(!rateAuto\) return;", "if (!rateAuto || !currentProfile) return;", s)
s=sub1(r"await reloadData\(\);\n            document\.getElementById\('current-date'\)", "await reloadData();\n            fetchLiveRates(false);\n            document.getElementById('current-date')", s)

# dedent 8 spaces
s='\n'.join(l[8:] if l.startswith('        ') else l for l in s.split('\n'))
names=sorted(set(re.findall(r'^(?:async\s+)?function\s+(\w+)', s, re.M)))
header="""import html2pdf from 'html2pdf.js'
import { fetchAll, syncTables, saveSetting, createSale, cancelSale, deleteSaleRemote, importAll, listProfiles, updateProfile, listAudit, subscribeChanges, clean } from './data.js'

"""
footer="\n\n// Funciones usadas desde los atributos onclick/onchange del HTML\nObject.assign(window, { " + ", ".join(names) + " })\n\nexport { startApp }\n"
open('src/app.js','w',encoding='utf-8').write(header+s.strip('\n')+footer)
print('functions exported:', len(names))

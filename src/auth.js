import { supabase, isConfigured } from './supabase.js'
import { startApp } from './app.js'

const $ = (id) => document.getElementById(id)
const IDLE_MINUTES = 30
const VIEWS = ['login', 'signup', 'forgot', 'recovery', 'pending', 'config']

const ERRORS = {
  'Invalid login credentials': 'Correo o contraseña incorrectos',
  'Email not confirmed': 'Debe confirmar su correo antes de entrar',
  'User already registered': 'Ese correo ya está registrado',
}
const tr = (msg) => ERRORS[msg] || msg

function showView(view) {
  $('auth-screen').classList.remove('hidden')
  $('app-shell').classList.add('hidden')
  VIEWS.forEach((v) => $('auth-' + v).classList.toggle('hidden', v !== view))
  setMessage('')
}

function setMessage(text, ok = false) {
  const el = $('auth-message')
  el.textContent = text
  el.className = 'text-sm text-center mt-4 ' + (ok ? 'text-green-600' : 'text-red-500')
}

function busy(form, on) {
  form.querySelectorAll('button, input').forEach((el) => (el.disabled = on))
}

async function enter(user) {
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error || !profile) {
    showView('login')
    return setMessage('No se encontró el perfil del usuario. Contacte al administrador.')
  }
  if (!profile.active) {
    showView('pending')
    $('pending-email').textContent = user.email
    return
  }
  $('auth-screen').classList.add('hidden')
  $('app-shell').classList.remove('hidden')
  $('user-email').textContent = profile.full_name || user.email
  $('user-role').textContent = profile.role === 'admin' ? 'Administrador' : 'Vendedor'
  try {
    await startApp(profile)
  } catch (err) {
    alert('No se pudieron cargar los datos: ' + err.message)
  }
  startIdleTimer()
}

function startIdleTimer() {
  let timer
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      alert('Sesión cerrada por inactividad.')
      await supabase.auth.signOut()
    }, IDLE_MINUTES * 60 * 1000)
  }
  ;['mousemove', 'keydown', 'click', 'touchstart'].forEach((ev) => window.addEventListener(ev, reset, { passive: true }))
  reset()
}

export async function initAuth() {
  window.logout = () => supabase && supabase.auth.signOut()
  if (!isConfigured) return showView('config')

  const recovering = new URLSearchParams(location.search).has('recovery')
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showView('recovery')
    if (event === 'SIGNED_OUT') location.replace('/')
  })

  $('form-login').onsubmit = async (e) => {
    e.preventDefault()
    busy(e.target, true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $('login-email').value.trim(),
      password: $('login-password').value,
    })
    busy(e.target, false)
    if (error) return setMessage(tr(error.message))
    await enter(data.user)
  }

  $('form-signup').onsubmit = async (e) => {
    e.preventDefault()
    const password = $('signup-password').value
    if (password.length < 8) return setMessage('La contraseña debe tener al menos 8 caracteres')
    if (password !== $('signup-password2').value) return setMessage('Las contraseñas no coinciden')
    busy(e.target, true)
    const { data, error } = await supabase.auth.signUp({
      email: $('signup-email').value.trim(),
      password,
      options: { data: { full_name: $('signup-name').value.trim() }, emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    })
    busy(e.target, false)
    if (error) return setMessage(tr(error.message))
    if (data.session) return enter(data.user)
    showView('login')
    setMessage('Cuenta creada. Revise su correo para confirmarla y luego inicie sesión.', true)
  }

  $('form-forgot').onsubmit = async (e) => {
    e.preventDefault()
    busy(e.target, true)
    const { error } = await supabase.auth.resetPasswordForEmail($('forgot-email').value.trim(), {
      redirectTo: location.origin + import.meta.env.BASE_URL + '?recovery=1',
    })
    busy(e.target, false)
    if (error) return setMessage(tr(error.message))
    setMessage('Le enviamos un enlace a su correo para cambiar la contraseña.', true)
  }

  $('form-recovery').onsubmit = async (e) => {
    e.preventDefault()
    const password = $('recovery-password').value
    if (password.length < 8) return setMessage('La contraseña debe tener al menos 8 caracteres')
    busy(e.target, true)
    const { data, error } = await supabase.auth.updateUser({ password })
    busy(e.target, false)
    if (error) return setMessage(tr(error.message))
    history.replaceState(null, '', '/')
    await enter(data.user)
  }

  document.querySelectorAll('[data-auth-view]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      showView(a.dataset.authView)
    })
  )

  const { data: { session } } = await supabase.auth.getSession()
  if (recovering && session) return showView('recovery')
  if (session) return enter(session.user)
  showView('login')
}

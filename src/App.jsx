import { useState, useEffect } from 'react'
import ComparadorForm from './components/ComparadorForm'
import AdminDashboard from './components/AdminDashboard'
import CommercialDashboard from './components/CommercialDashboard'
import CommercialAvatar from './components/CommercialAvatar'
import { Lock, ArrowRight, Zap, ShieldCheck, Award, TrendingUp, Eye, EyeOff } from 'lucide-react'
import { gaClearUser, gaEvent, gaIdentifyCommercial } from './utils/analytics'

const ADMIN_CODES = new Set(['AdminMiguel2909', 'IvanMaster01'])
const ADMIN_NAMES = {
  AdminMiguel2909: 'Miguel Delgado',
  IvanMaster01: 'Ivan Lopez'
}
const LOCAL_LOGIN_FALLBACKS = new Map([
  ['MIGUEL2909', { code: 'Miguel2909', name: 'Miguel Delgado', secretary: false, role: 'commercial' }]
])


function App() {
  // States: 'landing' | 'login' | 'app' | 'admin' | 'commercial-dashboard'
  const [viewState, setViewState] = useState('landing')
  const [commercialCode, setCommercialCode] = useState('')
  const [commercialName, setCommercialName] = useState('')
  const [isSecretary, setIsSecretary] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const isLanding = viewState === 'landing'
  const isLogin = viewState === 'login'

  // Do not restore login codes from local storage; only browser password manager may autofill.
  useEffect(() => {
    try {
      localStorage.removeItem('commercialCode')
      localStorage.removeItem('commercialName')
      localStorage.removeItem('isSecretary')
    } catch {}
  }, [])

  // Auto transition from landing to login after delay (optional) or via button
  // For now, let's keep it manual start

  const applyLogin = ({ finalCode, name = '', secretary = false, role = 'commercial', inputCode = '' }) => {
    const secretarySuffix = String(inputCode || '').trim().match(/-(\d+)$/)?.[1] || ''
    const loginCode = secretary && secretarySuffix ? `${finalCode}-${secretarySuffix}` : finalCode
    setCommercialCode(loginCode)
    setCommercialName(name || '')
    setIsSecretary(Boolean(secretary))
    if (role === 'admin') {
      const editorName = name || finalCode || 'Administrador'
      try {
        sessionStorage.setItem('adminLoggedIn', 'true')
        sessionStorage.setItem('editorName', editorName)
        localStorage.setItem('adminLoggedIn', 'true')
        localStorage.setItem('editorName', editorName)
      } catch {}
    }
    gaIdentifyCommercial({ commercialCode: finalCode, role }).catch(() => {})
    gaEvent('commercial_login', { role, login_method: 'code' })
    setViewState('app')
  }

  const resolveCodeFromCommercials = async (rawCode) => {
    const normalizedCode = String(rawCode || '').trim()
    if (!normalizedCode) return null
    const isSecretaryCode = /-\d+$/.test(normalizedCode)
    const baseCode = isSecretaryCode ? normalizedCode.replace(/-\d+$/, '') : normalizedCode

    const response = await fetch('/api/comerciales')
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== 'object') return null

    const keys = Object.keys(data)
    const findKeyInsensitive = (value) => keys.find(k => k.toLowerCase() === value.toLowerCase()) || null
    const matchKey = isSecretaryCode
      ? (findKeyInsensitive(baseCode) || findKeyInsensitive(normalizedCode))
      : findKeyInsensitive(normalizedCode)
    if (!matchKey) return null
    return { code: matchKey, secretary: isSecretaryCode }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const trimmed = commercialCode.trim()
      const fallback = LOCAL_LOGIN_FALLBACKS.get(trimmed.toUpperCase())
      if (!trimmed) throw new Error('Código no válido')
      if (fallback) {
        applyLogin({
          finalCode: fallback.code,
          name: fallback.name || '',
          secretary: Boolean(fallback.secretary),
          role: fallback.role || 'commercial',
          inputCode: trimmed
        })
        return
      }
      const matchedAdminKey = [...ADMIN_CODES].find(c => c.toLowerCase() === trimmed.toLowerCase())
      if (matchedAdminKey) {
        applyLogin({
          finalCode: matchedAdminKey,
          name: ADMIN_NAMES[matchedAdminKey] || 'Administrador',
          secretary: false,
          role: 'admin',
          inputCode: trimmed
        })
        return
      }
      const response = await fetch('/api/validar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: trimmed })
      })
      
      if (!response.ok) {
        if (response.status === 401) {
          const resolved = await resolveCodeFromCommercials(trimmed)
          if (resolved?.code) {
            applyLogin({
              finalCode: resolved.code,
              name: '',
              secretary: Boolean(resolved.secretary),
              role: 'commercial',
              inputCode: trimmed
            })
            return
          }
        }
        const errorText = await response.text()
        let errorMsg = 'Código no válido'
        try {
          const errorJson = JSON.parse(errorText)
          errorMsg = errorJson.error || errorMsg
        } catch {}
        console.error('Validation error:', errorText)
        throw new Error(errorMsg)
      }
      
      const data = await response.json()
      if (!data?.ok) throw new Error('Código no válido')
      const codeToUse = data.code || trimmed
      const isUserAdmin = [...ADMIN_CODES].some(c => c.toLowerCase() === codeToUse.toLowerCase())
      applyLogin({
        finalCode: codeToUse,
        name: data.name || '',
        secretary: Boolean(data.secretary),
        role: isUserAdmin ? 'admin' : 'commercial',
        inputCode: trimmed
      })
    } catch (err) {
      console.error('Login error:', err)
      setError(err.message || 'Código no válido')
    } finally {
      setLoading(false)
    }
  }

  // APP VIEW
  const isAdmin = [...ADMIN_CODES].some(c => c.toLowerCase() === (commercialCode || '').trim().toLowerCase())
  const isDashboardView = viewState === 'admin' || viewState === 'commercial-dashboard'


  const handleLogout = () => {
    gaEvent('commercial_logout', { role: isAdmin ? 'admin' : 'commercial' })
    gaClearUser()
    try {
      sessionStorage.removeItem('adminLoggedIn')
      sessionStorage.removeItem('editorName')
      localStorage.removeItem('adminLoggedIn')
      localStorage.removeItem('editorName')
      localStorage.removeItem('commercialCode')
      localStorage.removeItem('commercialName')
      localStorage.removeItem('isSecretary')
    } catch {}
    setViewState('landing')
    setCommercialCode('')
    setCommercialName('')
    setIsSecretary(false)
    setError('')
  }
  
  if (viewState === 'app' || viewState === 'admin' || viewState === 'commercial-dashboard') {
    return (
      <div className={['min-h-[100dvh] flex flex-col app-electric text-slate-900 font-sans selection:bg-blue-100', isDashboardView ? '' : 'overflow-hidden'].join(' ')}>

        
        {/* Header (dashboards only). The Comparador view uses the sticky header inside the form. */}
        {isDashboardView && (
          <header className="sticky top-0 w-full bg-white/80 backdrop-blur-xl z-30 border-b border-white/60 shadow-sm relative">
            <div className="pointer-events-none absolute inset-0 opacity-60">
              <div className="absolute inset-x-0 -top-10 h-16 bg-gradient-to-r from-cyan-200/40 via-blue-200/40 to-indigo-200/40 blur-2xl" />
            </div>
            <div className="max-w-7xl mx-auto px-3 md:px-6">
              <div className="h-12 md:h-14 flex items-center justify-between gap-2 relative">
                <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1">
                  <img 
                    src="/logo_soluciones_vivivan.webp" 
                    alt="Soluciones Vivivan" 
                    className="h-7 md:h-9 w-auto object-contain flex-shrink-0 drop-shadow-sm"
                  />
                  <div className="hidden sm:block h-6 w-px bg-slate-200 flex-shrink-0"></div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-extrabold text-xs md:text-sm text-slate-900 leading-tight truncate tracking-wide">Comparador Vivivan</span>
                    <span className="hidden md:block text-[10px] text-slate-500 font-black uppercase tracking-[0.18em]">Pro</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (viewState === 'admin') {
                          setViewState('app')
                          return
                        }
                        try {
                          sessionStorage.setItem('adminLoggedIn', 'true')
                          sessionStorage.setItem('editorName', commercialCode || 'Admin')
                          localStorage.setItem('adminLoggedIn', 'true')
                          localStorage.setItem('editorName', commercialName || commercialCode || 'Admin')
                        } catch {}
                        setViewState('admin')
                      }}
                      className="inline-flex text-[9px] md:text-xs font-semibold text-slate-600 hover:text-blue-600 transition-colors px-2 md:px-3 py-1 rounded-md hover:bg-blue-50 flex-shrink-0"
                    >
                      {viewState === 'admin' ? 'Volver' : 'Admin'}
                    </button>
                  )}
                  <button 
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 text-[9px] md:text-xs font-semibold text-slate-600 hover:text-red-600 transition-colors px-2 md:px-3 py-1 rounded-md hover:bg-red-50 flex-shrink-0 max-w-[12rem]"
                    title="Salir"
                  >
                    <CommercialAvatar
                      commercialCode={commercialCode}
                      commercialName={commercialName}
                      size={24}
                      className="rounded-lg shadow-none border-blue-200/70"
                    />
                    <span className="truncate">{commercialName || commercialCode || 'Salir'}</span>
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          </header>
        )}
        
        {isDashboardView ? (
          <main className="max-w-7xl mx-auto px-2 md:px-6 py-3 md:py-6">
            <div className="bg-white rounded-3xl shadow-2xl border border-white/60">
              {viewState === 'admin' ? (
                <AdminDashboard onBack={() => setViewState('app')} />
              ) : (
                <CommercialDashboard commercialCode={commercialCode} commercialName={commercialName} onBack={() => setViewState('app')} hideCommissions={isSecretary} />
              )}
            </div>
          </main>
        ) : (
          <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-2 md:px-6 relative flex items-start xl:items-center justify-center py-3 md:py-4 overflow-y-auto">
            <ComparadorForm
              commercialCode={commercialCode}
              commercialName={commercialName}
              isAdmin={isAdmin}
              isSecretary={isSecretary}
              onOpenDashboard={() => setViewState('commercial-dashboard')}
              onOpenAdmin={() => setViewState('admin')}
              onLogout={handleLogout}
            />
          </main>
        )}
      </div>
    )
  }

  // LANDING & LOGIN VIEWS
  return (
    <div
      className={[
        'min-h-screen flex items-center justify-center relative overflow-hidden',
        'landing-electric'
      ].join(' ')}
    >
        <div className="landing-energy" aria-hidden="true">
          <div className="landing-energy__grid" />
          <div className="landing-energy__orbs">
            <div className="landing-energy__orb landing-energy__orb--1" />
            <div className="landing-energy__orb landing-energy__orb--2" />
            <div className="landing-energy__orb landing-energy__orb--3" />
          </div>
          <svg className="landing-energy__svg" viewBox="0 0 1200 600" preserveAspectRatio="none">
            <path d="M0,420 C180,320 260,520 440,420 C620,320 700,520 880,420 C1040,330 1120,470 1200,420" />
            <path d="M0,280 C160,200 300,360 460,280 C640,200 760,360 920,280 C1060,220 1130,320 1200,280" />
            <path d="M0,150 C210,70 320,250 520,150 C720,50 840,240 1020,150 C1100,110 1140,180 1200,150" />
          </svg>
        </div>

        <div className="w-full max-w-4xl mx-auto px-6 py-12 relative z-10">

          <div
            className={[
              'flex flex-col items-center text-center space-y-10 transition-all duration-300',
              isLogin ? 'opacity-30 blur-[1px] scale-[0.99] pointer-events-none select-none' : ''
            ].join(' ')}
          >
              {/* Logo & Title */}
              <div className="space-y-3">
                  <img 
                      src="/logo_soluciones_vivivan.webp" 
                      alt="Soluciones Vivivan" 
                      className="w-[21.6rem] md:w-[28.8rem] h-auto mx-auto object-contain"
                  />
                  <div>
                      <h1 className="text-4xl md:text-6xl font-extrabold landing-title leading-tight">
                          Comparador Vivivan
                      </h1>
                      <p className="text-[10px] font-semibold text-white/80 uppercase tracking-[0.2em] mt-1 drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
                          Versión Pro
                      </p>
                  </div>
              </div>

              {/* CTA */}
              <button
                  onClick={() => setViewState('login')}
                  className="group inline-flex items-center justify-center gap-2.5 px-8 py-3.5 md:px-10 md:py-4 bg-white text-blue-800 font-extrabold text-base md:text-lg rounded-2xl border border-white/60 shadow-2xl shadow-blue-950/30 hover:bg-white/95 focus:outline-none focus:ring-4 focus:ring-white/45 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
              >
                  <span className="drop-shadow-[0_1px_0_rgba(255,255,255,0.35)]">Acceder al Sistema</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </button>

              {/* Footer */}
              <div className="flex items-center justify-center gap-2 pt-8 opacity-85 hover:opacity-100 transition-opacity">
                  <span className="text-xs font-semibold text-white/90 uppercase tracking-wide drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
                    Desarrollado por Crazy Digital SL
                  </span>
                  <img 
                      src="/crazy_digital_logo.png" 
                      alt="Crazy Digital" 
                      className="h-4 w-auto opacity-95 brightness-0 invert drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]"
                  />
              </div>
          </div>

          {isLogin && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10"
              role="dialog"
              aria-modal="true"
              aria-label="Acceso de agente"
              onClick={() => { setViewState('landing'); setError(''); }}
            >
              <div
                className="absolute inset-0 login-backdrop backdrop-blur-[2px]"
                aria-hidden="true"
              />

              <div className="relative max-w-md w-full mx-auto" onClick={(e) => e.stopPropagation()}>
                <div className="relative rounded-[28px] p-[1px] bg-gradient-to-br from-[#0017ff]/70 via-[#00d4ff]/40 to-white/50 shadow-2xl shadow-blue-950/35">
                  <div className="relative overflow-hidden rounded-[27px] login-card">
                    <div className="login-card__texture" aria-hidden="true" />

                    <div className="h-2 bg-gradient-to-r from-[#0017ff] via-[#0077ff] to-[#00d4ff]"></div>
                    
                    <div className="p-8 relative">
                        <button 
                            onClick={() => { setViewState('landing'); setError(''); }} 
                            className="text-slate-600 hover:text-slate-900 transition-colors mb-6 flex items-center gap-1.5 text-sm font-semibold group"
                        >
                            <ArrowRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform text-blue-600" />
                            Volver
                        </button>
                        
                        <div className="mb-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-blue-100 text-blue-700 text-[11px] font-bold uppercase tracking-[0.18em] shadow-sm">
                              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(0,200,255,0.5)]" />
                              Acceso Seguro
                            </div>
                            <h2 className="mt-3 text-3xl font-extrabold text-slate-900 tracking-tight">
                              Código de Agente
                            </h2>
                            <p className="text-slate-600 text-sm mt-1">
                              Introduce tu código autorizado para desbloquear el comparador.
                            </p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-5">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">
                                  Código
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                        <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shadow-sm">
                                          <Lock className="h-5 w-5 text-blue-700" strokeWidth={2.2} />
                                        </div>
                                    </div>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={commercialCode}
                                        onChange={(e) => setCommercialCode(e.target.value)}
                                        autoComplete="current-password"
                                        className="block w-full pl-[3.35rem] pr-12 py-3.5 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-200/40 focus:border-blue-300 text-sm font-bold transition-all bg-white border border-slate-200 shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
                                        placeholder="Código de acceso"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-900 transition-colors"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-5 w-5" strokeWidth={2} />
                                        ) : (
                                            <Eye className="h-5 w-5" strokeWidth={2} />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-2xl">
                                    <div className="w-2 h-2 rounded-full bg-rose-400"></div>
                                    <p className="text-rose-700 text-sm font-semibold">{error}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !commercialCode}
                                className={`w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl text-sm font-extrabold text-white bg-gradient-to-r from-[#000fcb] via-[#005bff] to-[#00e6ff] border border-white/35 shadow-[0_22px_70px_rgba(0,0,0,0.35)] hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-white/30 transition-all ${
                                    loading || !commercialCode ? 'opacity-50 cursor-not-allowed' : 'hover:-translate-y-0.5 active:translate-y-0'
                                }`}
                            >
                                {loading ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                                ) : (
                                    <>
                                        <ShieldCheck className="w-5 h-5" strokeWidth={2} />
                                        <span>Desbloquear Acceso</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
    </div>
  )
}

export default App

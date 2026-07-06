export default function LoadingExperience({
  title = 'Cargando',
  subtitle = 'Preparando datos...'
}) {
  return (
    <div className="w-full min-h-[320px] flex items-center justify-center px-6 py-10">
      <div className="loading-stage w-full max-w-2xl text-center">
        <div className="relative inline-flex items-center justify-center">
          <span className="loading-halo" aria-hidden="true" />
          <img
            src="/logo_soluciones_vivivan.webp"
            alt="Vivivan"
            className="h-20 md:h-24 w-auto object-contain loading-vivivan-logo relative z-10"
          />
        </div>

        <div className="mt-6">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-700/75">Vivivan</div>
          <div className="mt-1 text-2xl md:text-3xl font-black text-slate-900 leading-tight">{title}</div>
          <div className="mt-2 text-sm md:text-base font-semibold text-slate-600">{subtitle}</div>
        </div>

        <div className="mt-7 h-[3px] w-full bg-slate-200/80 overflow-hidden">
          <div className="loading-progress-bar h-full" />
        </div>
      </div>
    </div>
  )
}

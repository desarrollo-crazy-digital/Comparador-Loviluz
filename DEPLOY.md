# Deployment Checklist for Vercel

## Setup en Vercel Dashboard

### 1. Variables de Entorno Requeridas

Ve a **Vercel Dashboard → Tu Proyecto → Settings → Environment Variables** y añade:

```
VITE_SUPABASE_URL=tu_url_de_supabase
VITE_SUPABASE_ANON_KEY=tu_clave_anonima_de_supabase
SUPABASE_CONSUMPTION_URL=tu_url_de_supabase_consumo
SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY=tu_service_role_key_de_supabase_consumo
GEMINI_API_KEY=tu_api_key_de_gemini
```

**IMPORTANTE:** Sin estas variables:

- Login de comerciales NO funcionará (validar.js falla)
- Dashboard de estadísticas mostrará "cargando" infinito
- Extracción de facturas fallará
- El lookup de consumo anual por CUPS no funcionará si faltan `SUPABASE_CONSUMPTION_URL` y `SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY`

`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` se mantienen para `stats`.
`SUPABASE_CONSUMPTION_*` se usan solo para la base separada de `consumo`.

### 2. Build Settings

- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### 3. Verificar Deployment

Después de deploy, verifica estos endpoints:

```bash
# Validar código comercial
curl -X POST https://tu-app.vercel.app/api/validar \
  -H "Content-Type: application/json" \
  -d '{"codigo":"TU_CODIGO"}'

# Ver estadísticas
curl https://tu-app.vercel.app/api/stats
```

### 4. Troubleshooting

**Problema:** "Error de comercial cuando el código es correcto"

- **Causa:** `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` no configuradas
- **Solución:** Añade las variables en Vercel Dashboard

**Problema:** Dashboard muestra "Cargando..." infinito

- **Causa:** `/api/stats` no funciona o Supabase no configurado
- **Solución:**
  1. Verifica variables de entorno
  2. Revisa logs en Vercel Dashboard → Deployments → Logs

**Problema:** 404 en `/api/stats`

- **Causa:** `vercel.json` no configurado
- **Solución:** Asegúrate de tener `api/stats.js` en el proyecto

### 5. Redeploy

Después de cambiar variables de entorno:

1. Ve a Deployments
2. Click en los tres puntos del último deployment
3. **Redeploy**

## Checklist Final

- [ ] Variables de entorno configuradas en Vercel
- [ ] `vercel.json` incluye `api/stats.js`
- [ ] Build exitoso sin errores
- [ ] Test endpoint `/api/validar`
- [ ] Test endpoint `/api/stats`
- [ ] Login funciona con código comercial
- [ ] Dashboard carga estadísticas

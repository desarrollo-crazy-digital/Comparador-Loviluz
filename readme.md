# Comparador de Tarifas (React + Vite)

## Arquitectura y Stack Tecnológico

Este proyecto utiliza un conjunto moderno de herramientas para garantizar rendimiento, escalabilidad y una excelente experiencia de usuario:

### Frontend (Cliente)
- **[React](https://reactjs.org/) (v18)**: Biblioteca principal para la construcción de interfaces interactivas (`src/`).
- **[Vite](https://vitejs.dev/)**: Herramienta de construcción (bundler) ultrarrápida para el entorno de desarrollo.
- **[Tailwind CSS](https://tailwindcss.com/)**: Framework de CSS basado en utilidades para el diseño rápido, moderno y responsivo.
- **[Framer Motion](https://www.framer.com/motion/)**: Biblioteca para animaciones fluidas y potentes transiciones de los componentes.
- **[ApexCharts](https://apexcharts.com/)**: Biblioteca empleada para la visualización de datos de ahorros mediante gráficos interactivos.
- **[Lucide React](https://lucide.dev/)**: Colección de iconos minimalistas implementados en toda la interfaz.

### Backend (Servidor / API)
- **[Node.js](https://nodejs.org/)**: Entorno de ejecución de servidor (`server.js`) utilizado exhaustivamente para el entorno local y herramientas de desarrollo.
- **Vercel Functions**: Funciones serverless ejecutadas bajo demanda. Todo el backend expuesto a producción se encuentra en el directorio `/api/`.
- **Motor de Cálculo (`calculator.js`)**: Entorno agnóstico para toda la lógica física y matemática de la comparación energética.

### Base de Datos y Datos Persistentes
- **Flat Files (JSON)**: Base principal de lectura ágil. Datos confidenciales y maestría de tarifas almacenados en `api/data-private/` y entregados vía endpoints estandarizados.
- **[SQLite](https://www.sqlite.org/)**: Base local embebida (`sips_comparator.sqlite`) utilizada eficientemente para mapear historiales gigantes de consumo (SIPS CUPS).
- **[Supabase](https://supabase.com/)**: Backend as a Service (BaaS) / PostgreSQL usado de forma separada para estadísticas e historial comercial.
- **Supabase (consumo)**: Proyecto Supabase separado usado para resolver el consumo anual por CUPS en el comparador.

### Inteligencia Artificial y Procesamiento Avanzado
- **Gemini AI API**: Integración profunda con modelos grandes de lenguaje (LLM) de Google (ej. `gemini-2.5-flash`), permitiendo el parseo estructurado avanzado de facturas eléctricas e imágenes a formato JSON comprensible por el sistema.
- **Parseadores de Ficheros**: `pdf-parse` y `xlsx` para la extracción de lectura nativa de tarifas provistas por las energéticas o facturas de terceros en formato binario.
- **Generación de Reportes**: `html2canvas` y `jsPDF` empleados para componer, exportar e imprimir el dashboard visual como documento al cliente final.

## Desarrollo
- `npm install`
- `npm run dev:full` (API local + Vite)

## Consumo anual por CUPS

- La SQLite del comparador se usa desde `sips_comparator.sqlite`.
- En este proyecto ese archivo puede ser un symlink a la base generada fuera del repo, para no duplicar gigas.
- El lookup remoto de consumo anual se resuelve contra una tabla `comparator_consumption` en un proyecto Supabase dedicado.
- Variables esperadas: `SUPABASE_CONSUMPTION_URL`, `SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY` y opcionalmente `SUPABASE_CONSUMPTION_TABLE`.
- Lookup en desarrollo:

```
npm run dev:full
```

- Para evitar errores en la UI cuando la tabla se haya vaciado o eliminado, puedes fijar:

```
DISABLE_ANNUAL_CONSUMPTION_LOOKUP=true
```

---
Este proyecto carga las tarifas desde `tarifas.v2.json` (única fuente). Para facilitar edición, se soportan dos formatos de productos:

- v1 (actual): `productos` es un objeto cuyas claves son los nombres de producto.
- v2 (bloques/arrays): `productos` es un array de objetos con metadatos claros y campos consistentes.

## Esquema v1 (compatibilidad externa, no usado por la app)

```
{
  "2.0TD": {
    "IGNIS": {
      "tarifaType": "2.0TD",
      "productos": {
        "TERRA SUPRA! 11": {
          "consumo": {"P1": 0.262845, "P2": 0.185739, "P3": 0.158108},
          "potencia": {"P1": 0.098439, "P2": 0.026568}
        }
      }
    }
  }
}
```

## Esquema v2 (formato activo)

```
{
  "2.0TD": {
    "IGNIS": {
      "metadata": {
        "comercializadora": "IGNIS",
        "ultimaActualizacion": "2025-11-11"
      },
      "productos": [
        {
          "nombre": "TERRA SUPRA! 11",
          "periodosConsumo": {"P1": 0.262845, "P2": 0.185739, "P3": 0.158108},
          "periodosPotencia": {"P1": 0.098439, "P2": 0.026568}
        },
        {
          "nombre": "TERRA SUPRA! 10",
          "periodosConsumo": {"P1": 0.256921, "P2": 0.179835, "P3": 0.152118},
          "periodosPotencia": {"P1": 0.098439, "P2": 0.026568}
        }
      ]
    }
  }
}
```

Notas:
- Para 2.0TD, potencia usa P1 y P2.
- Para 3.0TD, consumo y potencia usan P1..P6.
- Puedes añadir campos opcionales como `vigencia`, `canales`, `fuente`.

## Cómo editar de forma segura

1. Usa v2 (arrays) para mover/ordenar productos con facilidad. No habrá impacto perceptible en rendimiento.
2. Mantén precisiones decimales con punto `.`.
3. Sirve la app con un servidor local para que `fetch('./tarifas.v2.json')` funcione.

## Servir en local (Windows PowerShell)

```
python -m http.server 5500
```

Abre: http://localhost:5500/

## Validación rápida

- Si `productos` es array (v2), el código detecta `periodosConsumo` y `periodosPotencia`.

## Migrar a v2 automáticamente (opcional)

Si aún mantienes `tarifas.json` para otros procesos, incluimos un script para convertir `tarifas.json` → `tarifas.v2.json`:

```
python transform_to_v2.py
```

La app usa exclusivamente `tarifas.v2.json`.

## Exportar de v2 a v1 (opcional, si algún sistema lo requiere)

También puedes generar `tarifas.v1.json` a partir de `tarifas.v2.json`:

```
python transform_to_v1.py
```

Nota: La aplicación no necesita v1 si ya usas v2. Mantén un único archivo como “source of truth” para evitar inconsistencias.

## Fichero de ejemplo

Consulta `tarifas.schema.v2.example.json` para ver un bloque convertido a v2.

## Sistema de Comisiones

El comparador incluye un sistema flexible de comisiones que soporta:
- **Comisiones fijas** en euros por producto
- **Comisiones variables** según consumo anual (bloques de 5000 kWh)

### Archivo comisiones.json

El archivo `comisiones.json` define las comisiones por comercializadora y producto:

#### Ejemplo 1: Comisión Fija

```json
{
  "IGNIS": {
    "tipo": "fija",
    "default": 120,
    "productos": {
      "TERRA SUPRA! 11": 150,
      "TERRA SUPRA! 10": 140
    }
  }
}
```

#### Ejemplo 2: Comisión Variable por Consumo

```json
{
  "AUDAX": {
    "tipo": "variable",
    "bloques": [
      { "desde": 0, "hasta": 5000, "comision": 80 },
      { "desde": 5000, "hasta": 10000, "comision": 120 },
      { "desde": 10000, "hasta": 15000, "comision": 160 },
      { "desde": 15000, "hasta": null, "comision": 200 }
    ],
    "productos": {
      "AUDAX DINÁMICA 12": {
        "tipo": "fija",
        "comision": 145
      }
    }
  }
}
```

### Estructura

**Para comisiones fijas:**
- `tipo`: "fija"
- `default`: Comisión en euros para todos los productos
- `productos`: Objeto con comisiones específicas (opcional)
  - Puede ser un número directo: `"PRODUCTO": 150`
  - O un objeto completo: `"PRODUCTO": { "tipo": "fija", "comision": 150 }`

**Para comisiones variables:**
- `tipo`: "variable"
- `criterio`: "consumo" o "potencia" (por defecto: "consumo")
- `bloques`: Array de rangos según el criterio elegido
  - `desde`: Valor mínimo (kWh/año para consumo, kW para potencia)
  - `hasta`: Valor máximo - usar `null` para sin límite
  - `comision`: Cantidad en euros para ese rango
- `productos`: Puede sobreescribir configuración por producto específico

### Cómo actualizar comisiones

**1. Comisión fija simple:**
```json
"IBERDROLA": {
  "tipo": "fija",
  "default": 100,
  "productos": {}
}
```

**2. Comisión variable por bloques de consumo:**
```json
"GREENING ENERGY": {
  "tipo": "variable",
  "criterio": "consumo",
  "bloques": [
    { "desde": 0, "hasta": 5000, "comision": 85 },
    { "desde": 5000, "hasta": 10000, "comision": 125 }
  ],
  "productos": {}
}
```

**3. Comisión variable por potencia contratada:**
```json
"ENDESA": {
  "tipo": "variable",
  "criterio": "potencia",
  "bloques": [
    { "desde": 0, "hasta": 10, "comision": 80 },
    { "desde": 10, "hasta": null, "comision": 150 }
  ],
  "productos": {}
}
```

**4. Producto específico con comisión diferente:**
```json
"NATURGY": {
  "tipo": "variable",
  "criterio": "consumo",
  "bloques": [...],
  "productos": {
    "PRODUCTO ESPECIAL": {
      "tipo": "fija",
      "comision": 180
    }
  }
}
```

### Modos de ordenamiento

La interfaz ofrece dos botones en la tabla de resultados:

- **Mejor Ahorro**: Ordena por máximo ahorro para el cliente (criterio tradicional)
- **Mejor Comisión**: Ordena por las ofertas que te generan mayor comisión en euros

### Cálculo de comisión

**Comisión fija:**
```
Comisión = Valor definido en euros
```

**Comisión variable por consumo:**
```
1. El comercial ingresa CAE (Consumo Anual Estimado)
2. Se busca el bloque correspondiente según CAE
3. Comisión = Valor del bloque en euros
```

**Comisión variable por potencia:**
```
1. Se usa la Potencia P1 contratada (kW)
2. Se busca el bloque correspondiente
3. Comisión = Valor del bloque en euros
```

**Ejemplo práctico:**

Cliente con **CAE: 7,200 kWh/año** y **Potencia P1: 12 kW**

- **GREENING (consumo):** 7,200 kWh → bloque 5,000-10,000 → **€211**
- **ENDESA (potencia):** 12 kW → bloque >10 kW → **€150**
- **IBERDROLA (fija):** → **€105**

### Columna de comisión

La tabla de resultados muestra:
- **Cantidad en euros** directamente en la columna "Comisión"
- Ejemplo: `€ 150.00` para comisión fija o `€ 120.00` para variable

### Notas importantes

- Si falta `comisiones.json`, la app funciona normalmente sin mostrar comisiones
- Las comisiones NO afectan los cálculos de ahorro para el cliente
- El archivo se carga automáticamente al iniciar la aplicación
- **Criterio "consumo"**: Se evalúa según CAE (kWh/año)
- **Criterio "potencia"**: Se evalúa según Potencia P1 (kW)
- Si no se especifica `criterio`, por defecto se usa "consumo"
- El archivo se carga automáticamente al iniciar la aplicación

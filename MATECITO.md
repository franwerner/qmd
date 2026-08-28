# qmd — copia mantenida por matecito-ai

Buscador de records (EDRs y capability-specs) por significado, no por coincidencia literal.
matecito-ai lo distribuye y mantiene esta copia; no se consume desde npm.

## Procedencia

| | |
|---|---|
| Origen | https://github.com/tobi/qmd |
| Licencia | MIT (ver `LICENSE`, se conserva el copyright original) |
| Versión copiada | `v2.5.3` |
| Commit | `40fb36f` |
| Fecha de copia | 2026-08-15 |

Para traer cambios de arriba: comparar contra ese commit en el repo original y portar a mano.
La copia **no** conserva el `.git` del upstream.

## Qué agrega esta copia

Un segundo backend, `src/llm-openai.ts`, que habla con cualquier API compatible con OpenAI en lugar
de cargar modelos GGUF locales. El upstream declara `export interface LLM` con el comentario
*"implement this for different backends"*, así que `LlamaCpp` pasa a ser una implementación entre dos.

**Por qué existe.** Con modelos locales, una consulta nueva en una máquina modesta cuesta entre uno y
tres minutos —casi todo cargar el modelo, que se descarga y recarga más veces de las que se usa— y el
servidor retiene unos 4,7 GB de memoria entre búsquedas. Por API la misma consulta responde en
segundos y no retiene nada.

### Archivos tocados

- **`src/llm-openai.ts`** (nuevo) — la clase `OpenAICompatible` y el detector
  `isOpenAIBackendConfigured()`.
- **`src/llm.ts`** — nuevo tipo `LLMBackend` (la interfaz `LLM` más lo que el store realmente usa y
  la interfaz no declara: `embedBatch`, los tres `*ModelName`, `tokenize`/`detokenize`,
  `getDeviceInfo`), y una fábrica inyectable para que el singleton no dependa del backend nuevo.
- **`src/index.ts`**, **`src/store.ts`**, **`src/cli/qmd.ts`** — elección del backend y anotaciones de
  tipo ampliadas donde clavaban `LlamaCpp`.

**Ojo al portar cambios de arriba: el backend se construye en TRES lugares** —el store
(`index.ts`), el singleton global (`getDefaultLlamaCpp()`) y el CLI (`cli/qmd.ts`, que además pisa el
del store)—. Con uno solo sin cablear, `qmd embed` sigue intentando descargar un GGUF y falla con
`No model file found at …`.

### Configuración

```sh
QMD_OPENAI_BASE_URL=https://openrouter.ai/api/v1   # presencia = activar el backend por API
QMD_OPENAI_API_KEY=...                             # o OPENAI_API_KEY
QMD_EMBED_MODEL=openai/text-embedding-3-small
QMD_GENERATE_MODEL=openai/gpt-4o-mini              # expansión de consultas
```

Reordenamiento (opcional):

```sh
QMD_RERANK_URL=https://api.voyageai.com/v1/rerank
QMD_RERANK_API_KEY=...          # sólo si difiere de la de embeddings
QMD_RERANK_MODEL=rerank-2.5-lite
```

**El reordenamiento es la única operación sin estándar en el formato OpenAI.** Voyage, Cohere y Jina
tienen endpoint propio y los tres aceptan el mismo cuerpo; los routers tipo OpenRouter no tienen
ninguno. Sin `QMD_RERANK_URL` configurado, el orden de recuperación pasa tal cual — es un no-op
deliberado, no un error, porque ese orden ya es significativo y reordenar con un modelo de chat cuesta
un viaje más por búsqueda.

## Corriendo como servicio

Dos agregados más, que sólo importan cuando qmd queda levantado permanentemente en vez de invocarse
a mano.

**`--watch` (`src/watcher.ts`, nuevo).** Vigila las carpetas de las colecciones y reindexa lo que
cambió, con un período de calma por colección para no dispararse una vez por cada escritura del
editor. Cierra la ventana que más duele: un record escrito en mitad del flujo era invisible para lo
que corría después, y nada avisaba de la ausencia. Reindexar es por hash de contenido, así que una
pasada sobre archivos sin cambios no re-embebe nada ni cuesta nada.

Cada pasada cierra soltando los vectores que ya no referencia ningún documento activo. **No los
produce solo borrar:** el índice está indexado por hash de contenido, así que *cada edición* retira el
hash de la versión anterior y deja sus vectores colgados. Editar es lo que se hace todo el tiempo, de
modo que sin esto los restos solo se acumulan — se midieron 160 sobre 1283 (12%) en unos días de
trabajo. Es a propósito la parte angosta y no el `qmd cleanup` completo, que además borra el caché del
LLM y hace vacuum de la base entera: recuperar las páginas para reuso es lo que acota el crecimiento,
achicar el archivo sigue siendo una operación manual y deliberada.

**Ojo al portar cambios de arriba: las exclusiones se pasan por parámetro, no se leen adentro.**
`reindexCollection` tiene tres lugares que la llaman y cada uno tiene que pasarle `ignorePatterns`
desde el YAML; la fila que devuelve la base trae la ruta y el glob, pero no las exclusiones. Un
llamador nuevo que las olvide revierte en silencio cualquier `ignore` — los archivos excluidos vuelven
al índice a los segundos del próximo cambio en esa carpeta.

**El puerto se recuerda entre arranques.** Sin `--port`, el sistema operativo elige uno libre —un
puerto fijo choca apenas hay un segundo proyecto—, pero el elegido queda anotado y el arranque
siguiente vuelve a pedir ese mismo. Sin esto, cada reinicio movía el puerto y el registro del MCP
quedaba apuntando al anterior: el cliente falla con `ECONNREFUSED` y, desde el lado del agente, eso se
ve idéntico a que la búsqueda nunca se hubiera configurado.

Son dos archivos junto al log, en el directorio de caché de qmd, y significan cosas distintas:
`mcp.port` existe **mientras** hay un daemon sirviendo ahí y se borra al salir; `mcp.port.last`
sobrevive al proceso y es la memoria que se reusa. Si al arrancar el puerto recordado está ocupado por
otro, el servidor se corre a uno libre en vez de negarse a arrancar — pero un `--port` explícito no
cede, porque ahí el puerto lo pidió el usuario y tragarse el choque escondería un segundo daemon sobre
el mismo índice.

## Efectividad medida

Sobre `.matecito-ai/` — 119 records en dos colecciones, ~1000 fragmentos, 24 consultas parafraseadas
sin reusar vocabulario del título. Embeddings `text-embedding-3-small` vía OpenRouter, reordenamiento
`rerank-2.5-lite` de Voyage, `INDEX.md` excluidos.

| | top-1 | top-3 |
|---|---|---|
| EDRs | 66% | 83% |
| capability-specs | 41% | 75% |

Indexar 1094 fragmentos de 126 documentos: 1 minuto, sin modelos locales.

### Reglas de uso que salen de la medición

1. **Pedir cinco resultados o más, no tres.** Fue la mejora más grande de todas las probadas y no
   cuesta nada. El record correcto casi siempre está en la lista; lo que falla es asumir que está
   primero.
2. **Acotar por colección.** Sin filtro, los EDRs ganan el ranking incluso cuando se busca un spec.
3. **Excluir los `INDEX.md`.** Son tablas de navegación: matchean con todo y ensucian el primer
   puesto. Sacarlos subió los EDRs ocho puntos.
4. **En verificación, los resultados son candidatos a leer, no veredictos.** Un 83% significa que uno
   de cada seis records no aparece, y ahí un falso OK es peor que no buscar.

## Qué NO resuelve

No sustituye a los `INDEX.md`. El índice enumera: si el archivo existe, está la fila. Esto rankea, y
rankear admite omisiones que nadie ve. Para cobertura, el índice; para encontrar dentro de los cuerpos
cuando no recordás el vocabulario exacto, esto.

Queda un resto duro de specs que no aparece ni pidiendo diez —los de título más genérico—. Eso no se
arregla buscando mejor sino escribiendo mejor el spec.

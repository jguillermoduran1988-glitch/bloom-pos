# Bloom POS — Contexto del proyecto para Claude

> **INSTRUCCIÓN PARA CLAUDE:** Lee este archivo al inicio de cada conversación. Al final de cada sesión, o cuando se haga un cambio importante, actualiza este archivo con lo que se hizo. Mantén el historial de cambios al final.

---

## ¿Qué es este proyecto?

**Bloom POS** es una aplicación web PWA para una tienda de ropa de baño (Bloom). Combina:
- **CRM de WhatsApp** — gestión de chats con clientes, embudos de venta, etiquetas
- **POS (Punto de Venta)** — ventas, carrito, medios de pago, integración Shopify
- **Chat interno de equipo** — mensajería interna entre vendedoras
- **Estadísticas** — ventas por vendedor, canal, historial, cambios/garantías
- **Etiquetas de precio** — generador de etiquetas para imprimir (1.25x1 pulg)

---

## Stack técnico

| Componente | Tecnología |
|-----------|-----------|
| Frontend | HTML + JavaScript vanilla (sin frameworks) |
| Backend API | Cloudflare Worker (`worker.js`) |
| DB chat clientes | Cloudflare D1 (`bloom-wa`, binding `env.bloom_wa`) |
| DB resto del negocio | Supabase (PostgreSQL) |
| Hosting frontend | Cloudflare Pages (auto-deploy desde GitHub main) |
| Almacenamiento archivos | Supabase Storage (bucket `team-chat`) |
| Push notifications | Worker separado (`bloom-push`) |

---

## URLs importantes

| Servicio | URL |
|---------|-----|
| App (frontend) | https://bloom-dashboard-b1j.pages.dev |
| Worker API (backend) | https://bloomchat.jguillermoduran1988.workers.dev |
| Worker push | https://bloom-push.jguillermoduran1988.workers.dev |
| Supabase proyecto | https://qojehszkcuggmjxefvnv.supabase.co |
| Repositorio GitHub | https://github.com/jguillermoduran1988-glitch/bloom-pos |

---

## Archivos principales

| Archivo | Qué hace |
|---------|---------|
| `index.html` | Toda la UI — pantallas, modales, estilos CSS inline |
| `app.js` | Toda la lógica del frontend (~4300 líneas) |
| `worker.js` | Backend Cloudflare: webhook WhatsApp, envío mensajes, integración Shopify/Alegra |
| `config.js` | Configuración pública (URLs, clave anon Supabase, productos demo) |
| `sw.js` | Service Worker PWA — cache de assets |
| `colombia.js` | Datos de departamentos y ciudades de Colombia |

---

## Cómo desplegar

- **Frontend:** cualquier `git push origin main` desde `C:\Users\Usuario\bloom-pos` dispara auto-deploy en Cloudflare Pages automáticamente. No se necesita hacer nada más.
- **Worker backend:** requiere `wrangler deploy` manual desde la carpeta del proyecto (necesita credenciales Cloudflare).

**Carpeta de trabajo local:** `C:\Users\Usuario\bloom-pos`

> ⚠️ **Nota 2026-07-01**: la sesión de ese día se trabajó desde `D:\Usuario\Downloads\bloom-pos-main\bloom-pos-main` (una copia descargada del repo), NO desde `C:\Users\Usuario\bloom-pos`. Los cambios sí se pushearon a GitHub/`origin main` normalmente, así que producción está al día — pero `C:\Users\Usuario\bloom-pos` quedó desactualizada localmente. Antes de seguir editando ahí, hacer `git pull` primero.

---

## Cloudflare D1 — Chat de clientes (WhatsApp CRM)

Base de datos: `bloom-wa` (id: `9f398288-159e-46e5-9ebf-8ff290155d14`)

| Tabla | Contenido |
|-------|-----------|
| `wa_conversations` | Conversaciones WhatsApp (id=phone, stage, pipeline_id, last_message, etc.) |
| `wa_messages` | Mensajes de cada chat (id, conversation_id, direction, type, body, media_url, status, ts) |
| `wa_contacts` | Contactos WhatsApp (phone, name, email, avatar, tags) |

### Columnas clave de `wa_messages`
- `type` → `"text"` / `"image"` / `"audio"` / `"note"` (nota interna vendedor)
- `direction` → `"outbound"` / `"inbound"`
- `media_url` → URL pública del archivo en Supabase Storage
- `ts` → timestamp ISO

### Endpoints del Worker para chat de clientes
- `GET /wa/conversations` → lista conversaciones
- `GET /wa/conversations/:id/messages` → mensajes de una conversación
- `POST /wa/send` → enviar mensaje (texto, foto, audio, nota). Body: `{ conversation_id, phone, body, media_url, type }`
- `POST /wa/conversations/:id/read` → marcar como leído
- `PATCH /wa/conversations/:id` → actualizar stage, pipeline_id
- `PATCH /wa/contacts/:phone` → actualizar tags

### IMPORTANTE: Todo el chat de clientes va a D1 vía Worker
**NO usar `sbPost("messages", ...)` para el chat de clientes.** La tabla `messages` de Supabase ya no se usa para eso. Fotos, audios, texto y notas internas del chat de clientes se guardan todos con `POST /wa/send`.

---

## Supabase — Resto del negocio

| Tabla | Contenido |
|-------|-----------|
| `pipelines` | Embudos de venta (name, stages[], store) |
| `sales` | Ventas del POS |
| `sellers` / `users` | Vendedoras y cajeras |
| `pos_settings` | Config del POS: `shopify_draft`, `goal_plans`, `label_presets`, recibo |
| `team_messages` | Mensajes del chat interno de **equipo** (sí usa Supabase) |
| `exchanges` | Cambios y garantías |
| `customers` | Clientes registrados en el POS |
| `custom_orders` | Pedidos personalizados |

### Datos importantes guardados en `pos_settings`
- `goal_plans` → meta de ventas mensual + distribución por día (NO en localStorage)
- `label_presets` → plantillas de etiquetas de precio guardadas (NO en localStorage)

---

## Pantallas de la app (navegación inferior)

1. **Chats** — CRM WhatsApp con embudos, etiquetas, panel de cliente
2. **POS** — punto de venta con carrito, medios de pago, cajero/vendedor
3. **Equipo** — chat interno del equipo con fotos y notas de voz
4. **Datos** — estadísticas: Tienda, Ventas, Clientes, Personalizados, Cambios, Etiquetas
5. **Config** — ajustes: usuarios, pagos, Shopify, recibo, meta de ventas

---

## Reglas importantes al hacer cambios

1. **Siempre probar sintaxis JS** antes de commitear: `node --check app.js`
2. **No usar `await` en funciones no-async** — rompe todo el archivo JS
3. **El frontend lo sirve Cloudflare Pages**, no el Worker. Son cosas separadas.
4. **`pos_settings` en Supabase** guarda goal_plans y label_presets — no localStorage
5. **Al cambiar SW cache** subir el número de versión (`bloom-v91`, `bloom-v92`, etc.)
6. **Commitear desde** `C:\Users\Usuario\bloom-pos` y hacer push a `origin main`
7. **Chat de clientes → D1/Worker. Chat de equipo → Supabase.** No mezclar.
8. **Archivos (fotos/audio)** siempre se suben a Supabase Storage (`team-chat` bucket) con `sbUpload()`. La URL resultante se guarda en D1 (para chat clientes) o Supabase (para chat equipo).
9. **Para migrar columnas en D1:** `npx wrangler d1 execute bloom-wa --remote --command "ALTER TABLE ..."`

---

## Historial de sesiones con Claude

### 2026-07-01

#### Fix: venta POS no creaba el pedido en Shopify si no había stock
- **Causa raíz**: `createShopifyOrder` (worker.js) mandaba `inventory_behaviour: "decrement_obeying_policy"`. Si la variante tenía 0 unidades y política `DENY`, Shopify rechazaba la orden con un 422 — pero `app.js` nunca revisaba `shopify.ok`, así que la venta se guardaba en Supabase con `shopify_order_id:null` sin avisar a nadie.
- **Fix**: `worker.js` ahora usa `inventory_behaviour: "decrement_ignoring_policy"` (crea el pedido igual, aunque quede stock negativo) y soporta un campo opcional `created_at` en el payload para forzar la fecha del pedido. `app.js` ahora muestra un `alert()` si `shopify.ok` es falso, avisando al cajero en el momento.
- El precio que se manda a Shopify siempre fue el del POS (`it.price`), no el de catálogo — eso ya estaba bien, no hizo falta tocarlo.
- Worker desplegado con `wrangler deploy` (ya autenticado en esta máquina con la cuenta `jguillermoduran1988@gmail.com`).
- Venta afectada (Juliana Salazar Correa, 2026-06-30, $230.000) se creó manualmente en Shopify como pedido **#2273** vía el endpoint `/order` del propio worker (respetando fecha, cliente, precio real e inventario forzado) y se vinculó en Supabase (`shopify_order_id`/`shopify_order_name`).
- **Limitación descubierta**: la integración de Shopify vía MCP (claude.ai) NO puede crear/editar pedidos (`orderCreate`) aunque se le den todos los permisos — esa mutación requiere un token de acceso *offline*, y esa integración usa un token online. Para crear pedidos a mano en el futuro, hay que pasar por el endpoint `/order` del worker (que sí tiene el token privado con permisos), no por el MCP de Shopify directo.

#### Fix: bug de ancho en móvil (botones del header desaparecían) — ver sección "BUG 1 (RESUELTO)" más abajo
- Causa real: `.sidebar` le faltaba `min-width:0` como ítem de grid — un "grid blowout" al re-renderizar la lista de chats, no un problema de viewport.
- Diagnosticado agregando un indicador visual temporal (medía anchos reales con `getBoundingClientRect()`), ya removido del código.

#### Reporte Excel de ventas por colección
- Se generó `Ventas_SalidasBano_Ropa_22Abr_30Jun.xlsx` (en el Escritorio real del usuario, que está redirigido a `D:\Usuario\Desktop`, **no** `C:\Users\Usuario\Desktop`) con el detalle de ventas de las colecciones "Salidas De Baño" y "Ropa" entre el 22 de abril y el 30 de junio de 2026 (367 pedidos revisados, 256 líneas / 257 unidades vendidas de esas colecciones).
- Método: se trajeron todos los productos de ambas colecciones vía GraphQL (`collection.products`), luego todos los pedidos del rango con sus `lineItems`, y se cruzó por `product.id` con un script de Node (no vía MCP, por el límite de tokens de salida del tool).

#### Nota sobre esta sesión
- Se trabajó desde `D:\Usuario\Downloads\bloom-pos-main\bloom-pos-main`, no desde `C:\Users\Usuario\bloom-pos` (ver nota en "Cómo desplegar" más arriba). Todos los pushes fueron a `origin main` normalmente vía token personal (el usuario debe rotarlo, quedó expuesto en el chat en algún momento de la sesión).

---

### 2026-06-29
- Se agregó plus menu al chat de clientes (emoji, foto, nota de voz) — igual al chat de equipo
- Se descubrió que el chat de clientes usa D1/Worker, NO Supabase — se corrigió todo para usar `POST /wa/send`
- `attachChatPhoto`, `toggleChatVoice` y `addNote` ahora guardan en D1 vía `/wa/send`
- Worker `/wa/send` actualizado para aceptar `media_url` y `type` (image/audio/note/text)
- La columna `media_url` ya existía en `wa_messages` de D1
- Chat de equipo (pestaña Equipo) sigue en Supabase (`team_messages`) — eso está correcto
- Archivos (fotos/audio) se suben a Supabase Storage y la URL se guarda en D1
- SW cache en `bloom-v91`

### 2026-06-30 — Sesión 2 (tarde)

#### Fix: cliente no se vinculaba al pedido POS en Shopify
- **Causa raíz 1**: `findOrCreateShopifyCustomer` enviaba `addresses` con `province: "Atlántico"` (nombre); Shopify espera código ISO → 422 → creación fallaba silenciosamente → `null`
- **Causa raíz 2**: La búsqueda usaba `customers/search.json` (fuzzy, poco confiable); cambiado a `customers.json?email=xxx` y `customers.json?phone=+57xxx` (lookup exacto)
- **Causa raíz 3**: Fallback en `createShopifyOrder` usaba `phone` sin prefijo E.164 → Shopify lo ignoraba
- **Fix aplicado**: eliminados `addresses` de creación, lookup exacto por email/teléfono, retry en 422, phone formateado como `+57XXXXXXXXXX`, actualización de nombre siempre al encontrar cliente existente
- El Worker requiere deploy manual en Cloudflare (`worker.js` actualizado en GitHub)

#### Feat: borrar cliente desde Datos → Clientes
- Botón **🗑 Borrar** en el footer del modal de editar cliente (estilo `.modal-del`, rojo suave)
- Pide confirmación; si el cliente tiene compras avisa cuántas y aclara que las ventas NO se borran
- Las ventas en `sales` usan columnas planas (customer_name, email, etc.) — no hay FK, borrar cliente no afecta historial

#### Limpieza ventas de prueba (2026-06-30)
- Eliminadas 9 ventas de prueba de Supabase (D11–D19, clientes Lina Narvaez y Guillermo Duran)
- Draft orders D11–D19 en Shopify pendientes de borrar manualmente (Shopify admin → Pedidos preliminares)

#### Fix pedidos POS en Shopify
- `fulfillment_status: "fulfilled"` para todos los pedidos POS (no solo tienda)
- `tax_lines` con IVA 19% (`precio × 19/119`) en cada line_item — Shopify no lo calcula automáticamente en pedidos creados por API
- `price` explícito en items con `variant_id` — sin esto Shopify usa el precio de catálogo actual, no el precio cobrado

#### Fix módulo de cambios (Datos → Cambios)
- Precio de reembolso ahora usa el `total` pagado real (proporcional), no el precio de catálogo del item
- Worker retorna error claro si el pedido no existe en Shopify (antes daba "Not Found" críptico)
- Ventas creadas como draft order antiguas no se pueden cambiar desde el módulo (Shopify no las tiene como pedidos reales)

#### Fix WhatsApp webhook — migración D1 pendiente
- **Síntoma**: mensajes de WhatsApp no llegaban, error en logs: `D1_ERROR: no such column: last_direction: SQLITE_ERROR`
- **Causa**: el worker usaba la columna `last_direction` en `wa_conversations` pero nunca se había ejecutado la migración
- **Fix**: ejecutar vía API de Cloudflare D1:
  ```sql
  ALTER TABLE wa_conversations ADD COLUMN last_direction TEXT DEFAULT 'outbound'
  ```
- **Lección**: cada vez que el worker use una columna nueva en D1, ejecutar la migración ANTES de desplegar el worker
- Se puede ejecutar con el token Cloudflare guardado en memoria (`reference_cloudflare_token.md`)

---

### 2026-06-30 — Sesión 1 (mañana) — Lo que SE HIZO (funciona)

#### Borde completo en conversaciones asignadas
- `.chat-item.my-conv` y `.kb-card.my-conv`: ahora tienen `outline:2px solid var(--accent)` en los 4 lados (antes era solo borde izquierdo + fondo)
- Se eliminó el fondo `rgba` de los ítems asignados
- Kanban cards también muestran el borde dorado si `c.assigned_to === pos.currentUser.name`

#### Múltiples features de sesiones anteriores (ya en producción)
- **Panel cliente**: título "Datos cliente", muestra dirección, historial de compras con fechas
- **Auto-tag "recompra"**: se agrega automáticamente si el cliente tiene compras; configurable en Config Chat
- **Colores de etapa**: selector de color en el editor de embudos (`stage_colors` JSONB en Supabase `pipelines`)
- **Automatización seguimiento**: sección en Config Chat con reglas (embudo+etapa+tiempo+mensaje), Worker corre cada hora
- **Selector de etiquetas**: dropdown con etiquetas conocidas + crear nueva, reemplazó el input de texto
- **Productos**: abre inmediatamente con "Cargando…" mientras carga, luego muestra resultados
- **`sizes` en Worker**: `fetchShopify()` ahora computa el campo `sizes` por producto

#### Pendiente de migración en BD (NO ejecutados aún)
- Supabase: `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS stage_colors jsonb DEFAULT '{}';`
- Supabase: `ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS chat_config jsonb DEFAULT '{}';`
- D1: `ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS last_direction TEXT DEFAULT 'outbound';`
- Worker: `npx wrangler deploy` (para el cron de seguimiento automático)

---

### ✅ BUG 1 (RESUELTO 2026-07-01): Kanban/chat en móvil — botones del header "desaparecían"

**Síntoma**: Al volver de un chat o del tablero (kanban) en móvil, los 3 botones junto al logo (tablero, POS, datos + "en línea") dejaban de verse. El usuario reportó que en realidad la lista de chats se veía "más ancha" y como si siguiera de largo hacia la derecha.

**Causa raíz real** (encontrada con un indicador de debug temporal que medía anchos reales de elementos, no solo `window.innerWidth`):
`.sidebar` es un ítem de la grilla CSS `#screen-chats{display:grid}`. Los ítems de grid tienen `min-width:auto` por defecto — o sea que **no pueden achicarse por debajo del ancho del contenido interno más ancho (min-content)**. Al volver de un chat/tablero se vuelve a ejecutar `renderChatList()`, y si algún contenido dentro del sidebar no podía hacer wrap, el track de la grilla "explotaba" de 390px a ~707px para acomodarlo — arrastrando todo `.sidebar` (y por lo tanto los botones del header, que quedaban con `left:511` en una pantalla de 390px, fuera de vista) sin que `window.innerWidth`, `scrollWidth` ni `100vw` reflejaran el problema (por eso las primeras teorías sobre el viewport fallaron).

**Fix aplicado** (index.html, selector `.sidebar`):
```css
.sidebar{border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--surface)}
```
Se agregó `min-width:0` — el mismo patrón que ya tenía `min-height:0` para el overflow vertical del flex interno, pero le faltaba el equivalente horizontal para el grid externo.

**Intentos previos que NO funcionaron** (por si se repite algo parecido): tocar clases `chat-open`/`board-open`, `history.pushState`+`popstate`, reset del `<meta name="viewport">`, `overflow-x:hidden` + `max-width:100vw` en `html,body,.screen`. Todos atacaban el síntoma (viewport/overflow) en vez de la causa real (grid item sin `min-width:0`).

**Lección para bugs de "ancho" similares en el futuro**: medir el ancho real de los elementos sospechosos con `getBoundingClientRect()` (no solo `window.innerWidth`/`scrollWidth`), y revisar si son ítems de flex/grid sin `min-width:0` (o `min-height:0` en el eje vertical) antes de sospechar del viewport del navegador.

---

#### 🔴 BUG 2: Selector de productos Shopify — no carga en escritorio, se cierra en móvil

**Síntoma**:
- **Escritorio (desktop)**: Al tocar "Productos" en las acciones de la ficha de cliente, el modal se abre con "Cargando productos…" pero nunca muestra los productos.
- **Móvil**: El modal se abre pero "se cierra" (el usuario lo percibe así — puede ser que se cierre solo, o que quede vacío/inutilizable).

**Lo que se sabe**:
- El endpoint del Worker `GET /products?store=bloom` SÍ funciona y devuelve 600 productos (313 con stock > 0).
- CORS está configurado (`Access-Control-Allow-Origin: *`) y funciona para todos los demás endpoints.
- El Service Worker NO intercepta peticiones a `workers.dev` (excluido explícitamente en sw.js línea 17).
- `fetchProducts()` hace `fetch(WORKER_URL/products?store=bloom)` — si esto cuelga en el browser, nunca resuelve.

**Último estado del código** (app.js ~línea 1186):
```javascript
async function openPicker(){
  // muestra caché local primero si existe
  // luego fetchProducts() con AbortController de 14s timeout
  // si falla, usa caché o DEMO_PRODUCTS
}
```

**Hipótesis**: Puede ser que la primera vez (sin caché local) el fetch al Worker desde el browser tarda demasiado o falla silenciosamente. En móvil, el usuario puede estar cerrando el modal manualmente al ver que está vacío/cargando.

**Siguiente paso sugerido**: Agregar un mensaje de error visible si fetchProducts() no resuelve en tiempo. También vale verificar desde el browser (DevTools > Network) si la petición a /products realmente llega al Worker o se queda pendiente.

---

## Reglas importantes al hacer cambios

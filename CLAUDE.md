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

### 2026-06-29
- Se agregó plus menu al chat de clientes (emoji, foto, nota de voz) — igual al chat de equipo
- Se descubrió que el chat de clientes usa D1/Worker, NO Supabase — se corrigió todo para usar `POST /wa/send`
- `attachChatPhoto`, `toggleChatVoice` y `addNote` ahora guardan en D1 vía `/wa/send`
- Worker `/wa/send` actualizado para aceptar `media_url` y `type` (image/audio/note/text)
- La columna `media_url` ya existía en `wa_messages` de D1
- Chat de equipo (pestaña Equipo) sigue en Supabase (`team_messages`) — eso está correcto
- Archivos (fotos/audio) se suben a Supabase Storage y la URL se guarda en D1
- SW cache en `bloom-v91`

---

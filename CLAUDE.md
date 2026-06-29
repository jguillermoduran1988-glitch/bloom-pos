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
| Base de datos | Supabase (PostgreSQL) |
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

## Base de datos — tablas principales en Supabase

| Tabla | Contenido |
|-------|-----------|
| `contacts` | Clientes de WhatsApp (phone, name, tags, pipeline_id, stage) |
| `messages` | Mensajes de cada chat (contact_phone, body, direction, msg_type) |
| `pipelines` | Embudos de venta (name, stages[], store) |
| `sales` | Ventas del POS |
| `sellers` / `users` | Vendedoras y cajeras |
| `pos_settings` | Config del POS: `shopify_draft`, `goal_plans`, `label_presets`, recibo |
| `team_messages` | Mensajes del chat interno de equipo |
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

---

## Historial de sesiones con Claude

### 2026-06-29
- Se intentó agregar plus menu (emoji, foto, nota de voz) al chat de clientes igual que en chat de equipo
- Se cometió error: `await` en función no-async `saveMonthPlan()` rompió todo el app.js
- Se recuperó la versión local completa desde `C:\Users\Usuario\bloom-pos` y se hizo force push a main
- La versión local tenía ~302 líneas más que el repo (funciones del planificador, cajero, etc.)
- Se crearon 3 contactos de prueba en Supabase: Laura Martínez, Valentina Ríos, Carolina Gómez
- **Pendiente:** agregar plus menu al chat de clientes (emoji, foto, nota de voz) — guiarse del chat de equipo

---

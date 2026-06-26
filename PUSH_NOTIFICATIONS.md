# Notificaciones push Bloom PWA

Ya quedo preparado el flujo de notificaciones para el chat del equipo.

Archivos clave:

- `config.js`: tiene `VAPID_PUBLIC_KEY` y apunta `PUSH_WORKER_URL` a `https://bloom-push.jguillermoduran1988.workers.dev`.
- `push-client.js`: suscribe el celular cuando el usuario entra al chat del equipo.
- `sw.js`: recibe y muestra la notificacion.
- `push-worker.js`: envia las notificaciones Web Push.
- `wrangler.push.jsonc`: configura el despliegue del Worker `bloom-push`.
- `migracion3_push.sql`: crea la tabla `push_subscriptions` en Supabase.

Pasos finales:

1. Ejecuta `migracion3_push.sql` en Supabase.
2. En Cloudflare, crea o despliega el Worker `bloom-push` usando `push-worker.js`.
3. Agrega estos secretos al Worker `bloom-push`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
4. Si usas terminal, despliega con:

```bash
wrangler deploy --config wrangler.push.jsonc
```

Notas iPhone/iPad:

- iOS/iPadOS 16.4 o superior.
- La PWA debe estar instalada en pantalla de inicio.
- El permiso aparece al entrar o interactuar con el chat del equipo.

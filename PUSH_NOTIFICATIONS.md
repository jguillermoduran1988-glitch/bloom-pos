# Notificaciones push Bloom PWA

La PWA ya tiene el cliente (`push-client.js`) y el service worker (`sw.js`) preparados para recibir notificaciones del chat del equipo.

Para activar notificaciones reales en Android e iOS:

1. Genera claves VAPID.
2. Pega la clave publica en `CONFIG.VAPID_PUBLIC_KEY` dentro de `config.js`.
3. Ejecuta `migracion3_push.sql` en Supabase.
4. Agrega al Worker los endpoints:
   - `POST /push/subscribe`: guarda `subscription.endpoint`, `subscription.keys.p256dh`, `subscription.keys.auth`, `author_name` y `store` en `push_subscriptions`.
   - `POST /push/team-message`: lee las suscripciones activas de la tienda y envia Web Push a todos menos al autor.
5. En Cloudflare Worker define estos secretos:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`, por ejemplo `mailto:admin@tudominio.com`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`

Notas para iPhone/iPad:

- Debe ser iOS/iPadOS 16.4 o superior.
- La app debe estar instalada en la pantalla de inicio.
- El permiso se solicita cuando el usuario toca Equipo o entra al campo de mensaje.

Mientras `CONFIG.VAPID_PUBLIC_KEY` este vacio, el cliente no pedira permisos y no intentara suscribirse.

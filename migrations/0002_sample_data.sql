-- Datos de prueba para el inbox de WhatsApp

INSERT OR IGNORE INTO wa_contacts (phone, name, store, created_at, updated_at) VALUES
  ('3001234567', 'Valentina Torres', 'bloom', datetime('now', '-5 days'), datetime('now', '-2 hours')),
  ('3109876543', 'Camila Ruiz', 'bloom', datetime('now', '-10 days'), datetime('now', '-1 day')),
  ('3157894561', 'Mariana López', 'bloom', datetime('now', '-2 days'), datetime('now', '-30 minutes'));

INSERT OR IGNORE INTO wa_conversations (id, phone, store, status, last_message, last_message_at, unread_count, created_at, updated_at) VALUES
  ('conv-001', '3001234567', 'bloom', 'open', '¿Tienen el bikini en talla M?', datetime('now', '-2 hours'), 2, datetime('now', '-5 days'), datetime('now', '-2 hours')),
  ('conv-002', '3109876543', 'bloom', 'open', 'Perfecto, muchas gracias!', datetime('now', '-1 day'), 0, datetime('now', '-10 days'), datetime('now', '-1 day')),
  ('conv-003', '3157894561', 'bloom', 'open', 'Cuánto demora el envío a Medellín?', datetime('now', '-30 minutes'), 1, datetime('now', '-2 days'), datetime('now', '-30 minutes'));

INSERT OR IGNORE INTO wa_messages (id, conversation_id, direction, type, body, status, ts) VALUES
  ('msg-001', 'conv-001', 'inbound',  'text', 'Hola! Vi el bikini Princesa en Instagram 😍', 'read',      datetime('now', '-5 days', '+9 hours')),
  ('msg-002', 'conv-001', 'outbound', 'text', 'Hola Valentina! Sí lo tenemos, está disponible en negro, rojo y blanco 🌸', 'read', datetime('now', '-5 days', '+9 hours', '+5 minutes')),
  ('msg-003', 'conv-001', 'inbound',  'text', 'Qué precio tiene?', 'read',      datetime('now', '-5 days', '+10 hours')),
  ('msg-004', 'conv-001', 'outbound', 'text', 'El precio es $119.000 con envío incluido a toda Colombia 🚚', 'read', datetime('now', '-5 days', '+10 hours', '+3 minutes')),
  ('msg-005', 'conv-001', 'inbound',  'text', 'Perfecto lo quiero en negro talla S', 'read',      datetime('now', '-3 days')),
  ('msg-006', 'conv-001', 'outbound', 'text', 'Listo! Te comparto el link de pago 👇', 'read',     datetime('now', '-3 days', '+2 minutes')),
  ('msg-007', 'conv-001', 'inbound',  'text', '¿Tienen el bikini en talla M?', 'delivered', datetime('now', '-2 hours')),
  ('msg-008', 'conv-001', 'inbound',  'text', 'Es para mi hermana', 'delivered', datetime('now', '-2 hours', '+1 minute')),

  ('msg-010', 'conv-002', 'inbound',  'text', 'Buenas! Compré hace 3 días y no me ha llegado el tracking', 'read', datetime('now', '-1 day', '-3 hours')),
  ('msg-011', 'conv-002', 'outbound', 'text', 'Hola Camila! Un momento verificamos tu pedido 🔍', 'read', datetime('now', '-1 day', '-3 hours', '+5 minutes')),
  ('msg-012', 'conv-002', 'outbound', 'text', 'Tu pedido ya fue despachado, el tracking es CO123456789. Llega en 2-3 días hábiles 📦', 'read', datetime('now', '-1 day', '-2 hours')),
  ('msg-013', 'conv-002', 'inbound',  'text', 'Perfecto, muchas gracias!', 'read', datetime('now', '-1 day')),

  ('msg-020', 'conv-003', 'inbound',  'text', 'Hola! Me interesa el conjunto playero', 'read',      datetime('now', '-2 days')),
  ('msg-021', 'conv-003', 'outbound', 'text', 'Hola Mariana! Bienvenida 🌸 Tenemos varias opciones', 'read', datetime('now', '-2 days', '+10 minutes')),
  ('msg-022', 'conv-003', 'inbound',  'text', 'Cuánto demora el envío a Medellín?', 'delivered', datetime('now', '-30 minutes'));

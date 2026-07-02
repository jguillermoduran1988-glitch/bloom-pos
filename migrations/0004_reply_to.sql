-- Agrega soporte para "responder a un mensaje específico" (cita, como WhatsApp)
ALTER TABLE wa_messages ADD COLUMN reply_to TEXT;

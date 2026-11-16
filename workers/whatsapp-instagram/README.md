# Vetsa Instagram Operations

Worker privado de operaciones de Instagram para Dona. El webhook público se
mantiene separado del Worker de WhatsApp; el contenido de eventos, borradores
y conversaciones se cifra antes de almacenarse en D1.

## Flujo de Dona

1. Dona interpreta por IA las indicaciones del propietario y envía un comando
   autenticado por un Service Binding.
2. Una publicación, historia, reel, respuesta o campaña se crea como
   **borrador**. No se realiza ninguna acción externa todavía.
3. El propietario confirma desde WhatsApp. Solo entonces se ejecuta o activa.
4. Cada comentario recibido se deduplica. Una campaña activa puede enviar una
   única respuesta privada al comentario y registra su entrega.

Las respuestas manuales se restringen a conversaciones de Instagram abiertas
durante las últimas 24 horas. Las respuestas privadas a comentarios respetan
la ventana de siete días y el límite de una respuesta por comentario.

La API pública de Instagram no revela si una persona sigue la cuenta. Por eso
una campaña no debe prometer verificación automática de seguidores; puede
invitar a seguir la cuenta y continuar cuando la persona escriba a la cuenta.

## Requisitos de Meta pendientes

La infraestructura ya está desplegada, pero Meta debe conectar una cuenta
profesional antes de aceptar tráfico real:

1. En **Vetsa Manager > API de Instagram**, asignar a la cuenta el rol de
   evaluador y usar **Agregar cuenta** para iniciar sesión.
2. Generar un token de acceso de Instagram con `instagram_business_basic`,
   `instagram_business_manage_comments` e
   `instagram_business_manage_messages`.
3. Configurar y verificar el webhook
   `https://vetsa-instagram-operations.danihacks1900.workers.dev/instagram/webhook`.
4. Guardar estos secretos solo con Wrangler, nunca en el repositorio:

   - `INSTAGRAM_APP_SECRET`
   - `INSTAGRAM_VERIFY_TOKEN`
   - `INSTAGRAM_ACCESS_TOKEN`
   - `INSTAGRAM_ACCOUNT_ID`

5. Solicitar el acceso avanzado y publicar la app cuando la prueba con el rol
   de evaluador esté aprobada.

Los secretos de cifrado y de comunicación entre Workers ya están creados en
Cloudflare. No se incluyen aquí ni se necesitan copiar en Meta.

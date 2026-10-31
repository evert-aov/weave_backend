# 06 — Puente de IA

[Volver al índice](README.md)

`AiModule` conserva la API pública `POST /api/ai/chat` protegida por `JwtAuthGuard`.
NestJS reenvía la solicitud y FastAPI administra prompts, límites y el proveedor de generación.

```text
Navegador -- JWT --> NestJS /api/ai/chat
NestJS -- x-ai-service-token --> FastAPI /internal/chat
FastAPI -- credencial Google --> Vertex/Gemini
```

[ChatRequestDto](../src/modules/ai/dto/chat.dto.ts) admite `message`, historial opcional,
contexto de documento y `includeDocumentContext`. El puente normaliza historial nulo/ausente
a `[]`, la opción nula/ausente a `true`, y omite el documento cuando el usuario desactiva contexto.
`persistHistory` es `true` por defecto. En ese modo se ignora el historial enviado por el
navegador: FastAPI carga los mensajes del chat autorizado. Word usa el asistente principal;
`false` se mantiene para clientes internos sin estado.

NestJS toma `userId` de `@CurrentUser('id')`, después de validar el JWT, y lo transmite como
`x-weave-user-id` junto con el token interno. Nunca obtener esa identidad del cuerpo ni del
query string del cliente. `GET /api/ai/history` y `DELETE /api/ai/history` delegan lectura y
borrado en `/internal/history`; `before` permite recuperar páginas anteriores. NestJS no
crea una colección de mensajes ni almacena el historial.

[normalizeChatRequest](../src/modules/ai/dto/chat-limits.ts) acota el envío antes de serializarlo
para FastAPI: mensaje actual de hasta 12 000 caracteres; contexto de hasta 30 000; título de
hasta 500 y tipo de hasta 100. Para operaciones sin estado conserva hasta 20 mensajes recientes, un máximo de 12 000
caracteres por intervención y 24 000 en total. El mensaje actual no se recorta: si excede el
límite se devuelve `400`. Las URLs de datos binarias no se reenvían como texto de contexto.

[configureRequestBodies](../src/common/http/request-body.ts) instala primero un parser JSON
de 1 MiB para `/api/ai`, separado de los 100 MiB permitidos para el resto de documentos.
Nest arranca con `bodyParser: false` para respetar ese orden. CORS se registra antes de los
parsers, de modo que el navegador pueda leer los errores de tamaño. El middleware de error
devuelve un `413` con `code: PAYLOAD_TOO_LARGE`; registra método, ruta sin query, tamaño y
límite, sin el cuerpo, el contexto ni el stack completo.

El límite HTTP y el presupuesto del modelo son distintos: un error de `raw-body` ocurre antes
del controlador, de los DTOs y de FastAPI. El log de ruta permite distinguir un chat excesivo
de un guardado de documento grande. Aumentar el límite global no sustituye acotar el contexto.

La salida conserva `{ reply, model, provider, timestamp }`. No añadir la respuesta cruda de
Google al contrato público ni trasladar la clave del proveedor al frontend.

## Entorno y fallos

`AI_SERVICE_URL` y `AI_SERVICE_TOKEN` son obligatorios para usar el chat. El token debe coincidir
con FastAPI. `AI_SERVICE_TIMEOUT_MS` acota la espera del puente. Reiniciar NestJS después de
cambiar estas variables; no crear un fallback con una clave incrustada en TypeScript.

| Situación | Comportamiento público |
| --- | --- |
| Falta URL/token | 503, puente sin configurar. |
| Petición de IA superior a 1 MiB | 413, JSON legible con `PAYLOAD_TOO_LARGE`. |
| Mensaje actual de más de 12 000 caracteres | 400, dividir la consulta. |
| FastAPI rechaza el contrato con 422 | 400, indicando campo y tipo de error. |
| Hay otro turno en curso o se borró el historial durante la generación | 409, recargar la conversación. |
| Red, timeout u otro estado no exitoso | 502, mensaje del puente. |

Los registros de validación incluyen ubicaciones como `body.history.0.role (literal_error)`;
no incluyen `input` ni el cuerpo completo. El texto del documento y las credenciales no deben
aparecer en logs.

La [guía de FastAPI](../../ia/guia-desarrollador/README.md) describe el contrato interno y la
integración con Vertex y el [historial MongoDB](../../ia/guia-desarrollador/07-HISTORIAL-PERSISTENTE.md).
Este puente no aplica cambios al documento por su cuenta.

## Chats y edición

`conversationId` admite UUID o `default` y se valida antes de construir rutas internas. Las rutas
GET/POST `/api/ai/conversations` y PATCH/DELETE `/api/ai/conversations/:id` delegan todo el
almacenamiento a FastAPI. GET/DELETE `/api/ai/history` incluyen `conversationId` en query.
El propietario siempre viene del JWT, nunca del cuerpo. FastAPI verifica que ese usuario sea
propietario del chat antes de resolver su ámbito MongoDB.

`editTargets` admite 200 destinos `{id,text}`, hasta 15 000 caracteres por texto y un presupuesto
conjunto de 24 000. Se rechaza el exceso, no se recorta una operación de edición silenciosamente.
Con `includeDocumentContext: false` se omiten también los destinos editables. La respuesta puede
contener `edits: [{target,before,after}]`; el gateway los retransmite. Angular comprueba conflictos,
aplica en el editor vivo y utiliza las rutas normales de notas para guardar bajo el JWT. NestJS
no ejecuta instrucciones de texto, no expone archivos al modelo y no almacena conversaciones.

Actualizar las tres aplicaciones juntas y reiniciar FastAPI/NestJS al cambiar estos contratos.
No requiere migrar ni borrar MongoDB: `default` conserva el ámbito del historial anterior.

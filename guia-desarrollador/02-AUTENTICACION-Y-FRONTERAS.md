# 02 — Autenticación y fronteras

[Volver al índice](README.md)

## Sesión

[AuthController](../src/modules/auth/controllers/auth.controller.ts) expone:

| Método y ruta | Acceso y resultado |
| --- | --- |
| `POST /api/auth/register` | Público; crea usuario y devuelve token/perfil. |
| `POST /api/auth/login` | Público; devuelve token/perfil, HTTP 200. |
| `GET /api/auth/me` | JWT; devuelve el perfil actual. |

`AuthService` comprueba email, aplica bcrypt con salt de coste 10 y firma `{ sub, email }`.
El perfil no devuelve el hash. El esquema de usuario elimina `password` de su representación
JSON. La expiración configurada en `AuthModule` es `7d`.

[JwtStrategy](../src/common/strategies/jwt.strategy.ts) extrae Bearer, comprueba firma y
expiración y vuelve a buscar al usuario. Devuelve `id`, `email`, `name` y `role` para el request.
`@CurrentUser('id')` proporciona la identidad a los casos de uso.

## Propiedad

Las API de notas y espacios usan JWT y filtran por usuario. Un ID enviado por el cliente no
demuestra pertenencia. Mantener `userId` en todas las consultas de lectura, actualización y
borrado; no sustituirlas por búsquedas solo por ID al añadir una ruta.

El rol del usuario no implica un sistema de colaboración o permisos por documento ya
implementado. El botón de compartir del frontend copia el enlace; no crea automáticamente
una autorización para otro usuario.

## Validación y límites actuales

`ValidationPipe` usa `whitelist: true`, `transform: true` y `forbidNonWhitelisted: false`.
Los campos con decoradores sobreviven al filtrado. Los contratos de contenido flexible
(`docData`, contenido de bloques y algunos cuerpos específicos) no equivalen a una validación
profunda de cada motor externo.

El filtro CORS de [main.ts](../src/main.ts) acepta también orígenes no incluidos en la lista
configurada. La lista actual no funciona como restricción efectiva de origen. Los archivos
servidos por `ServeStaticModule` en `/uploads` son públicos, aunque la operación de subirlos
requiera JWT. Tenerlo presente al definir un despliegue con documentos confidenciales.

Existe un secreto JWT de respaldo en código; configurar `JWT_SECRET` explícitamente en el
entorno. El token interno de FastAPI debe ser independiente y nunca debe enviarse al navegador.
No copiar credenciales reales a ejemplos, tests, registros o documentación.

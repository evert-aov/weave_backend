# 05 — Espacios y assets

[Volver al índice](README.md)

## Espacios

[SpacesController](../src/modules/spaces/controllers/spaces.controller.ts) usa JWT:

| Método y ruta | Acción |
| --- | --- |
| `GET /api/spaces` | Lista; inicializa Research/Personal si no hay directorios. |
| `POST /api/spaces` | Crea raíz o hijo con `parentId`. |
| `PUT /api/spaces/:id` | Renombra, mueve o actualiza presentación. |
| `DELETE /api/spaces/:id` | Elimina directorio y descendientes. |

`SpacesService` calcula `path` a partir del padre. Al renombrar o mover, actualiza rutas de
descendientes y notas relacionadas. Rechaza mover un directorio dentro de sí mismo o de sus
descendientes. No confiar en la estructura del árbol enviada por Angular.

El borrado actual elimina directorios, no las notas que los referenciaban. No documentarlo como
borrado en cascada de documentos; las notas pueden conservar rutas cuyo directorio ya no existe.
Los IDs y la pertenencia por usuario se validan a través del repositorio.

## Archivos adjuntos

[AssetsController](../src/modules/assets/controllers/assets.controller.ts) expone:

| Método y ruta | Entrada |
| --- | --- |
| `POST /api/assets/upload` | Multipart, campo `file`. |
| `POST /api/assets/upload-base64` | `dataUrl` y nombre opcional. |
| `GET /uploads/...` | Lectura estática pública, fuera del guard del controlador de subida. |

Multer escribe archivos en `uploads/`, genera un nombre único y limita el multipart a 50 MiB.
Acepta imágenes, PDF y documentos Office por MIME o extensión admitida. El filtro no equivale a
inspeccionar el contenido binario. El flujo Base64 tiene una implementación separada y no pasa
por el límite multipart; comparte el límite JSON global.

`AssetsService` devuelve URL, nombre, MIME y tamaño. La URL se construye con protocolo/host de
la petición: configurar correctamente el proxy del despliegue si se necesita una base externa.
Los archivos del editor Word deben persistir como referencias durables; una URL Blob solo vive
en la sesión del navegador.

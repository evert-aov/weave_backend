# 03 — Notas y bloques

[Volver al índice](README.md)

## API de documentos

Todas las rutas requieren JWT:

| Método y ruta | Resultado |
| --- | --- |
| `GET /api/notes?space=...` | Vista completa histórica, con hidratación. |
| `GET /api/notes?view=summary&space=...` | Metadatos sin `blocks` ni `docData`; usada al iniciar Angular. |
| `GET /api/notes/:id` | Documento completo del propietario. |
| `POST /api/notes` | Crea documento estándar o especializado. |
| `PUT /api/notes/:id` | Actualiza metadatos/contenido. |
| `DELETE /api/notes/:id` | Elimina la nota y delega la limpieza especializada. |

[NotesController](../src/modules/notes/controllers/notes.controller.ts) interpreta `view=summary`.
No cambia por defecto el contrato de consumidores anteriores. La respuesta es un array directo,
sin envoltura `data` ni paginación implementada en este endpoint.

## Listado rápido

`NotesRepository` proyecta `_id`, `userId`, `title`, `lead`, `space`, `docType`, `docUrl`, `tags`
y timestamps. En modo resumido, `NotesService` omite la hidratación y retira contenido incluso
de una nota de bienvenida recién creada.

Si un usuario no tiene notas y consulta el ámbito inicial/todas, se crea la nota de bienvenida.
Por tanto, el primer GET puede inicializar datos. Una consulta vacía a un espacio no debe crear
otra bienvenida si el usuario ya tiene documentos en otra ubicación.

Al elegir un documento se llama a `getNoteById`, que comprueba el propietario y lee su contenido
especializado cuando corresponde. No devolver un resumen en una ruta de detalle ni usar un
resumen como cuerpo de actualización: se perdería la distinción entre metadatos y contenido.

## Bloques

`NoteBlocksService` administra inserción, actualización, eliminación y reordenamiento:

| Método y ruta | Operación |
| --- | --- |
| `POST /api/notes/:id/blocks` | Inserta un bloque y normaliza órdenes. |
| `PATCH /api/notes/:id/blocks/:blockId` | Actualiza contenido/metadatos del bloque. |
| `DELETE /api/notes/:id/blocks/:blockId` | Elimina el bloque y normaliza órdenes. |
| `PUT /api/notes/:id/blocks/reorder` | Reordena según `blockIds`. |

`NoteBlocksController` es el controlador dedicado. `NotesController` conserva delegaciones
de compatibilidad para esas mismas rutas; no añadir nuevas reglas a ambas copias. Una futura
consolidación debe preservar los paths y probar la integración antes de retirar una entrada.

Los tipos admitidos son `text`, `canvas`, `latex`, `image`, `sheet`, `code`, `mermaid` y `file`.
El reordenamiento conserva IDs y añade al final los bloques que no aparezcan en la lista enviada.

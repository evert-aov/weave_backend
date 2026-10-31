# 01 — Datos y repositorios

[Volver al índice](README.md)

Los esquemas Mongoose se encuentran en las carpetas `entities/` de cada módulo. No existe
una base SQL en este backend.

| Entidad | Contenido principal |
| --- | --- |
| `User` | Nombre, email único normalizado, hash de contraseña, rol y avatar. |
| `Note` | Propietario, título, espacio, tipo, URL física, etiquetas y bloques. |
| `Block` | Subdocumento con ID propio, tipo, orden, contenido y metadatos. |
| `Space` | Propietario, nombre, padre, ruta calculada, color, orden e icono. |

`Note` y `Space` usan timestamps. Los bloques tienen `_id: false` y conservan su `id` funcional.
No regenerar esos IDs para resolver cambios de orden o compatibilidad.

## Persistencia híbrida

```text
MongoDB: nota + metadatos + bloques + referencia docUrl
Disco:   JSON de Word/hojas/canvas o binario PPTX
```

El tipo estándar `block` conserva su contenido en `blocks`. Los tipos especializados se
persisten mediante `SpecializedDocumentsService`; su `docData` se hidrata para respuestas
completas y se omite del listado resumido.

## Consultas e índices

[NotesRepository](../src/modules/notes/repositories/notes.repository.ts) filtra consultas por
`userId` y, cuando corresponde, `_id`. El filtro opcional `space` incluye la ruta y sus
descendientes; escapa el texto antes de construir la expresión regular.

La vista resumida aplica una proyección explícita de metadatos. `hasNotes()` usa una consulta
de existencia para decidir si corresponde crear la nota de bienvenida sin descargar todas
las notas de otros espacios.

Índices declarados:

| Colección | Índice |
| --- | --- |
| Notas | `{ userId: 1, space: 1, updatedAt: -1 }` |
| Espacios | `{ userId: 1, parentId: 1, order: 1 }` y `{ userId: 1, name: 1 }` |
| Usuarios | Email único por definición del esquema. |

El listado de notas se ordena por actualización. El listado de espacios se ordena actualmente
por creación; no confundir el índice `order` con una ordenación ya aplicada en ese repositorio.
Para diagnosticar consultas lentas, medir el plan de MongoDB y los bytes proyectados antes de
añadir nuevos índices o descargar contenidos completos para filtrar en Node.

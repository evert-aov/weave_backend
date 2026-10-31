# Guía del desarrollador — backend NestJS de Weave

El backend expone la API pública de Weave, valida sesiones JWT y conserva documentos privados
por usuario. Usa MongoDB para identidad y metadatos, disco local para archivos especializados
y un puente HTTP interno hacia FastAPI para generación de IA.

## Contenido

| Capítulo | Tema |
| --- | --- |
| [00 — Arquitectura y configuración](00-ARQUITECTURA-Y-CONFIGURACION.md) | Módulos, entorno y arranque. |
| [01 — Datos y repositorios](01-DATOS-Y-REPOSITORIOS.md) | Usuarios, notas, bloques, espacios e índices. |
| [02 — Autenticación y fronteras](02-AUTENTICACION-Y-FRONTERAS.md) | JWT, propiedad, validación y comportamiento actual. |
| [03 — Notas y bloques](03-NOTAS-Y-BLOQUES.md) | API, vista resumida, lectura completa y mutaciones. |
| [04 — Documentos y archivos](04-DOCUMENTOS-Y-ARCHIVOS.md) | Word, hojas, canvas, PPTX y almacenamiento físico. |
| [05 — Espacios y assets](05-ESPACIOS-Y-ASSETS.md) | Jerarquía, rutas y subidas. |
| [06 — Puente IA](06-PUENTE-DE-IA.md) | Contrato público, FastAPI y diagnóstico. |
| [07 — Rendimiento y operación](07-RENDIMIENTO-PRUEBAS-Y-OPERACION.md) | Pruebas, consultas y despliegue. |
| [08 — Directorios y flujos](08-MAPA-DE-DIRECTORIOS-Y-FLUJOS.md) | Responsabilidades y extensión. |

| [09 — LaTeX](09-LATEX.md) | Fuentes en Mongo, compilación aislada, paquetes, límites y operación. |

## Inicio rápido

Desde `backend/`, con MongoDB disponible:

```sh
npm ci
cp .env.example .env
# completar JWT_SECRET, conexión Mongo y puente IA si se va a utilizar
npm run start:dev
```

La API usa `http://localhost:3000/api`. Iniciar el proceso desde `backend/`: la configuración
y las rutas de archivos se resuelven respecto al directorio de ejecución. No sobrescribir
un `.env` existente al seguir el ejemplo.

## Verificación

```sh
npm test -- --runInBand
npm run build
```

Las pruebas sustituyen repositorios y proveedores. No equivalen a probar una instancia real de
MongoDB ni una generación cloud. Al cambiar contratos, verificar también los consumidores en
las guías de [Angular](../../frontend/guia-desarrollador/README.md) y
[FastAPI](../../ia/guia-desarrollador/README.md).

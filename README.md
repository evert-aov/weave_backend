# Weave Backend 🚀

> API REST escalable y robusta para la plataforma **Weave**, construida con **NestJS 12** y **MongoDB**.

Consultar la [guía del desarrollador](guia-desarrollador/README.md) para arquitectura,
contratos, persistencia física, integración con FastAPI, pruebas y operación.

---

## 📋 Descripción

El backend de **Weave** proporciona todos los servicios centrales para la persistencia, autenticación, gestión de documentos por bloques, categorización por espacios de trabajo y almacenamiento de activos multimedia.

---

## 🏛️ Arquitectura de Módulos

```
src/
├── app.module.ts              # Módulo raíz y configuración global (Config, Mongoose, Static)
├── main.ts                    # Bootstrap del servidor, CORS, ValidationPipes y carpeta uploads
├── common/                    # Pipes, interceptores, guards y decoradores compartidos
│
└── modules/
    ├── auth/                  # Autenticación, registro, login y validación de tokens JWT
    │   ├── controllers/       # AuthController (/api/auth)
    │   ├── services/          # AuthService
    │   └── entities/          # User schema (Mongoose); JWT en common/strategies/
    │
    ├── notes/                 # Gestión completa de notas y su estructura por bloques
    │   ├── controllers/       # NotesController (/api/notes)
    │   ├── services/          # Notas, bloques, documentos especializados y archivos
    │   ├── dto/               # CreateNoteDto, UpdateNoteDto y DTOs de bloques
    │   └── entities/          # Note schema y Block sub-schemas (Mongoose)
    │
    ├── spaces/                # Espacios de trabajo y categorización de notas
    │   ├── controllers/       # SpacesController (/api/spaces)
    │   ├── services/          # SpacesService
    │   └── entities/          # Space schema
    │
    ├── ai/                    # Puente HTTP autenticado hacia FastAPI
    └── assets/                # Subida de imágenes y archivos multimedia
        ├── controllers/       # AssetsController (/api/assets)
        └── services/          # AssetsService (Multer, validación de MIME types)
```

---

## 🔌 Endpoints de la API

### Autenticación (`/api/auth`)
| Método | Endpoint | Descripción | Acceso |
|---|---|---|---|
| `POST` | `/api/auth/register` | Registro de nuevo usuario | Público |
| `POST` | `/api/auth/login` | Inicio de sesión y entrega de JWT | Público |
| `GET` | `/api/auth/me` | Obtener datos del perfil actual | Privado (JWT) |

### Notas y Bloques (`/api/notes`)
| Método | Endpoint | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/api/notes` | Listar todas las notas (filtrables por espacio) | Privado (JWT) |
| `GET` | `/api/notes?view=summary` | Listado de metadatos sin bloques ni lecturas de archivos | Privado (JWT) |
| `GET` | `/api/notes/:id` | Obtener una nota específica con sus bloques | Privado (JWT) |
| `POST` | `/api/notes` | Crear una nueva nota | Privado (JWT) |
| `PUT` | `/api/notes/:id` | Actualizar metadatos, título o lead de una nota | Privado (JWT) |
| `DELETE` | `/api/notes/:id` | Eliminar una nota | Privado (JWT) |
| `PATCH` | `/api/notes/:id/blocks/:blockId` | Actualizar contenido de un bloque individual | Privado (JWT) |
| `POST` | `/api/notes/:id/blocks` | Agregar un nuevo bloque a la nota | Privado (JWT) |
| `DELETE` | `/api/notes/:id/blocks/:blockId` | Eliminar un bloque de la nota | Privado (JWT) |
| `PUT` | `/api/notes/:id/blocks/reorder` | Reordenar bloques por identificador | Privado (JWT) |
| `GET/PUT` | `/api/notes/:id/document` | Leer o actualizar el contenido especializado | Privado (JWT) |

### Espacios (`/api/spaces`)
| Método | Endpoint | Descripción | Acceso |
|---|---|---|---|
| `GET` | `/api/spaces` | Listar todos los espacios de trabajo | Privado (JWT) |
| `POST` | `/api/spaces` | Crear un nuevo espacio | Privado (JWT) |
| `PUT` | `/api/spaces/:id` | Renombrar o mover el espacio | Privado (JWT) |
| `DELETE` | `/api/spaces/:id` | Eliminar un espacio | Privado (JWT) |

### Multimedia y Assets (`/api/assets`)
| Método | Endpoint | Descripción | Acceso |
|---|---|---|---|
| `POST` | `/api/assets/upload` | Subir archivo de imagen (PNG, JPEG, WebP) | Privado (JWT) |
| `POST` | `/api/assets/upload-base64` | Persistir una imagen Base64 | Privado (JWT) |
| `GET` | `/uploads/:filename` | Servir archivos estáticos subidos | Público |

### IA (`/api/ai`)

`POST /api/ai/chat` exige JWT y reenvía el cuerpo a FastAPI. Configurar
`AI_SERVICE_URL` y `AI_SERVICE_TOKEN` en NestJS; las credenciales de Google viven en `ia/.env`.

---

## ⚙️ Configuración y Variables de Entorno

Crea un archivo `.env` o `.env.local` en la raíz de `backend/`:

```env
# Puerto del servidor (por defecto 3000)
PORT=3000

# Cadena de conexión de MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/weave_db

# Clave secreta para la firma de JSON Web Tokens
JWT_SECRET=tu_clave_secreta_jwt_muy_segura

# Tiempo de expiración del token
JWT_EXPIRES_IN=7d

# Puente interno de IA
AI_SERVICE_URL=http://127.0.0.1:8000
AI_SERVICE_TOKEN=the_same_secret_configured_in_ia
AI_SERVICE_TIMEOUT_MS=90000
```

La expiración del JWT está actualmente fijada en `7d` en el módulo; `JWT_EXPIRES_IN` no
modifica ese valor. Los archivos se almacenan en `uploads/` desde el directorio de ejecución.

---

## 🚀 Instalación y Ejecución

```bash
# 1. Instalar dependencias
npm install

# 2. Modo desarrollo con recarga automática
npm run start:dev

# 3. Compilación para producción
npm run build

# 4. Ejecución en producción
npm run start:prod
```

---

## 🧪 Pruebas Automatizadas

```bash
# Pruebas unitarias
npm run test

# Pruebas con observador (watch)
npm run test:watch

# Cobertura de código
npm run test:cov

# Pruebas End-to-End (e2e)
npm run test:e2e
```

---

## 🛡️ Seguridad y Buenas Prácticas
- **CORS habilitado**: La implementación actual acepta orígenes dinámicos; no aplica una lista blanca estricta.
- **Validación Automática de DTOs**: `ValidationPipe` global con sanitización de campos y transformación tipada.
- **Hashing Seguro de Contraseñas**: Implementación con `bcryptjs` con salt rounds reforzados.
- **Estructura Modular**: Principios SOLID y arquitectura desacoplada basada en la inyección de dependencias nativa de NestJS.

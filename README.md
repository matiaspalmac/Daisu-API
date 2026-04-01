# Daisu API

API REST y servidor WebSocket para **Daisu**, plataforma de intercambio de idiomas. Construida con Express 5, Socket.IO, Turso (LibSQL) y autenticacion JWT.

## Stack Tecnologico

- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Tiempo real**: Socket.IO 4
- **Base de datos**: Turso (LibSQL / SQLite alojado)
- **Autenticacion**: JWT (jsonwebtoken + bcrypt)
- **Validacion**: Zod 4
- **Seguridad**: Helmet, CORS, rate limiting
- **Documentacion**: Swagger UI (swagger-jsdoc)
- **Deteccion de idioma**: franc-min

## Arquitectura

El proyecto sigue una arquitectura modular. Las rutas se auto-descubren desde `src/modules/` — cualquier archivo `*.routes.js` se monta automaticamente en `/api`.

```
├── index.js                  # Punto de entrada — servidor HTTP, Socket.IO, shutdown
├── app.js                    # App Express — middlewares, rutas, manejo de errores
├── middleware/
│   ├── auth.js               # Generacion JWT, guards de autenticacion y autorizacion
│   ├── rate-limit.js         # Rate limiters (auth, api, write)
│   └── validate.js           # Middleware de validacion con Zod
├── docs/
│   └── swagger.js            # Especificacion OpenAPI/Swagger
└── src/
    ├── config/
    │   ├── index.js           # Configuracion global
    │   ├── database.js        # Cliente LibSQL
    │   └── cors.js            # Opciones CORS
    ├── db/
    │   ├── index.js           # Runner de migraciones
    │   ├── migrations/        # Migraciones SQL
    │   └── seeds/             # Datos iniciales (salas, logros, membresías)
    ├── modules/               # Modulos de funcionalidad (auto-descubiertos)
    │   ├── auth/              # Login, registro, reset de contrasena
    │   ├── users/             # Perfiles, exportacion de datos (GDPR)
    │   ├── user-settings/     # Personalizacion de perfil
    │   ├── chat/              # Salas, mensajes, edicion/borrado
    │   ├── dms/               # Mensajes directos
    │   ├── social/            # Seguimiento, reportes
    │   ├── notifications/     # Notificaciones push
    │   ├── achievements/      # Logros, XP
    │   ├── vocabulary/        # Flashcards, repaso espaciado
    │   ├── quizzes/           # Quizzes diarios de idiomas
    │   ├── events/            # Eventos comunitarios
    │   ├── resources/         # Materiales de aprendizaje
    │   ├── news/              # Articulos y novedades
    │   ├── memberships/       # Planes de suscripcion (free/pro/premium)
    │   ├── corrections/       # Correcciones entre pares
    │   ├── search/            # Busqueda global (usuarios, salas, mensajes)
    │   ├── trending/          # Tendencias (salas, usuarios, palabras)
    │   ├── stats/             # Estadisticas, heatmap, leaderboard
    │   ├── room-invites/      # Gestion de membresía de salas
    │   ├── admin/             # Panel admin, acciones masivas
    │   └── analytics/         # Analiticas de plataforma
    ├── sockets/               # Handlers de WebSocket en tiempo real
    │   ├── index.js           # Orquestador de conexiones
    │   ├── middleware.js       # Auth JWT para sockets
    │   ├── helpers.js         # Utilidades de salas/usuarios
    │   ├── chat.sockets.js    # Eventos de chat (enviar, editar, borrar, responder)
    │   ├── dm.sockets.js      # Eventos de mensajes directos
    │   ├── corrections.sockets.js  # Eventos de correcciones
    │   └── moderation.sockets.js   # Ban, mute, advertencias
    ├── services/
    │   ├── cleanup.js         # Tareas periodicas (notificaciones expiradas, rachas)
    │   └── streaks.js         # Logica de calculo de rachas
    └── routes.js              # Router de auto-descubrimiento
```

Cada modulo contiene tipicamente:
- `*.routes.js` — Definicion de rutas
- `*.service.js` — Logica de negocio
- `*.errors.js` — Errores personalizados del modulo

## Configuracion

### 1. Clonar el repositorio

```bash
git clone <url-del-repositorio>
cd Daisu-API
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Variables de entorno

Copiar el archivo de ejemplo y configurar los valores:

```bash
cp .env.example .env
```

| Variable | Requerida | Default | Descripcion |
|---|---|---|---|
| `DB_URL` | Si | — | URL de la base de datos Turso |
| `DB_TOKEN` | Si | — | Token de autenticacion de Turso |
| `PORT` | No | `3001` | Puerto del servidor |
| `JWT_SECRET` | No | `change-me-in-production` | Secreto para firmar JWT |
| `JWT_EXPIRES_IN` | No | `7d` | Tiempo de expiracion del token |
| `ALLOWED_ORIGINS` | No | `*` | Origenes CORS permitidos (separados por coma) |
| `NODE_ENV` | No | `development` | Modo del entorno |

### 4. Iniciar el servidor

```bash
# Desarrollo (auto-reload con nodemon)
npm run dev

# Produccion
npm start
```

El servidor inicia en `http://localhost:3001` por defecto.

## Scripts Disponibles

| Script | Comando | Descripcion |
|---|---|---|
| `dev` | `npm run dev` | Inicia el servidor con nodemon (auto-reload) |
| `start` | `npm start` | Inicia el servidor en modo produccion |

## Documentacion de la API

La documentacion interactiva completa esta disponible via Swagger UI en:

```
http://localhost:3001/api/docs
```

Incluye todos los endpoints, esquemas de request/response y la posibilidad de probar los endpoints directamente.

## Autenticacion

Todos los endpoints requieren `Authorization: Bearer <token>` a menos que se indique lo contrario. Los tokens se obtienen al hacer login o registro.

## WebSockets

Conectar al servidor WebSocket en `ws://localhost:3001` con path `/api/socket`:

```js
const socket = io('http://localhost:3001', {
  path: '/api/socket',
  auth: { token: 'tu-jwt-token' }
});
```

Eventos disponibles para chat en tiempo real, mensajes directos, correcciones entre pares y moderacion.

## Rate Limits

| Ambito | Ventana | Max Requests |
|---|---|---|
| Endpoints de auth | 1 min | 10 |
| API general | 1 min | 100 |
| Operaciones de escritura | 1 min | 30 |
| Mensajes por socket | 30 seg | 15 |

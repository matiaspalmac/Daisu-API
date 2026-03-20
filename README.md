# Daisu API

REST API + WebSocket server for **Daisu**, a social language-learning platform. Built with Express 5, Socket.IO, Turso (LibSQL), and JWT authentication.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Development (auto-reload)
npm run dev

# Production
npm start
```

The server starts on `http://localhost:3001` by default.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_URL` | Yes | — | Turso database URL |
| `DB_TOKEN` | Yes | — | Turso auth token |
| `PORT` | No | `3001` | Server port |
| `JWT_SECRET` | No | `change-me-in-production` | JWT signing secret |
| `JWT_EXPIRES_IN` | No | `7d` | Token expiration |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS origins |
| `NODE_ENV` | No | `development` | Environment mode |

## Project Structure

```
├── index.js                  # Entry point — HTTP server, Socket.IO, graceful shutdown
├── app.js                    # Express app — middleware, routes, error handling
├── middleware/
│   ├── auth.js               # JWT generation, auth & authorization guards
│   ├── rate-limit.js         # Rate limiters (auth, api, write)
│   └── validate.js           # Zod schema validation middleware
├── docs/
│   └── swagger.js            # OpenAPI/Swagger spec
└── src/
    ├── config/
    │   ├── index.js           # Global configuration
    │   ├── database.js        # LibSQL client
    │   └── cors.js            # CORS options
    ├── db/
    │   ├── index.js           # Migration runner
    │   ├── migrations/        # 22 SQL migrations
    │   └── seeds/             # Initial data (rooms, achievements, memberships)
    ├── modules/               # Feature modules (auto-discovered)
    │   ├── auth/              # Login, register, password reset
    │   ├── users/             # Profiles, data export (GDPR)
    │   ├── user-settings/     # Profile customization
    │   ├── chat/              # Rooms, messages, edit/delete
    │   ├── dms/               # Direct messages
    │   ├── social/            # Follows, reports
    │   ├── notifications/     # Push notifications
    │   ├── achievements/      # Badges, XP
    │   ├── vocabulary/        # Flashcards, spaced repetition
    │   ├── quizzes/           # Daily language quizzes
    │   ├── events/            # Community events
    │   ├── resources/         # Learning materials (textbooks, videos)
    │   ├── news/              # Articles and updates
    │   ├── memberships/       # Subscription tiers (free/pro/premium)
    │   ├── corrections/       # Peer message corrections
    │   ├── search/            # Global search (users, rooms, messages)
    │   ├── trending/          # Trending rooms, users, words
    │   ├── stats/             # User stats, heatmap, leaderboard
    │   ├── room-invites/      # Room membership management
    │   ├── admin/             # Admin dashboard, bulk actions
    │   └── analytics/         # Platform analytics
    ├── sockets/               # Real-time WebSocket handlers
    │   ├── index.js           # Connection orchestrator
    │   ├── middleware.js       # Socket JWT auth
    │   ├── helpers.js         # Room/user tracking utilities
    │   ├── chat.sockets.js    # Chat events (send, edit, delete, reply)
    │   ├── dm.sockets.js      # Direct message events
    │   ├── corrections.sockets.js  # Peer correction events
    │   └── moderation.sockets.js   # Ban, mute, warnings
    ├── services/
    │   ├── cleanup.js         # Periodic tasks (expired notifications, streaks)
    │   └── streaks.js         # Streak calculation logic
    └── routes.js              # Auto-discovery router
```

Routes are auto-loaded from `src/modules/` — any `*.routes.js` file is mounted at `/api` automatically.

## API Overview

### Authentication
All endpoints require `Authorization: Bearer <token>` unless marked as public.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/login` | No | Login, returns JWT |
| `POST` | `/api/createuser` | No | Register, returns JWT |
| `POST` | `/api/forgot-password` | No | Request password reset |
| `POST` | `/api/reset-password` | No | Reset password with token |
| `POST` | `/api/change-password` | Yes | Change current password |

### Chat & Messages
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rooms` | List chat rooms |
| `POST` | `/api/rooms` | Create a room |
| `GET` | `/api/rooms/:id/messages` | Get room messages |
| `PATCH` | `/api/messages/:id` | Edit message (15 min window) |
| `DELETE` | `/api/messages/:id` | Soft delete message |

### Direct Messages
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dms` | List conversations |
| `POST` | `/api/dms` | Start conversation |
| `GET` | `/api/dms/:id/messages` | Get DM messages |
| `POST` | `/api/dms/:id/messages` | Send DM |

### Users & Social
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users/:id` | User profile |
| `POST` | `/api/users/:id/follow` | Follow/unfollow toggle |
| `POST` | `/api/report` | Report user/content |
| `GET` | `/api/users/:id/export` | Export user data (GDPR) |

### Learning Features
| Method | Endpoint | Description |
|---|---|---|
| `GET/POST` | `/api/vocabulary` | Manage flashcards |
| `GET` | `/api/vocabulary/review` | Get cards for review |
| `POST` | `/api/vocabulary/:id/review` | Submit review result |
| `GET` | `/api/quizzes/daily` | Daily language quiz |
| `POST` | `/api/quizzes/:id/attempt` | Submit quiz answers |
| `POST` | `/api/messages/:id/correct` | Peer correction |

### Content (Public)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/news` | Articles and updates |
| `GET` | `/api/news/:slug` | Article detail |
| `GET` | `/api/resources` | Learning materials |
| `GET` | `/api/memberships/plans` | Subscription plans |

### Stats & Discovery
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/user/stats/:id` | User statistics |
| `GET` | `/api/user/stats/:id/heatmap` | Activity heatmap (365 days) |
| `GET` | `/api/leaderboard` | XP leaderboard |
| `GET` | `/api/trending/rooms` | Trending chat rooms |
| `GET` | `/api/search?q=` | Global search |

### Admin
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/dashboard` | Aggregated stats |
| `POST` | `/api/admin/bulk/ban-users` | Bulk ban |
| `POST` | `/api/admin/system-announcement` | System announcement |

Full interactive docs available at `/api/docs` (Swagger UI).

## WebSocket Events

Connect to `ws://localhost:3001` with path `/api/socket` and auth token:

```js
const socket = io('http://localhost:3001', {
  path: '/api/socket',
  auth: { token: 'your-jwt-token' }
});
```

### Chat
| Emit | Listen | Description |
|---|---|---|
| `send-message` | `new-message` | Send/receive messages |
| `edit-message` | `message-edited` | Edit a message |
| `delete-message` | `message-deleted` | Delete a message |
| `join-room` | `user-joined` | Join a chat room |
| `typing` | `user-typing` | Typing indicator |

### Direct Messages
| Emit | Listen | Description |
|---|---|---|
| `dm-message` | `dm-message` | Send/receive DMs |
| `dm-typing-start` | `dm-typing` | Typing indicator |
| `dm-read` | `dm-read-receipt` | Read receipts |

### Corrections
| Emit | Listen | Description |
|---|---|---|
| `peer-correct` | `peer-correction` | Submit/receive corrections |

### Moderation
| Listen | Description |
|---|---|
| `message-flagged` | Banned word detected |
| `user-banned` | User was banned |
| `user-muted` | User was muted |

## Rate Limits

| Scope | Window | Max Requests |
|---|---|---|
| Auth endpoints | 1 min | 10 |
| General API | 1 min | 100 |
| Write operations | 1 min | 30 |
| Socket messages | 30 sec | 15 |

## Membership Tiers

| Feature | Free | Pro ($2.99) | Premium ($9.99) |
|---|---|---|---|
| AI corrections/day | 5 | 50 | Unlimited |
| Vocabulary limit | 100 | 2,000 | Unlimited |
| DM conversations | 3 | 20 | Unlimited |
| Premium events | No | Yes | Yes |
| Premium resources | No | No | Yes |
| Custom rooms | 0 | 3 | Unlimited |

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Real-time**: Socket.IO 4
- **Database**: Turso (LibSQL / hosted SQLite)
- **Auth**: JWT (jsonwebtoken + bcrypt)
- **Validation**: Zod 4
- **Security**: Helmet, CORS, rate limiting
- **Docs**: Swagger UI (swagger-jsdoc)
- **Language detection**: franc-min

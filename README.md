# Kompanion API

Backend API for Kompanion - Strava-powered gamification app.

## Tech Stack

- Node.js + TypeScript
- Express
- Strava OAuth2
- JSON file storage (PostgreSQL/Prisma coming later)

## Project Structure

```
src/
├── modules/           # Feature modules
│   ├── auth/         # Authentication & OAuth
│   ├── activities/   # Strava activities
│   ├── stats/        # User statistics
│   ├── achievements/ # Gamification achievements
│   └── quests/       # Weekly/monthly quests
├── shared/           # Shared utilities
│   ├── middleware/   # Auth, error handling
│   ├── types/        # TypeScript types
│   └── utils/        # Utilities (storage, etc.)
├── config/           # Configuration
└── server.ts         # Main server file
```

## Getting Started

### Prerequisites

- Node.js >= 20
- Strava API credentials

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your Strava API credentials:
```env
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=http://localhost:3000/api/auth/callback
SESSION_SECRET=your_session_secret_minimum_32_characters_long
```

### Development

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

### Building

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `GET /api/auth/login` - Get Strava OAuth URL
- `GET /api/auth/callback` - OAuth callback handler
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout
- `DELETE /api/auth/account` - Delete account

### Activities
- `GET /api/activities` - List user activities
- `POST /api/activities/sync` - Sync activities from Strava
- `GET /api/activities/:id` - Get activity by ID

### Stats
- `GET /api/stats` - Get user statistics

### Achievements
- `GET /api/achievements` - List achievements with progress

### Quests
- `GET /api/quests` - List weekly/monthly quests

## Type Safety

All endpoints are fully typed with TypeScript. Shared types are in `src/shared/types/`.

## Code Quality

```bash
npm run lint      # Run ESLint
npm run format    # Format with Prettier
npm run typecheck # TypeScript type checking
```

## Data Storage

Currently using JSON file storage in `src/data/`. Migration to PostgreSQL/Prisma is planned.

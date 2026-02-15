# 51Talk MENA Live Quiz System

Real-time quiz system for 600+ concurrent players, built with static HTML/JS and Supabase.

## Live URLs

| Page | URL | Purpose |
|------|-----|---------|
| **Player** | [Play Quiz](https://ahmedalsadeqhr.github.io/51talk-quiz-live/) | Mobile-friendly quiz interface for participants |
| **Admin** | [Admin Panel](https://ahmedalsadeqhr.github.io/51talk-quiz-live/admin.html) | Control panel for managing quizzes and broadcasting questions |
| **Presentation** | [Big Screen](https://ahmedalsadeqhr.github.io/51talk-quiz-live/present.html) | Projector display with countdown, winner, and leaderboard |

## Architecture

```
Players (600+)          Admin (1)              Presentation (1)
   phones              laptop                  projector
     |                    |                        |
     |     WebSocket      |      WebSocket         |
     +--------------------+------------------------+
                          |
                    Supabase Backend
                   (PostgreSQL + Realtime)
```

- **Frontend**: Pure HTML/JS/CSS — no frameworks, no build step
- **Backend**: Supabase (PostgreSQL + Realtime WebSocket subscriptions)
- **Hosting**: GitHub Pages (static files, free, handles unlimited traffic)
- **No polling**: All live updates via Supabase Realtime (WebSocket)

## Features

| Feature | Description |
|---------|-------------|
| Fastest Correct Wins | Automatically detects the fastest correct answer |
| Real-time Updates | Live response tracking via WebSocket (no polling) |
| Presentation Mode | Big screen view optimized for projectors |
| Bilingual | Full Arabic + English support |
| Mobile Friendly | Touch-optimized answer buttons for smartphones |
| 600+ Users | Handles large audiences with zero server cost |
| Admin Auth | Password-protected admin panel |
| Quiz Editor | Full CRUD for quizzes and questions |
| Leaderboard | Cumulative scoring with speed bonus |
| Timer Enforcement | Server-side RLS policy rejects late answers |
| XSS Protection | All user input escaped before DOM insertion |
| Answer Shuffling | Deterministic seeded shuffle — same order for all players |

## File Structure

```
Quiz/
├── index.html              # Player page
├── admin.html              # Admin dashboard (password-protected)
├── present.html            # Presentation/projector display
├── css/
│   └── style.css           # Shared dark theme, RTL support, responsive
├── js/
│   ├── supabase-config.js  # Supabase client initialization
│   ├── utils.js            # XSS escaping, seeded shuffle, time helpers
│   ├── player.js           # Player logic + realtime subscription
│   ├── admin.js            # Admin auth, quiz CRUD, broadcasting
│   └── present.js          # Presentation display + realtime
├── sql/
│   └── setup.sql           # Full Supabase schema, RLS, RPC functions, seed data
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Pages deployment workflow
```

## Setup from Scratch

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click "New Project" — choose a name, set a database password, pick a region
3. Wait for provisioning

### 2. Run Database Setup

1. Go to **SQL Editor** in your Supabase dashboard
2. Run: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
3. Open `sql/setup.sql`, copy the entire contents, paste and run
4. Click "Run this query" when the safety warning appears

This creates:
- 5 tables: `quizzes`, `questions`, `active_question`, `responses`, `admin_config`
- Row Level Security policies
- 10 RPC functions (admin auth, broadcasting, CRUD, leaderboard)
- Realtime enabled on `active_question` and `responses`
- Seed data: Ramadan Quiz + Chinese New Year Quiz (10 questions total)

### 3. Configure Frontend

Edit `js/supabase-config.js` with your Supabase credentials:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Find these in **Settings > API** in your Supabase dashboard.

### 4. Deploy to GitHub Pages

1. Push the `Quiz/` folder to a GitHub repository
2. Go to **Settings > Pages** and enable GitHub Pages on the `main` branch
3. The deployment workflow (`.github/workflows/deploy.yml`) runs automatically

### 5. Default Admin Password

The default admin password is `admin123`. Change it before your event:

```sql
UPDATE admin_config
SET password_hash = encode(sha256('your-new-password'::bytea), 'hex')
WHERE id = 1;
```

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `quizzes` | Quiz metadata (title_en, title_ar) |
| `questions` | Questions with JSONB options, correct_index, sort_order |
| `active_question` | Singleton row broadcasting current state (idle/active/revealed/leaderboard) |
| `responses` | One per player per question, with UNIQUE constraint |
| `admin_config` | SHA-256 hashed admin password (hidden from anon by RLS) |

### RPC Functions

| Function | Purpose |
|----------|---------|
| `verify_admin(pw)` | Checks password, returns boolean |
| `set_active_question(pw, question_id, quiz_id, timer_sec)` | Broadcasts a question to all players |
| `update_aq_status(pw, new_status)` | Transitions: revealed, leaderboard, idle |
| `clear_responses(pw, quiz_id)` | Clears responses for a quiz |
| `upsert_quiz(pw, ...)` | Create or update a quiz |
| `delete_quiz(pw, id)` | Delete a quiz and its questions |
| `upsert_question(pw, ...)` | Create or update a question |
| `delete_question(pw, id)` | Delete a question |
| `get_leaderboard(quiz_id, limit)` | Cumulative scores with speed bonus |

### Security

- **RLS enabled** on all tables
- Players can only `SELECT` quizzes/questions/active_question/responses and `INSERT` responses
- Response inserts are blocked when timer expires (server-side enforcement)
- Admin writes go through `SECURITY DEFINER` RPC functions that verify password
- `admin_config` table has no SELECT policy — password hash is never exposed
- All user input is HTML-escaped before DOM insertion (XSS protection)

### Leaderboard Scoring

- Correct answer: **1000 base points**
- Speed bonus: **up to 500 points** (faster = more points)
- Formula: `1000 + max(0, 500 - response_time_ms / 40)`
- Wrong answer: **0 points**
- Scores are cumulative across all questions in a quiz

## Event Day Workflow

```
1. Open Admin on your laptop → login
2. Open Presentation on the projector
3. Share Player URL / QR code with audience
4. Select quiz → select question → click START
5. Players answer on their phones
6. Click REVEAL → winner shown on projector
7. Click LEADERBOARD → top 10 displayed
8. Click STOP → repeat from step 4 for next question
```

### Timing per Question

| Phase | Duration |
|-------|----------|
| Question display + answering | 20 seconds (configurable) |
| Reveal correct answer | 15-30 seconds |
| Leaderboard | 15-30 seconds |
| **Total per question** | ~1-2 minutes |
| **Full quiz (5 questions)** | ~5-10 minutes |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Admin login fails | Hard refresh (`Ctrl+Shift+R`), check browser console |
| Players see "waiting" | Make sure admin clicked START |
| No responses appearing | Check Supabase dashboard > Realtime is enabled for `responses` table |
| Timer expired error | Server-side RLS rejects late submissions — this is working correctly |
| Duplicate answer error | Each player can only answer once per question (UNIQUE constraint) |

## Tech Stack

- **Frontend**: Vanilla HTML/JS/CSS
- **Backend**: [Supabase](https://supabase.com) (PostgreSQL + Realtime)
- **Hosting**: [GitHub Pages](https://pages.github.com)
- **CDN**: Supabase JS Client v2 via jsDelivr
- **Fonts**: Inter + Noto Sans Arabic via Google Fonts

## License

MIT

# My Planner ♡

A cute pastel planner dashboard recreated from the requested design, with the original school-planner requirements plus streak/progress features inspired by the reference UI.

## Included features

- Dashboard with pastel cards and daily schedule
- Monthly calendar with date selection
- Daily routine planner
- School schedule/classes
- Tasks and assignments
- Notes with local image and file attachments
- Streak tracker
- Tasks completed progress
- Study-time card
- Jump back in / recent quiz cards
- Deck progress widget
- Goals
- Habit tracker
- Reminders
- Journal
- Profile/settings
- Responsive mobile layout with bottom navigation
- Local email/password accounts with separate planner storage per account
- IndexedDB browser cache for fast offline-friendly rendering
- Daily task and routine history stored by date, including today and previous days
- Persisted streak records that activate only after completing a routine or task
- Daily rewards refresh by date, and weekly rewards refresh by week
- Reward claims are stored independently for each day and week

## Run locally

Install Node.js 18 or newer, then run:

```bash
npm start
```

Open `http://localhost:3000`. The deployed frontend is configured to call `https://plannerapp-beui.onrender.com`, and the API allows requests from `https://noely-jed-e-arcay.github.io`.

## Accounts and storage

The Node server stores accounts and planner snapshots in `data/server-db.json`. Passwords use Node's `scrypt` hash, and each login receives a session token. The browser keeps an IndexedDB cache and synchronizes changes to the server automatically.

For production, deploy `server.js` to a Node host with persistent disk storage and HTTPS. Do not use ephemeral storage, or the database file will be lost on restart. The frontend can be hosted by this same server or configured with `window.PLANNER_CONFIG.apiBase` in `index.html` to point to the HTTPS server URL. If frontend and backend use different domains, set the server's `CLIENT_ORIGIN` environment variable to the frontend origin.

## GitHub Pages

GitHub Pages can host the frontend, but it cannot run this Node server or provide persistent storage. For cross-device accounts, host the Node server separately and set `apiBase` to its HTTPS URL. GitHub repository accounts do not authenticate users inside the planner.

## Storage behavior

Planner changes are saved automatically in the selected account's server record. The backup controls remain available as optional export/import tools. If the server is unavailable, the browser cache still displays the last local copy and will sync future edits when the server is available again.

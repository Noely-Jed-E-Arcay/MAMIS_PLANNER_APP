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
- IndexedDB browser database — no Node.js, npm, or server required
- Daily task and routine history stored by date, including today and previous days
- Persisted streak records that activate only after completing a routine or task
- Daily rewards refresh by date, and weekly rewards refresh by week
- Reward claims are stored independently for each day and week

## Run

Open `index.html` directly in a modern browser.

## GitHub Pages

Upload the contents of this folder to a GitHub repository with `index.html` in the repository root. Then enable GitHub Pages from **Settings → Pages → Deploy from a branch → main → /(root)**.

## Important database note

The app uses IndexedDB, so data is saved automatically and remains intact when you close and reopen the app in the same browser profile. GitHub Pages hosts the frontend files, but it cannot provide a writable shared database. Use **Settings → Download backup** to move all planner data, including streaks, to another browser or device, then use **Restore backup** there. A shared multi-user database would require a separate API/backend and cloud database.

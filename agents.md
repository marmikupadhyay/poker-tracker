# Poker Tracker - Project Architecture

This file provides a minimal overview of the Poker Tracker codebase for AI agents and developers.

## Tech Stack
- **Frontend Framework**: React (Vite)
- **Styling**: Vanilla CSS (`src/style.css`)
- **Charting**: Chart.js (`react-chartjs-2`)
- **Backend/Database**: Firebase Firestore (NoSQL Document DB)
- **Hosting**: Firebase Hosting

## File Structure
- `/src/App.jsx`: The core monolithic component containing UI, State, and Firebase integration.
- `/src/firebase.js`: Firebase configuration and initialization (exports `db`).
- `/src/main.jsx`: React entry point.
- `/src/style.css`: Global styles and custom UI tokens.

## Data Model (Firestore)
- `sessions`: Tracks live table states, actions history, and player chip stacks.
- `users`: Tracks global user profiles across all sessions.

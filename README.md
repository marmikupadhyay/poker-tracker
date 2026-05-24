# Poker Tracker

A real-time, cloud-synced web application for tracking live poker games, hands, user statistics, and session history.

## Features
- **Live 9-Max Poker Table:** Track actions (Fold, Check, Call, Raise, 3-Bet, etc.) street by street.
- **Real-time Cloud Sync:** Powered by Firebase Firestore, changes are instantly synced across all devices.
- **Player Database & Lifetime Stats:** Track VPIP, PFR, 3-Bet %, Win Rate, and total hands played globally.
- **Session History:** Review past sessions, graph player stacks over time, and see who won the most pots.

## How to Run Locally

### Prerequisites
- [Node.js](https://nodejs.org/) installed on your machine.

### Setup
1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open the provided `localhost` URL in your browser.

## How to Host

This project is currently configured to deploy to **Firebase Hosting**.

### Deployment Steps
1. Install the Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```
2. Log in to Firebase:
   ```bash
   firebase login
   ```
3. Ensure you have a project initialized (`firebase.json` and `.firebaserc` are already configured for `poker-tracker-1506015015`).
4. Build the production application:
   ```bash
   npm run build
   ```
5. Deploy to hosting:
   ```bash
   firebase deploy --only hosting
   ```

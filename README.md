# CSC Feed — Project Reports

A responsive frontend skeleton for sharing reports across multiple projects. The interface follows the reference app's compact sidebar, blue-accented controls, cards, and accessible form patterns.

## Run locally

```sh
npm install
npm run dev
```

## Prototype scope

- Browse and filter reports by project, date, or search terms.
- Add projects with a name, description, and color, then edit those details later.
- Add a report with a project, date, Punch ID demo user, title, description, and file.
- Download files added during the current browser session.
- View project cards and report counts.

This is a UI prototype, not a connected service. Projects, reports, and files are held only in browser memory and reset on refresh. Punch ID authentication, shared project permissions, persistent file storage, and server-side report APIs still need implementation.

[README.md](https://github.com/user-attachments/files/28979990/README.md)
# Local CRMS

A dependency-free, locally hosted Criminal Records Management System for authorized law-enforcement or agency environments. It uses Node's built-in SQLite support, schema migrations, append-only audit/change logs, and a bidirectional sync API for standalone field devices that may work offline.

## Run

```powershell
npm.cmd start
```

Open `http://localhost:4173`.

The app creates `data/crms.sqlite` on first run and applies every SQL file in `migrations/` in filename order.

## Features

- Criminal/person records with aliases, charges, cases, evidence, warrants, custody status, risk level, and notes
- Search and filter across CRN, names, national ID, fingerprints, status, and risk
- Local SQLite database with durable migrations
- Append-only audit log and change log
- Bidirectional sync endpoints for field devices:
  - `GET /api/sync/export?since=<change_id>`
  - `POST /api/sync/import`
  - `GET /api/sync/devices`
- Last-write-wins conflict handling using `updated_at`, with skipped conflicts reported to callers
- No external packages, no cloud service, no network dependency

## API Headers

For audit attribution during local use:

- `X-CRMS-User`: operator name
- `X-CRMS-Role`: role label
- `X-CRMS-Device`: device ID

## Notes

This is a local prototype suitable for expansion. Production deployment should add real identity provider integration, encrypted storage at rest, HTTPS, stricter role-based authorization, backup policy, and agency-specific legal compliance review.

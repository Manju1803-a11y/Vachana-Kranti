# Vachana Kranti E-paper

A local Node.js publishing desk for creating and reading Vachana Kranti editions.

## Run locally

1. Install Node.js 20 or newer.
2. Configure the management sign-in credentials in the server environment. In PowerShell, run `$env:ADMIN_EMAIL="editor@example.com"` and `$env:ADMIN_PASSWORD="use-a-long-unique-password"` in the same terminal before starting the app.
3. From this folder, run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000) and sign in with the configured credentials.
5. From the dashboard, create an edition with its name, URL alias, publication date, metadata, category, status, and PDF/image pages.
6. Deploy it immediately, save it as a draft, or schedule it for a future date and time. Open the generated URL to read the e-paper.

The server listens on port `3000` by default. Set the `PORT` environment variable to use a different port.

The editor dashboard and management APIs require a sign-in session. Published reader pages remain public. Sessions are stored in memory and expire after eight hours, or 30 days when “Remember me” is selected; restarting the server signs users out. Admin endpoints fail closed when `ADMIN_EMAIL` or `ADMIN_PASSWORD` is not configured; no default admin password is shipped.

## Render deployment

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `DATABASE_URL` in the Render web service environment. This app uses PostgreSQL (`pg`). For a Render PostgreSQL database in the same region, open the database's **Connect** panel and use its **Internal Database URL** as `DATABASE_URL`; do not use or paste the external URL unless connecting from outside Render. Add the URL only through the Render dashboard's environment settings, never to source control or chat.

The app enables TLS for remote PostgreSQL connections by default (`DATABASE_SSL=require`, with certificate verification disabled for compatibility with managed database certificates). Set `DATABASE_SSL=disable` only when the database provider explicitly requires plaintext on a private network, or `DATABASE_SSL=verify-full` when its server certificate is trusted by Node.js. Localhost connections default to TLS disabled. The optional `DATABASE_SSL` setting accepts `disable`, `require`, or `verify-full`.

The service health check is `/api/health`. Production requires a reachable database and returns `{"status":"ok","db":"connected"}` only after a live database query; missing or unreachable storage returns HTTP 503 and `{"status":"error","db":"unavailable"}`. Local development without `DATABASE_URL` uses file storage and reports `db: "local-file"`.

Database schema changes are applied using numbered, repeatable migrations at server startup. A PostgreSQL advisory lock prevents concurrent instances from applying the same migration simultaneously; applied versions are tracked in `schema_migrations`. Run `npm run db:migrate` to apply them manually before starting the server. Migrations do not delete data. No demo edition or sample production data is inserted automatically.

Edition IDs are exactly 12 hexadecimal characters. Use the exact generated URL or the configured edition alias; malformed IDs are never truncated to match another issue. Missing and unpublished editions remain private and return HTTP 404. Storage failures return HTTP 503 and a diagnostic reference in the server log. The unavailable-edition page includes a retry action for recoverable server/network errors.

Render's local filesystem is not a persistent edition store. Do not expect uploads saved in local-file mode to survive a new instance or deployment. Provision PostgreSQL and restore/import any required existing edition records and files before relying on old links. This application does not recreate or automatically publish a missing edition.

Run the reader and database regression suite with `npm test`.

## Reader and archive

The management dashboard reports edition totals, categories, local upload storage, monthly reader visits, recent editions, and upcoming scheduled publications. The edition manager supports search, status/category filters, metadata and page replacement, preview, copying URLs, bulk updates, and deletion. Categories support rename, setting a primary category, and guarded removal.

E-paper settings are saved locally by section (basic site details, SEO defaults, social URLs, push setup, watermark, analytics/provider IDs, PWA metadata, and comment preferences). Theme setup controls the reader header, colors, width, font, watermark and additional CSS. Page management creates editable public or draft information pages, available at `/page/<slug>`, and links public pages from e-paper reader footers.

Published editions appear in the reader. The reader supports PDF viewing, image page zoom, individual page downloads, browser printing, SEO title and description metadata, and navigation between editions. Reader visit totals are collected when an edition is opened.

Uploads are stored in `data/issues/` and remain available while that folder is preserved. Categories are stored in `data/categories.json`. Each file can be up to 50 MB; an edition can contain up to 30 PDF, JPG, PNG, WEBP, or GIF files. The dashboard reports a 10 GB storage allowance.

The generated `localhost` URLs are local to this machine. To make an edition accessible from the public internet, deploy the Node.js server and its `data/issues/` folder to a publicly reachable host.

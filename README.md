# Vachana Kranti E-paper

A local Node.js publishing desk for creating and reading Vachana Kranti editions.

## Run locally

1. Install Node.js 18 or newer.
2. Configure the management sign-in credentials in the server environment. In PowerShell, run `$env:ADMIN_EMAIL="editor@example.com"` and `$env:ADMIN_PASSWORD="use-a-long-unique-password"` in the same terminal before starting the app.
3. From this folder, run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000) and sign in with the configured credentials.
5. From the dashboard, create an edition with its name, URL alias, publication date, metadata, category, status, and PDF/image pages.
6. Deploy it immediately, save it as a draft, or schedule it for a future date and time. Open the generated URL to read the e-paper.

The server listens on port `3000` by default. Set the `PORT` environment variable to use a different port.

The editor dashboard and management APIs require a sign-in session. Published reader pages remain public. Sessions are stored in memory and expire after eight hours, or 30 days when “Remember me” is selected; restarting the server signs users out. Admin endpoints fail closed when `ADMIN_EMAIL` or `ADMIN_PASSWORD` is not configured.

## Reader and archive

The management dashboard reports edition totals, categories, local upload storage, monthly reader visits, recent editions, and upcoming scheduled publications. The edition manager supports search, status/category filters, metadata and page replacement, preview, copying URLs, bulk updates, and deletion. Categories support rename, setting a primary category, and guarded removal.

E-paper settings are saved locally by section (basic site details, SEO defaults, social URLs, push setup, watermark, analytics/provider IDs, PWA metadata, and comment preferences). Theme setup controls the reader header, colors, width, font, watermark and additional CSS. Page management creates editable public or draft information pages, available at `/page/<slug>`, and links public pages from e-paper reader footers.

Published editions appear in the reader. The reader supports PDF viewing, image page zoom, individual page downloads, browser printing, SEO title and description metadata, and navigation between editions. Reader visit totals are collected when an edition is opened.

Uploads are stored in `data/issues/` and remain available while that folder is preserved. Categories are stored in `data/categories.json`. Each file can be up to 50 MB; an edition can contain up to 30 PDF, JPG, PNG, WEBP, or GIF files. The dashboard reports a 10 GB storage allowance.

The generated `localhost` URLs are local to this machine. To make an edition accessible from the public internet, deploy the Node.js server and its `data/issues/` folder to a publicly reachable host.

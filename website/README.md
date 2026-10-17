# AgentVPS public website

The static site lives at https://agentvps.ai-infra.org, hosted by Cloudflare Pages
project `agentvps`. Its source is `public/`. It is separate from the authenticated
VPS desktop on port 8080.

Build the tested runtime package first, then generate the site:

```sh
npm pack
npm run site:build
npm run test:site
wrangler pages deploy website/dist --project-name agentvps --branch main
```

The build replaces the installer checksum placeholder with the SHA-256 of the
actual package. Upload that exact tarball to the matching GitHub release before
publishing the site. Do not change a published npm version or silently replace
released package bytes. New runtime changes require a new release version.

The installer downloads the pinned release from GitHub and validates its digest.
The agent guide is plain Markdown at `/agent-guide.md`, discoverable via
`/llms.txt`. Keep its commands synchronized with the CLI and installer.

English is served at `/`; Simplified Chinese is served at `/zh/`, including
`/zh/agent-guide.md` and `/zh/llms.txt`. Both pages render without JavaScript.
Keep the two HTML pages and installation guides synchronized when behavior
changes. Shared styling and copy/tab interactions live in `style.css` and
`app.js`. The header language link works on desktop and mobile; it never
automatically redirects visitors. Tests cover both languages and copy actions.

`public/desktop.png` is a real screenshot of the product, with controlled demo
content only. Do not publish private workspaces, access tokens or browser logins.

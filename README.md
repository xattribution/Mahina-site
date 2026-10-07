# Mahina Club

Website and admin console for the Mahina Club, the Space Forces–Indo-Pacific booster club.

## What's in it

| Area | Visitors | Admins |
|---|---|---|
| Home | Tonight's moon and its Hawaiian night name, the featured event or poll, a live timeline, photos, polls, fundraising goal | Pick what's featured; show, hide, and reorder sections; set the top banner; edit text in place |
| Events | Hover-to-expand timeline on the home page; full list and month calendar on the Events page, tag filters, RSVP with guests, add to Google/Apple/Outlook | Create, duplicate, draft, cancel; capacity; reminder schedule; notify attendees of changes; roster CSV |
| Sign-ups | SignUpGenius-style slots: potluck dishes with a public list of what everyone is bringing and how many it feeds, a "Something else" write-in, timed volunteer shifts, quantities | Templates (potluck, shifts, blank), optional specific items per slot that people claim (Turkey, Ham), slot pictures, no-limit slots, servings totals against the RSVP count, reorder slots, remove people, CSV |
| Gallery | Masonry, lightbox, filter by tag or event; tag filters surface related events; visitors can share photos | Bulk upload, review queue, bulk tag/hide/delete, captions |
| Polls | Forms-style questions: multiple choice, checkboxes, 1–5 rating, written | Builder, open/close dates, result visibility, one response per email, CSV |
| Give | Venmo handle, QR code, goal progress, where the money goes; optional Venmo QR on any event | Edit handle, goal, amount raised; turn on the QR per event with a note |
| Planning | | Per-event tasks and volunteer jobs assigned to team members, a shopping list with costs and who bought what, and team notes. Never public |
| Contact | Message form, officers, club email | Inbox with read/archive |
| My sign-ups | Every confirmation email links to a page where people change or cancel, or remove themselves completely | |
| Email | Confirmations with calendar files, reminders (people can turn them off per event), club news only for people who tick the box, invites, announcements, unsubscribe and remove-me links | Composer (mailing list, everyone, event attendees, specific people), outbox |
| Accounts | One sign-in at `/login` for admins and members | Admin and member accounts, per-area access for members, and an activity log of who did what |

## Install

On any Linux server (Ubuntu, Debian, Fedora, Raspberry Pi OS, and others):

```bash
curl -fsSL https://raw.githubusercontent.com/xattribution/mahina-site/main/install.sh | sudo bash
```

It installs Docker if needed and asks three questions: the port, the public address, and whether to load sample content. Then it starts the site. Open the address it prints, add `/login`, and create the first admin account.

| Task | Command |
|---|---|
| Update | `sudo mahina update` |
| Uninstall | `sudo mahina uninstall` |
| Back up now | `sudo mahina backup` |
| Restore a backup | `sudo mahina restore <file>` |
| Status, logs, restart | `sudo mahina status`, `sudo mahina logs`, `sudo mahina restart` |

- **Update** never touches your data: the mailing list, sign-ups, email settings, and accounts carry over. It backs up your data first, downloads the latest version, and restarts. If the new version fails to start, it goes back to the previous one on its own. The last 10 backups are kept in `/opt/mahina-club/backups`.
- **Uninstall** asks you to type `uninstall`, saves a final backup to your home folder, and removes the site. Docker stays installed. Add `--purge` to skip the backup, or `--yes` to skip the question.
- **Settings** are in `/opt/mahina-club/.env`. Run `sudo mahina restart` after changing them. New settings from updates are added automatically, and your values are kept.

The site runs as an unprivileged user inside its container. Put it behind your reverse proxy (Nginx Proxy Manager works) with HTTPS. Sign-in cookies are marked secure automatically when the proxy sends `X-Forwarded-Proto: https`.

**Without the installer:** `cp .env.example .env`, edit it, then `docker compose up -d --build`. For development: `pip install -r requirements.txt` and `uvicorn app.main:app --port 8080`.

## Editing the site

Signed-in admins see an **Edit page** button at the bottom of every page. Turn it on and click any outlined text to change it; changes save when you click away, and Esc undoes. That covers:

- **Home:** the club name, section headings, and the featured item. You can also show, hide, or reorder each section.
- **Banner and footer:** banner text, link, and visibility; the organization line and footer notice.
- **Events:** title, date and time, place, details, cover photo, sign-up names, slots, and spots.
- **Give:** Venmo handle, goal name, amounts, and where the money goes.
- **Contact:** officers and their emails, and the club email.
- **Polls and photos:** poll titles, intros, and photo captions. You can also hide photos.

The color swatches in the edit bar switch the whole site between two themes:
- **Red, white & blue:** night blue with a lehua-red accent.
- **Ocean:** deep teal and seafoam with a hibiscus accent, palm silhouettes against the moon, and a wave edge on the water and footer.

You can also choose a theme under **Settings > Colors** in the dashboard, and override the button color there. Emails follow the theme too. Every theme color is a CSS variable at the top of `web/css/site.css` (classic) and in the `[data-palette="ocean"]` block, so adding another theme means adding one more block and one entry in `PALETTES` in `app/db.py`.

Everything else is in the dashboard. Only admins see the edit button; members work in the dashboard.

## Accounts and sign-in

Everyone signs in at `/login` (the **Login** link in the site footer) and lands on the same dashboard at `/team`. Admins see extra pages and options there. Old `/admin` links redirect to the dashboard. There are two kinds of account, managed under **Accounts**:

- **Admins** can do everything.
- **Members** get only the areas an admin ticks: Event planning, Events, Sign-ups, Polls, Gallery, Messages, People, and Email. Members can never change settings, colors, the home page layout, the banner, team accounts, or edit pages in place.

**Adding people:** under **Accounts > Add someone**, pick their role and access and choose **Email an invite**. They get a link to a page where they pick their own name and password, then land in the dashboard. No one can create an account without an invite.

- Each link works once, only for the email it was sent to, and expires after 7 days. **Resend** makes a new link and the old one stops working. **Cancel** kills it.
- The link's secret sits after the `#` in the address, so it never reaches the server's logs, and the page clears it from the address bar once it loads. The database stores only a hash of it.
- If email isn't connected yet, the dashboard shows the link once so you can pass it along privately.
- Invite links use the **Site address** in Settings, so make sure that's your public address.
- You can still use **Set a password** to create an account directly.

New members start with Event planning. In **Planning**, anyone with access sees each upcoming event's tasks, shopping list, and notes. They can take or assign work, check items off, and record what was spent. A person assigned something by someone else gets an email with a link to the plan.

**Activity** lists sign-ins, failed sign-ins, and every change, by who and when. It keeps 400 days. Entries name people, not their full email addresses.

## Sign-in

**Passwords** follow NIST SP 800-63B-4: at least 15 characters, up to 128, any characters including spaces and emoji. There are no composition rules, no forced changes, and no security questions. New passwords are checked against a list of common passwords, repeated patterns, the club's own name, and the Have I Been Pwned breach list. Only the first 5 characters of a hash leave the server. Passwords are stored with Argon2id. Failed sign-ins are throttled per account and per address. Changing your password signs out your other devices.

**Single sign-on** works with any OpenID Connect provider. [Pocket ID](https://github.com/pocket-id/pocket-id) is the light option: one container, passkeys only, no passwords at all. Authentik, Authelia, Keycloak, Google Workspace, and Microsoft Entra work too.

1. Create an OIDC client in the provider with the redirect URI `https://<your site>/api/admin/sso/callback`.
2. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_NAME` in `.env`.
3. Add each person's email under **Accounts**. Only listed emails get in.
4. Once it works, set `PASSWORD_LOGIN=0` to turn passwords off.

## Security

- **Database queries:** every query is parameterized. Inputs are length-capped and stripped of control and bidirectional-override characters. Single-line fields like names and subjects can't carry line breaks into email headers or calendar files.
- **Email addresses:** checked against a strict pattern, so an address is always safe to use in a header or a mailto link.
- **Rendering:** user text is displayed as text, never as HTML. Email templates escape every value.
- **Response headers:** a strict Content Security Policy that only runs the site's own scripts. Pages can't be framed, MIME types aren't sniffed, and HSTS turns on behind HTTPS.
- **Request size:** request bodies are capped at 1 MB, and photo uploads at 200 MB.
- **Photos:** every upload is decoded and re-saved as a fresh JPEG with metadata stripped. Oversized images are refused, so a crafted file can't pass through.
- **Admin sessions:** session cookies are HttpOnly and SameSite=Strict, and only a hash of each session token is stored. Every admin write needs a custom header, which blocks cross-site requests.
- **Change-or-cancel links:** they go only to the person's own inbox and are never shown on screen. If someone RSVPs again with an email that's already on the list, the original RSVP stays as it is and the owner gets their link again.
- **Permissions:** every console request is checked on the server against the account's role and access, not just hidden in the menu. Names and emails only reach people with access to that area. The public site shows first names and last initials on sign-up sheets, and never shows emails.
- **Removing people:** under **People**, the trash button deletes a person outright: mailing list entry, RSVPs, sign-ups, messages, queued emails, and their name on poll answers and shared photos. Anyone can do the same for themselves from the **Remove me** button on the unsubscribe page or their sign-ups page. Deleted rows are overwritten in the database file, not just unlinked.
- **Stored data:** the database, uploads, and backups are readable only by the site's own user. Copies of sent emails are cleared after 90 days. CSV downloads are escaped so a name can't run as a spreadsheet formula.
- **Spam:** public forms have a hidden honeypot field and per-address rate limits. Set `FORWARDED_ALLOW_IPS` to your proxy so the limits see real visitor addresses.

## Email

Mail goes out over plain SMTP, so any provider works. Set it in `.env` or in the dashboard under **Settings > Email**, then use **Send a test**.

- **Brevo** (free tier, 300/day): `smtp-relay.brevo.com`, port 587, STARTTLS
- **Resend**: `smtp.resend.com`, port 465, SSL, user `resend`, password is the API key
- **SendGrid**: `smtp.sendgrid.net`, port 587, user `apikey`

Verify the club's sending domain with the provider (SPF and DKIM) so mail doesn't land in spam. Until email is connected, messages wait in the outbox and send once it is.

Reminders go to everyone who RSVPed or signed up, on the schedule set per event (1 week, 2 days, 1 day, 3 hours). The mail worker checks every minute.

## Calendar feed

`/calendar.ics` is a subscribable feed of every published event. The footer links it as `webcal://`.

## Project layout

```
app/       FastAPI backend: main.py (public API), admin.py, store.py (rules), mailer.py (email, .ics, reminders), seed.py
web/       Front end, no build step: index.html, css/, js/ (ES modules)
seed/      Sample photos for MAHINA_SEED
tools/     build_demo.py makes the offline preview
```

Accent color and club name are editable in Settings. Colors are CSS variables at the top of `web/css/site.css`.

# Mahina Club

Website and admin console for the Mahina Club, the Space Forces–Indo-Pacific booster club.

## What's in it

| Area | Visitors | Admins |
|---|---|---|
| Home | Tonight's moon and its Hawaiian night name, the featured event or poll, a live timeline, photos, polls, fundraising goal | Pick what's featured; show, hide, and reorder sections; set the top banner; edit text in place |
| Events | Hover-to-expand timeline on the home page; full list and month calendar on the Events page, tag filters, RSVP with guests, add to Google/Apple/Outlook | Create, duplicate, draft, cancel; capacity; reminder schedule; notify attendees of changes; roster CSV |
| Sign-ups | On each event's page, SignUpGenius-style slots: potluck dishes with a public list of what everyone is bringing and how many it feeds, a "Something else" write-in, timed volunteer shifts, quantities | Templates (potluck, shifts, blank), optional specific items per slot that people claim (Turkey, Ham), slot pictures, no-limit slots, servings totals against the RSVP count, reorder slots, remove people, CSV |
| Gallery | Masonry, lightbox, filter by tag or event; tag filters surface related events; visitors can share photos | Bulk upload, review queue, bulk tag/hide/delete, captions |
| Polls | Forms-style questions: multiple choice, checkboxes, 1–5 rating, written. A poll can stand on its own or belong to an event, where it also shows on the event's page | Builder, open/close dates, result visibility, one response per email, CSV; link or unlink polls from the poll editor or the event's Polls tab |
| Give | Venmo handle, QR code, goal progress, where the money goes; optional Venmo QR on any event | Edit handle, goal, amount raised; turn on the QR per event with a note |
| Shop | Hidden until an admin turns it on. Shirts, patches, mugs; pick a size, check out with name and email, then pay by Venmo with the amount and order code filled in. The order page updates when payment lands | A Sell screen for the table (Venmo QR or cash with change), orders to mark paid and handed out, products with sizes, stock and pictures, sales totals, CSV. Optional automatic Venmo confirmation |
| Planning | | Per-event tasks and volunteer jobs assigned to team members, split into steps with their own people, a shopping list with costs and who bought what, team notes, and a button to email the to-do list to chosen teammates. Never public |
| Contact | Message form, officers, club email | Inbox with read/archive |
| My sign-ups | Every confirmation email links to a page where people change or cancel, or remove themselves completely | |
| Email | Confirmations with calendar files, reminders (people can turn them off per event), club news only for people who tick the box, a welcome note with an unsubscribe link whenever someone is added to the list, invites, announcements, unsubscribe and remove-me links | Composer (mailing list, everyone, event attendees, specific people), outbox |
| Accounts | One sign-in at `/login` for admins and members | Admin and member accounts, per-area access for members (including letting members invite others), and an activity log of who did what |

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

- **After an update**, a normal page refresh loads the new version. Script and style addresses change with every release, so browsers and proxies can't hold on to old copies.
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

Everyone signs in at `/login` (the **Login** link in the site footer) and lands on the same dashboard at `/team`. Admins see extra pages and options there. Old `/admin` links redirect to the dashboard. There are two kinds of account, managed under **Team**:

- **Admins** can do everything.
- **Members** get only the areas an admin ticks: Event planning, Events, Sign-ups, Polls, Gallery, Messages, People, Email, Shop, and Team. Members can never change settings, colors, the home page layout, the banner, or edit pages in place.
- **Team** access lets a member see who's on the team (email addresses partly hidden) and invite new members. They can only give access they have themselves, and can't invite admins or change or remove anyone.

**Adding people:** under **Team > Add someone** (members see **Invite someone**), pick their role and access and choose **Email an invite**. They get a link to a page where they pick their own name and password, then land in the dashboard. No one can create an account without an invite.

- Each link works once, only for the email it was sent to, and expires after 7 days. **Resend** makes a new link and the old one stops working. **Cancel** kills it.
- The link's secret sits after the `#` in the address, so it never reaches the server's logs, and the page clears it from the address bar once it loads. The database stores only a hash of it.
- If email isn't connected yet, the dashboard shows the link once so you can pass it along privately.
- Invite links use the **Site address** in Settings, so make sure that's your public address.
- You can still use **Set a password** to create an account directly.

New members start with Event planning. In **Planning**, anyone with access sees each upcoming event's tasks, shopping list, and notes. They can take or assign work, check items off, and record what was spent. A person assigned something by someone else gets an email with a link to the plan.

- **Steps:** any task can be broken into steps, each with its own person. Deleting a task deletes its steps.
- **Send tasks:** emails the open to-do list to the teammates you tick. Each person sees their own tasks and steps first; pick **The whole list** to include everyone else's too. Add an optional note. Replies go to whoever sent it.

**Activity** lists sign-ins, failed sign-ins, and every change, by who and when. It keeps 400 days. Entries name people, not their full email addresses.

## Sign-in

**Passwords** follow NIST SP 800-63B-4: at least 15 characters, up to 128, any characters including spaces and emoji. There are no composition rules, no forced changes, and no security questions. New passwords are checked against a list of common passwords, repeated patterns, the club's own name, and the Have I Been Pwned breach list. Only the first 5 characters of a hash leave the server. Passwords are stored with Argon2id. Failed sign-ins are throttled per account and per address. Changing your password signs out your other devices.

**Single sign-on** works with any OpenID Connect provider. [Pocket ID](https://github.com/pocket-id/pocket-id) is the light option: one container, passkeys only, no passwords at all. Authentik, Authelia, Keycloak, Google Workspace, and Microsoft Entra work too.

1. Create an OIDC client in the provider with the redirect URI `https://<your site>/api/admin/sso/callback`.
2. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_NAME` in `.env`.
3. Add each person's email under **Team**. Only listed emails get in.
4. Once it works, set `PASSWORD_LOGIN=0` to turn passwords off.

## Security

Audited by three independent reviewers (server, shop and payments, browser), then re-attacked after each round of fixes. Every confirmed attack is replayed by an automated test.

**Payments and protected settings**
- **Confirm it's you:** changing the club Venmo handle, the Venmo payment mailbox, or the email server, and any change to accounts (adding people, invites, roles, setting passwords, removing admins), needs a 6-digit code emailed to the signed-in admin. Before email is set up, or if the code email can't be sent, the admin's password works instead. A pass lasts 10 minutes, and confirming swaps the session cookie, so a copied cookie stops working. Codes are hashed, single-use, limited to 5 tries, and never stored in the outbox.
- **Alerts:** every admin gets an email when the Venmo handle, payment mailbox, email server, or admin list changes. Email-server alerts go out through the old settings, and nobody can discard them from the outbox.
- **Admins only:** members with the Shop permission can sell, mark orders paid, and edit products. They can't change any payment setting or cancel a paid order. Admins need a reason to cancel a paid order.
- **Orders:** prices and totals are always worked out on the server. Online orders always start unpaid. Unpaid online orders release their items after 24 hours, and can hold at most 10 of an item, 20 items in all, and half of what's left of any item, with at most 3 open per email address, 3 per phone or home connection, and 10 per shared public address (phone carriers often put many people behind one).
- **Automatic Venmo matching** marks an order paid only when all of these hold:
  - the receiving mail server's own check shows DKIM and DMARC passing for venmo.com;
  - the email went to the club's Venmo address;
  - the subject is a received payment for the exact order total (the amount is never read from the payer's note);
  - it names exactly one order code;
  - that email hasn't paid for anything before.
  The mailbox is read only, and scanned in order from where the last check stopped, so a flood of look-alike mail can't hide a real payment.

**Accounts and sign-in**
- Argon2id passwords, 15 characters minimum. Sign-in attempts are counted before the password is checked: 8 per device per account, 30 per device, and 40 per account from new devices, every 15 minutes. Someone failing on purpose can't lock the real person out of a device they've used before.
- Session cookies are HttpOnly and SameSite=Strict, and only a hash of each token is stored. Every dashboard write needs a custom header, which blocks cross-site requests. Single sign-on accepts verified emails only.
- Every dashboard request is checked on the server against the account's role and access. Team invites and people's private links are hidden or blanked out in the outbox.
- **Member email limits:** members can email at most 100 new addresses an hour and 300 a day, counted together across adding people, hand sign-ups, invites, and emails to typed-in addresses. They can't put back anyone who unsubscribed, and people they sign up by hand are never added to club news. Admins aren't limited.

**Everything else**
- **Injection:** every database query is parameterized. Inputs are length-capped and stripped of control and bidirectional characters, so nothing can break into an email header or calendar file. User text is always shown as text, never HTML. CSV downloads are escaped so nothing runs as a spreadsheet formula. Links only accept web addresses or site paths.
- **Headers:** a strict Content Security Policy that only runs the site's own scripts and only posts forms to the site. Pages can't be framed, and the server doesn't announce its software.
- **Uploads:** 1 MB for normal requests; only the exact upload routes take more, and dashboard uploads need a session before anything is read. Images over 24 megapixels (40 for the team) are refused before decoding. At most two images process at once, off the main thread, and every image is re-saved as a fresh JPEG with metadata stripped.
- **Privacy:** drafts never leak through sign-up sheets, polls, or photos. Typing someone's email never changes their RSVP; their own link goes to their inbox instead. Per-address limits stop the public forms from flooding anyone's inbox. Unsubscribe links need a click, so email scanners can't trigger them. Error replies never echo the request back.
- **Removing people:** under **People**, the trash button deletes a person outright, including their name on shop orders and team emails about them. Anyone can do the same for themselves from the **Remove me** button. Deleted rows are overwritten in the database file.
- **Stored data:** the database, uploads, and backups are readable only by the site's own user. Copies of sent emails are cleared after 90 days.
- **Demo content** only ever goes into a brand-new site. Emptying a live site and restarting doesn't bring it back.
- **Behind a proxy:** set `FORWARDED_ALLOW_IPS` to your proxy so rate limits see real visitors. If the proxy runs on the same machine, also set `MAHINA_BIND=127.0.0.1` so no one can reach the app around the proxy and fake their address.

## Email

Mail goes out over plain SMTP, so any provider works. Set it in `.env` or in the dashboard under **Settings > Email**, then use **Send a test**.

- **Brevo** (free tier, 300/day): `smtp-relay.brevo.com`, port 587, STARTTLS
- **Resend**: `smtp.resend.com`, port 465, SSL, user `resend`, password is the API key
- **SendGrid**: `smtp.sendgrid.net`, port 587, user `apikey`

Verify the club's sending domain with the provider (SPF and DKIM) so mail doesn't land in spam. Until email is connected, messages wait in the outbox and send once it is.

Reminders go to everyone who RSVPed or signed up, on the schedule set per event (1 week, 2 days, 1 day, 3 hours). The mail worker checks every minute.

## Shop

Turn it on under **Shop > Settings**. Until then the page, its menu link, and its API don't exist for visitors, but the team can still add products and sell at the table.

Every order gets a short code like `MC-7Q4K2`. The Venmo link and QR open Venmo with the club as recipient and the exact amount and code filled in as the note, so each payment can be matched to its order.

- **At the table:** tap items on **Shop > Sell**, then **Venmo** (shows a QR for the buyer to scan) or **Cash** (works out change). Venmo sales flip to Paid on their own when automatic confirmation is on, or tap **They paid** after seeing the buyer's screen.
- **Online:** orders wait for payment, then show under **To hand out** until someone marks them handed out. Unpaid orders are released after 24 hours, the buyer gets an email, and the items go back in stock. If a payment arrives later, the order comes back when the items are still there; otherwise admins are alerted.
- **Automatic confirmation (optional):** in **Shop > Settings**, give the site read-only IMAP access to the mailbox that gets Venmo's "paid you" emails (for Gmail, an app password), and the email address on the club's Venmo account if it's different. Every few minutes, while orders are waiting, it reads new Venmo emails and marks an order paid only when every check under Security passes. A wrong amount leaves the order waiting with a note. It never changes or deletes email.
- **Shop emails:** in **Shop > Settings**, set a sender name, a "send from" address, and a reply-to address just for order emails. Event, news, and list emails keep the club's usual address. The email service has to allow sending from that address (use one on the club's verified domain).
- **Team alerts:** pick people under **Order alerts** to get an email when an online order comes in and when it's paid. Any order can also be sent by hand with the send button in **Orders**, with a note; replies go to whoever sent it, and the email links straight to that order. Only accounts that can see the shop are offered, since these emails include the buyer's name and email.
- Venmo's rules expect a business or charity profile for selling goods. Check which kind the club's account is.

Card payments (PayPal Checkout or Stripe) are noted in `UPGRADE_PATHS.md`.

## Calendar feed

`/calendar.ics` is a subscribable feed of every published event. The footer links it as `webcal://`.

## Project layout

```
app/       FastAPI backend: main.py (public API), admin.py, store.py (rules), shop.py, mailer.py (email, .ics, reminders), seed.py
web/       Front end, no build step: index.html, css/, js/ (ES modules)
seed/      Sample photos for MAHINA_SEED
tools/     build_demo.py makes the offline preview
```

Accent color and club name are editable in Settings. Colors are CSS variables at the top of `web/css/site.css`.

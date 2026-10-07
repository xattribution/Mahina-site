# Upgrade paths

Ideas that are planned but not built yet, with enough detail to pick them up later.

## Sign in with Google, Microsoft, and others

**Today:** one OpenID Connect provider through the `OIDC_*` settings in `.env`. Signing in matches an existing account by email, and SSO never creates accounts, so the site stays invite-only.

**Plan:** several providers side by side with the password form, plus permanent account linking.

| Provider | Effort | Email reliable for matching? | Setup on the club's side |
|---|---|---|---|
| Google | Small | Yes, Google verifies emails | OAuth client in Google Cloud, about 10 minutes |
| Microsoft | Small | Mostly. Some work accounts can carry an unverified email, so match only verified ones | App registration in the Entra portal |
| GitHub | Small | Yes, it reports which emails are verified | OAuth app in GitHub settings |
| Apple | Medium | Yes, but people can hide their email behind a relay address | Paid Apple developer account ($99 a year) |
| Facebook | Medium | Often, but some users have no email on file | Meta app review |
| X | Hard | Least reliable; email access may need extra approval or a paid tier | Developer account and app approval |

Google, Microsoft, and GitHub together are about a day of work, including tests.

**How it would work**

1. Login page shows "Continue with …" buttons for each provider that has keys. Keys move from `.env` into Settings so they can be added without touching the server.
2. On someone's first SSO sign-in, the provider's email is matched to an existing account, but only when the provider says the email is verified.
3. After that, the link is stored by the provider's permanent user ID (a new `identities` table: account, provider, subject, linked date), not by email. Later email changes at the provider don't break the link, and a recycled email address can't take over an account.
4. The Accounts page shows each person's linked sign-ins. People can unlink one from Your account, as long as they keep at least one way in.
5. The invite page offers "Continue with Google" so new members can skip making a password.
6. Sign-ins, links, and unlinks go to the Activity log.

## Shop: card payments

The shop takes Venmo (manual or email-confirmed) and cash. If online sales grow, PayPal Checkout adds card and Venmo payments with real payment webhooks, but it needs a PayPal Business account and charges a per-sale fee. Stripe is the alternative for cards only.

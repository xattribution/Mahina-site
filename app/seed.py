"""Demo content so a fresh install shows what the site can do. Run with MAHINA_SEED=1 on an empty database."""
import json
import os
import random
from datetime import datetime, timedelta

from . import db, media

PHOTO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "seed", "photos")

TAGS = [("ʻOhana", "reef"), ("Potluck", "plumeria"), ("Sports", "fern"), ("Service", "lagoon"),
        ("Holiday", "lehua"), ("Fundraiser", "taro")]

NAMES = ["Kalani Akana", "Maria Santos", "Josh Whitfield", "Leilani Kahale", "Derek Nguyen", "Aisha Brooks",
         "Tom Okada", "Rachel Kim", "Keoni Pua", "Sam Delgado", "Brianna Fox", "Chris Mahoe", "Priya Raman",
         "Nate Kealoha", "Jess Carter", "Mike Tanaka", "Lauren Price", "Kai Ho", "Dana Reyes", "Evan Park"]
DISHES = ["Kalua pig", "Mac salad", "Chicken long rice", "Poke bowl", "Lumpia", "Spam musubi", "Haupia bars",
          "Butter mochi", "Teriyaki beef", "Fruit platter", "Garlic shrimp", "Pineapple slaw", "Lilikoʻi cheesecake"]


def at(days, hour=0, minute=0):
    d = db.now_local().replace(hour=0, minute=0, second=0) + timedelta(days=days)
    return d.replace(hour=hour, minute=minute).isoformat(timespec="minutes")


def next_weekday(weekday, after_days):
    d = db.now_local() + timedelta(days=after_days)
    return after_days + (weekday - d.weekday()) % 7


def full_moon_offsets():
    """Days from today to the most recent and the next full moon (Hawaii time)."""
    import math
    ref = datetime(2000, 1, 6, 18, 14) - timedelta(hours=10)  # a known new moon, in HST
    syn = 29.530588853
    now = db.now_local()
    age = ((now - ref).total_seconds() / 86400) % syn
    to_full = (syn / 2 - age) % syn
    frac = now.hour / 24
    return math.floor(to_full - syn + frac), math.floor(to_full + frac)


def email_for(name):
    return name.lower().replace(" ", ".") + "@example.com"


def photo(fname, caption="", status="approved"):
    with open(os.path.join(PHOTO_DIR, fname), "rb") as f:
        fn, th, w, h = media.save_image(f.read())
    return db.run("INSERT INTO photos(file, thumb, w, h, caption, status, submitted_by, created) VALUES (?,?,?,?,?,?,?,?)",
                  (fn, th, w, h, caption, status, "Seed", db.now_iso()))


def run():
    random.seed(7)
    tag = {}
    for name, color in TAGS:
        tag[name] = db.run("INSERT INTO tags(name, slug, color) VALUES (?,?,?)", (name, db.slugify(name, "tags"), color))

    def event(title, start, end, location, summary, description, tags, cover=None, capacity=None, reminders=(24,),
              map_url=""):
        eid = db.run("""INSERT INTO events(slug, title, starts_at, ends_at, location, map_url, summary, description,
                        cover_photo_id, capacity, reminders, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (db.slugify(title, "events"), title, start, end, location, map_url, summary, description,
                      cover, capacity, json.dumps(list(reminders)), db.now_iso()))
        for t in tags:
            db.run("INSERT INTO event_tags(event_id, tag_id) VALUES (?,?)", (eid, tag[t]))
        return eid

    def attach(eid, files, tags):
        ids = []
        for f, cap in files:
            pid = photo(f, cap)
            db.run("UPDATE photos SET event_id=? WHERE id=?", (eid, pid))
            for t in tags:
                db.run("INSERT OR IGNORE INTO photo_tags(photo_id, tag_id) VALUES (?,?)", (pid, tag[t]))
            ids.append(pid)
        return ids

    def rsvps(eid, n, start):
        for name in random.sample(NAMES, n):
            db.run("INSERT INTO rsvps(event_id, name, email, guests, status, token, created) VALUES (?,?,?,?,?,?,?)",
                   (eid, name, email_for(name), random.choice([0, 0, 1, 2, 3]), "going", db.token(), start))

    # ----- past -----
    d = next_weekday(5, -45)
    vb = event("Beach Volleyball Tournament", at(d, 9), at(d, 14), "Hickam Beach Courts",
               "Six-person teams, round robin into brackets.",
               "Teams of six. Round robin in the morning, brackets after lunch. Shave ice for the winners.",
               ["Sports", "ʻOhana"])
    ids = attach(vb, [("vb-sunset.jpg", "Final point of the championship"), ("vb-group.jpg", ""),
                      ("vb-game.jpg", "Golden hour warm-ups"), ("beach-group.jpg", "")], ["Sports"])
    db.run("UPDATE events SET cover_photo_id=? WHERE id=?", (ids[0], vb))
    rsvps(vb, 16, at(d - 10, 12))

    last_full, next_full = full_moon_offsets()
    d = last_full
    moon = event("Full Moon Talk Story", at(d, 18, 30), at(d, 21), "Hickam Beach, Pavilion 3",
                 "Bring a chair and a pūpū to share.",
                 "Sunset, a fire pit, and good company under the full moon. Bring a chair and a pūpū to share.",
                 ["ʻOhana"])
    ids = attach(moon, [("moon-group.jpg", "Moonrise over the water"), ("firepit.jpg", ""),
                        ("hearts.jpg", ""), ("sand-group.jpg", "")], ["ʻOhana"])
    db.run("UPDATE events SET cover_photo_id=? WHERE id=?", (ids[0], moon))
    rsvps(moon, 12, at(d - 5, 12))

    d = next_weekday(5, -11)
    run5k = event("Guardian 5K", at(d, 6, 30), at(d, 8, 30), "Hickam Harbor Track",
                  "Run, jog, or walk. Every entry funds the holiday party.",
                  "Run, jog, or walk the harbor loop. $15 entry goes to the holiday party fund. Strollers welcome.",
                  ["Sports", "Fundraiser"])
    ids = attach(run5k, [("run-silhouette.jpg", "Sunrise start"), ("run-group.jpg", ""), ("run-road.jpg", "")],
                 ["Sports", "Fundraiser"])
    db.run("UPDATE events SET cover_photo_id=? WHERE id=?", (ids[0], run5k))
    rsvps(run5k, 18, at(d - 7, 12))

    # ----- upcoming -----
    d = next_weekday(4, 2)
    pau = event("Pau Hana", at(d, 16, 30), at(d, 19), "Hickam Beach, Pavilion 3",
                "End the week on the sand. Drinks and grill provided.",
                "End the week on the sand. The club brings drinks and fires up the grill. Families welcome.",
                ["ʻOhana"], cover=photo("maui-sunset.jpg", status="cover"))
    rsvps(pau, 9, at(-1, 9))

    d = next_weekday(5, 9)
    potluck = event("ʻOhana Potluck", at(d, 11), at(d, 15), "Hickam Beach, Pavilion 3",
                    "Everyone brings a dish. The club covers drinks and plates.",
                    "Our fall potluck on the beach. Sign up for a dish below so we get a good spread, "
                    "and grab a shift if you can help set up or clean up.\n\nKeiki games at noon. Bring sunscreen.",
                    ["Potluck", "ʻOhana"], cover=photo("food-spread.jpg", status="cover"), reminders=(48, 3))
    rsvps(potluck, 14, at(-3, 10))
    sh = db.run("INSERT INTO sheets(event_id, title, description, allow_other, created) VALUES (?,?,?,1,?)",
                (potluck, "Bring a dish", "Tell us what you're bringing so we don't end up with twelve mac salads.", db.now_iso()))
    slots = [("Main dish", 6, 1, 1, "buffet-table.jpg"), ("Side dish", 8, 1, 1, "food-variety.jpg"), ("Dessert", 6, 1, 1, "table-dishes.jpg"),
             ("Drinks and ice", 3, 1, 0, None), ("Plates and napkins", 2, 0, 0, None)]
    for i, (t, cap, ask, serves, img) in enumerate(slots):
        pid = photo(img, status="cover") if img else None
        sid = db.run("INSERT INTO slots(sheet_id, title, capacity, ask_item, ask_servings, photo_id, sort) VALUES (?,?,?,?,?,?,?)",
                     (sh, t, cap, ask, serves, pid, i))
        for name in random.sample(NAMES, {0: 4, 1: 5, 2: 6, 3: 1, 4: 0}[i]):
            item = random.choice(DISHES) if ask else ""
            db.run("INSERT INTO signups(slot_id, name, email, qty, item, servings, token, created) VALUES (?,?,?,?,?,?,?,?)",
                   (sid, name, email_for(name), 1, item, random.choice([8, 10, 12, 15, 20]) if serves else None, db.token(), at(-2, 10)))
    other = db.run("INSERT INTO slots(sheet_id, title, capacity, ask_item, ask_servings, is_other, sort) VALUES (?,?,0,1,1,1,9999)",
                   (sh, "Something else"))
    db.run("INSERT INTO signups(slot_id, name, email, qty, item, servings, token, created) VALUES (?,?,?,?,?,?,?,?)",
           (other, "Keoni Pua", email_for("Keoni Pua"), 1, "Kalua pig", 30, db.token(), at(-1, 18)))
    sh = db.run("INSERT INTO sheets(event_id, title, description, sort, created) VALUES (?,?,?,?,?)",
                (potluck, "Help out", "", 1, db.now_iso()))
    for i, (t, h0, h1, cap) in enumerate([("Setup", 9, 11, 4), ("Grill", 11, 13, 2), ("Keiki games", 12, 13, 2),
                                          ("Cleanup", 14, 15, 4)]):
        sid = db.run("INSERT INTO slots(sheet_id, title, capacity, starts_at, ends_at, sort) VALUES (?,?,?,?,?,?)",
                     (sh, t, cap, at(d, h0), at(d, h1), i))
        for name in random.sample(NAMES, [2, 2, 0, 1][i]):
            db.run("INSERT INTO signups(slot_id, name, email, qty, token, created) VALUES (?,?,?,?,?,?)",
                   (sid, name, email_for(name), 1, db.token(), at(-2, 11)))

    event("Full Moon Talk Story", at(next_full, 18, 30), at(next_full, 21), "Hickam Beach, Pavilion 3",
          "Bring a chair and a pūpū to share.",
          "Sunset, a fire pit, and good company under the full moon. Bring a chair and a pūpū to share.",
          ["ʻOhana"], cover=photo("moon-calm.jpg", status="cover"))

    d = next_weekday(5, 26)
    trunk = event("Keiki Trunk-or-Treat", at(d, 17), at(d, 19), "Building 1102 parking lot",
                  "Decorate a trunk or just bring the keiki.",
                  "Costumes encouraged for all ages. Decorate your trunk, or just bring the keiki and a bag.",
                  ["Holiday", "ʻOhana"], cover=photo("surfboards.jpg", status="cover"))
    sh = db.run("INSERT INTO sheets(event_id, title, created) VALUES (?,?,?)", (trunk, "Trunks and treats", db.now_iso()))
    for i, (t, cap, ask) in enumerate([("Decorate a trunk", 12, 1), ("Candy donation", 10, 0), ("Hot cocoa table", 2, 0)]):
        sid = db.run("INSERT INTO slots(sheet_id, title, capacity, ask_item, sort, note) VALUES (?,?,?,?,?,?)",
                     (sh, t, cap, ask, i, "Tell us your theme" if ask else ""))
        for name in random.sample(NAMES, [5, 3, 0][i]):
            db.run("INSERT INTO signups(slot_id, name, email, qty, item, token, created) VALUES (?,?,?,?,?,?,?)",
                   (sid, name, email_for(name), 1, random.choice(["Pirate ship", "Under the sea", "Space station",
                                                                  "Jurassic jungle", "Candy land"]) if ask else "",
                    db.token(), at(-1, 12)))

    d = next_weekday(5, 37)
    event("Beach Cleanup", at(d, 8), at(d, 10, 30), "ʻEwa Beach Park", "Gloves and bags provided. Coffee after.",
          "Two hours on the beach with Sustainable Coastlines. Gloves, bags, and water provided; coffee after.",
          ["Service"], cover=photo("beach-golden.jpg", status="cover"), capacity=30)

    d = next_weekday(5, 51)
    fg = event("Friendsgiving", at(d, 16), at(d, 20), "SFI Courtyard", "Potluck Thanksgiving for anyone away from home.",
               "A potluck Thanksgiving for anyone who can't make it home. The club brings the turkey.",
               ["Potluck", "Holiday"], cover=photo("table-dishes.jpg", status="cover"), reminders=(48,))
    sh = db.run("INSERT INTO sheets(event_id, title, created) VALUES (?,?,?)", (fg, "Bring a dish", db.now_iso()))
    for i, (t, cap) in enumerate([("Side dish", 10), ("Dessert", 8), ("Rolls and bread", 3)]):
        db.run("INSERT INTO slots(sheet_id, title, capacity, ask_item, sort) VALUES (?,?,?,?,?)", (sh, t, cap, 1, i))

    d = next_weekday(4, 79)
    event("Holiday Party", at(d, 18), at(d, 22), "Hale Koa Hotel, Banyan Tree Showroom",
          "Dinner, keiki gifts, and the white elephant exchange.",
          "Our biggest night of the year. Dinner, a visit from Santa for the keiki, and the white elephant exchange.",
          ["Holiday", "Fundraiser"], cover=photo("coast-aerial.jpg", status="cover"), capacity=150, reminders=(72, 24))

    d = next_weekday(5, 115)
    event("Volleyball Rematch", at(d, 9), at(d, 13), "Hickam Beach Courts", "Last season's champs defend the title.",
          "Last season's champions defend the title. New teams welcome.", ["Sports"],
          cover=photo("vb-sunset.jpg", status="cover"))

    # gallery-only photos
    for f, t in [("buffet-line.jpg", ["Potluck"]), ("food-variety.jpg", ["Potluck"]), ("surf-walk.jpg", ["ʻOhana"]),
                 ("moon-calm.jpg", ["ʻOhana"])]:
        pid = photo(f)
        for x in t:
            db.run("INSERT INTO photo_tags(photo_id, tag_id) VALUES (?,?)", (pid, tag[x]))
    pid = photo("buffet-table.jpg", status="pending")
    db.run("UPDATE photos SET submitted_by=?, event_id=? WHERE id=?", ("Maria Santos <maria.santos@example.com>", run5k, pid))

    # ----- polls -----
    def poll(title, intro, status, results, questions, event_id=None, responses=0, closes=None):
        pid = db.run("""INSERT INTO polls(slug, title, intro, event_id, status, results, closes_at, created)
                        VALUES (?,?,?,?,?,?,?,?)""",
                     (db.slugify(title, "polls"), title, intro, event_id, status, results, closes, db.now_iso()))
        qids = []
        for i, (kind, prompt, opts, req) in enumerate(questions):
            qids.append((db.run("INSERT INTO questions(poll_id, kind, prompt, options, required, sort) VALUES (?,?,?,?,?,?)",
                                (pid, kind, prompt, json.dumps(opts), req, i)), kind, opts))
        for name in random.sample(NAMES, responses):
            ans = {}
            for qid, kind, opts in qids:
                if kind == "single":
                    ans[str(qid)] = random.choices(opts, weights=range(len(opts), 0, -1))[0]
                elif kind == "multi":
                    ans[str(qid)] = random.sample(opts, random.randint(1, len(opts)))
                elif kind == "rating":
                    ans[str(qid)] = str(random.choice([3, 4, 4, 5, 5, 5]))
                elif random.random() < 0.4:
                    ans[str(qid)] = random.choice(["Keiki activities please", "Can we do a raffle?", "Happy to help",
                                                   "Earlier start please", "More vegetarian options", "Count me in"])
            db.run("INSERT INTO responses(poll_id, name, email, answers, created) VALUES (?,?,?,?,?)",
                   (pid, name, email_for(name), json.dumps(ans), at(-1, 12)))

    poll("Holiday party: pick the theme", "Help us plan the big night.", "open", "public", [
        ("single", "Which theme?", ["Lūʻau under the lights", "Ugly sweater", "Winter formal", "Casino night"], 1),
        ("multi", "Which Fridays work for you?", ["Dec 4", "Dec 11", "Dec 18"], 1),
        ("single", "Would you help with setup?", ["Yes", "Maybe", "No"], 1),
        ("text", "Anything else we should know?", [], 0),
    ], responses=11, closes=at(21, 17))
    poll("Guardian 5K feedback", "", "closed", "after", [
        ("rating", "How was the race?", [], 1),
        ("single", "Would you run it again?", ["Yes", "Maybe", "No"], 1),
        ("text", "What should we change?", [], 0),
    ], event_id=run5k, responses=14)
    poll("Club shirt color", "", "open", "after", [
        ("single", "Pick a color", ["Night blue", "Lehua red", "Heather gray", "Sand"], 1),
        ("single", "What size do you wear?", ["S", "M", "L", "XL", "2XL"], 1),
    ], responses=6)

    # ----- people & settings -----
    for name in NAMES[:14]:
        db.run("INSERT OR IGNORE INTO subscribers(name, email, token, source, created) VALUES (?,?,?,?,?)",
               (name, email_for(name), db.token(), "seed", at(-20)))
    db.run("INSERT INTO messages(name, email, subject, body, created) VALUES (?,?,?,?,?)",
           ("Leilani Kahale", "leilani.kahale@example.com", "Spouses at the potluck?",
            "Aloha! Are spouses and keiki welcome at the potluck, or is it members only? Happy to bring a dessert either way.",
            at(-1, 9, 12)))
    db.run("INSERT INTO messages(name, email, subject, body, read, created) VALUES (?,?,?,?,?,?)",
           ("Derek Nguyen", "derek.nguyen@example.com", "5K photos",
            "I took a bunch of photos at the 5K. What's the best way to get them to you?", 1, at(-6, 14, 40)))

    db.set_setting("venmo", "MahinaClub-SFI")
    db.set_setting("email", "mahinaclub@example.com")
    db.set_setting("donate_goal", {"label": "Holiday party fund", "goal": 3000, "raised": 1840})
    db.set_setting("donate_uses", ["Keiki gifts at the holiday party", "Food and drinks for club events",
                                   "Farewell gifts for departing Guardians", "Welcome baskets for new families"])
    db.set_setting("officers", [
        {"role": "President", "name": "Kalani Akana", "email": ""},
        {"role": "Vice President", "name": "Maria Santos", "email": ""},
        {"role": "Treasurer", "name": "Tom Okada", "email": ""},
        {"role": "Secretary", "name": "Rachel Kim", "email": ""},
        {"role": "Events", "name": "Keoni Pua", "email": ""},
    ])
    # internal planning for the potluck (team only)
    for kind, title, who, qty, est, cost, done in [
        ("task", "Reserve Pavilion 3 with MWR", "Keoni Pua", "", None, None, 1),
        ("task", "Pick up canopy tents from Bldg 1102", "Tom Okada", "", None, None, 0),
        ("task", "Check-in table, first shift", "Rachel Kim", "", None, None, 0),
        ("task", "Gate pass list to Security Forces", "Maria Santos", "", None, None, 0),
        ("buy", "Ice", "Tom Okada", "8 bags", 32, None, 0),
        ("buy", "Plates, cups, napkins", "Rachel Kim", "100 each", 45, 41.87, 1),
        ("buy", "Drinks", "Keoni Pua", "6 cases", 72, None, 0),
        ("buy", "Charcoal", "", "2 bags", 24, None, 0)]:
        db.run("INSERT INTO plan_items(event_id, kind, title, assignee_name, qty, est_cost, cost, done, done_by, created_by, created) "
               "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (potluck, kind, title, who, qty, est, cost, done, who if done else "", "Kalani Akana", at(-5)))
    db.run("INSERT INTO plan_notes(event_id, author, body, created) VALUES (?,?,?,?)",
           (potluck, "Kalani Akana", "Pavilion is ours from 9. Setup crew meets at the pavilion at 9:30.", at(-2, 18)))
    slug = db.one("SELECT slug FROM events WHERE id=?", (potluck,))["slug"]
    db.set_setting("banner", {"text": "Potluck dish sign-ups are open", "link": f"/events/{slug}", "active": True})
    print("Seeded demo content.")

# The Undercard

Side games for the Paisley & District Draft league — ten monthly prizes and a January cup,
scored automatically from the official Fantasy Premier League Draft API.

## How it stays current

`.github/workflows/update.yml` runs **every hour**. It calls `scripts/fetch.mjs`, which reads the
Draft API and writes `data/season.json`. The page loads that file, so the published link always
shows the latest scores. Nobody needs to resend anything.

You can also trigger it by hand: **Actions → Update scores → Run workflow**.

## Setting it up (once)

1. Create a **public** repository on GitHub and upload every file here, keeping the folders.
2. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
3. **Settings → Actions → General** → Workflow permissions → *Read and write permissions* → Save.
4. **Actions** tab → *Update scores* → **Run workflow** to fill in the scores immediately.

Your link is then `https://<username>.github.io/<repo>/` — permanent, and always current.

## Changing things

Everything adjustable lives in `data/config.json`:

- `pot` — what each month is worth, in pounds
- `cal` — which gameweeks each month covers, if the real calendar shifts
- `draft` — the agreed first and second round picks, by league entry id

Edit it on GitHub and the next hourly run picks it up.

## Notes

- The draft API records different first and second round picks than the league agreed. `config.json`
  holds the agreed pairs and the fetcher never overwrites them.
- An odd number of managers means the Draft app adds an `AVERAGE` side. It is a real opponent and
  its results count, but it never appears in a prize table.
- A gameweek's head-to-head points are only trusted once every match in it has finished. While one
  is in play the page totals each starting eleven itself and marks the week provisional.
- GitHub pauses scheduled workflows on repositories with no activity for 60 days. The hourly commits
  keep it awake during the season.

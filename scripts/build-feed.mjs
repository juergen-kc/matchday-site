#!/usr/bin/env node
// Generates feed.xml (RSS 2.0) of "today's matches" from data/seed-latest.json.
//
// One <item> per match-day, only for days up to and including "today" (UTC),
// newest first, capped to the most recent MAX_ITEMS. Slack's RSS app dedupes on
// <guid>, so each day posts exactly once. Times are UTC.
//
// "Today" is the current UTC date; override with FEED_TODAY=YYYY-MM-DD for
// testing or backfilling.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = process.env.FEED_DATA || join(repoRoot, 'data', 'seed-latest.json');
const FEED_PATH = join(repoRoot, 'feed.xml');

const SITE_URL = 'https://juergen-kc.github.io/matchday-site/';
const FEED_URL = `${SITE_URL}feed.xml`;
const MAX_ITEMS = 30;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Friendly names for knockout stages (group games use "Group X" instead).
const STAGE_LABELS = {
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarter-final',
  SF: 'Semi-final',
  '3RD': 'Third-place play-off',
  FINAL: 'Final',
};

const isTBD = (s) => !s || String(s).trim().toUpperCase() === 'TBD';

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// "Thu 11 Jun 2026" (UTC)
const humanDate = (dateStr) => {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  return `${WD[dt.getUTCDay()]} ${String(dt.getUTCDate()).padStart(2, '0')} ${MO[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
};

// Stable RFC-822 pubDate: fixed 06:30 UTC of the match-day, so repeated runs
// produce byte-identical output and never trigger a spurious commit/re-post.
const pubDate = (dateStr) => new Date(`${dateStr}T06:30:00Z`).toUTCString();

const main = async () => {
  const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const venues = new Map((data.venues || []).map((v) => [v.key, v]));
  const venueLabel = (key) => {
    if (!key) return 'Venue TBD';
    const v = venues.get(key);
    return v ? `${v.stadium}, ${v.city}` : key;
  };

  const today = process.env.FEED_TODAY || new Date().toISOString().slice(0, 10);

  // Normalize every source into one fixture shape: { date, kickoff_utc, home,
  // away, venue, label }. `label` is the competition context shown per match.
  const fixtures = [];

  for (const m of data.group_fixtures || []) {
    if (!m.date || !m.kickoff_utc) continue;
    fixtures.push({
      date: m.date,
      kickoff_utc: m.kickoff_utc,
      home: m.home,
      away: m.away,
      venue: m.venue,
      label: `Group ${m.group}`,
    });
  }

  // Knockout slots are dormant until the data source resolves them: today they
  // carry home/away "TBD" and null date/kickoff, so they are skipped. The moment
  // the source fills in real teams + a concrete date + kickoff_utc, they appear
  // automatically — no code change needed. We key off data presence (not the
  // `status` string) so this can't break if the status value changes.
  let knockoutCount = 0;
  for (const s of data.knockout_slots || []) {
    if (!s.date || !s.kickoff_utc || isTBD(s.home) || isTBD(s.away)) continue;
    fixtures.push({
      date: s.date,
      kickoff_utc: s.kickoff_utc,
      home: s.home,
      away: s.away,
      venue: s.venue,
      label: STAGE_LABELS[s.stage] || s.stage,
    });
    knockoutCount += 1;
  }

  // Group fixtures by date.
  const byDate = new Map();
  for (const m of fixtures) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }

  // Days that have happened (<= today), newest first, capped. YYYY-MM-DD sorts
  // correctly as plain strings.
  const days = [...byDate.keys()]
    .filter((d) => d <= today)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, MAX_ITEMS);

  const items = days.map((date) => {
    const matches = byDate
      .get(date)
      .slice()
      .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));

    const lines = matches.map((m) => {
      const time = m.kickoff_utc.slice(11, 16); // HH:MM from ...THH:MM:SSZ
      return `${time} UTC — ${m.home} vs ${m.away} · ${m.label} · ${venueLabel(m.venue)}`;
    });

    return `    <item>
      <title>${esc(`⚽ Matches — ${humanDate(date)}`)}</title>
      <link>${esc(`${SITE_URL}#${date}`)}</link>
      <guid isPermaLink="false">matchday-${date}</guid>
      <pubDate>${pubDate(date)}</pubDate>
      <description><![CDATA[${lines.join('<br/>\n')}]]></description>
    </item>`;
  });

  const lastBuild = days.length ? `\n    <lastBuildDate>${pubDate(days[0])}</lastBuildDate>` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Matchday — Today's Matches</title>
    <link>${esc(SITE_URL)}</link>
    <atom:link href="${esc(FEED_URL)}" rel="self" type="application/rss+xml"/>
    <description>Daily fixtures for the 2026 FIFA World Cup. Times in UTC.</description>
    <language>en</language>${lastBuild}
${items.join('\n')}
  </channel>
</rss>
`;

  await writeFile(FEED_PATH, xml, 'utf8');
  const matchCount = days.reduce((n, d) => n + byDate.get(d).length, 0);
  console.log(
    `feed.xml written — today=${today}, ${days.length} day item(s), ` +
      `${matchCount} match(es) (${knockoutCount} resolved knockout slot(s) available).`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

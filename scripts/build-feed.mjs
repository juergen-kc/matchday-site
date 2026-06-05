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
const DATA_PATH = join(repoRoot, 'data', 'seed-latest.json');
const FEED_PATH = join(repoRoot, 'feed.xml');

const SITE_URL = 'https://juergen-kc.github.io/matchday-site/';
const FEED_URL = `${SITE_URL}feed.xml`;
const MAX_ITEMS = 30;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    const v = venues.get(key);
    return v ? `${v.stadium}, ${v.city}` : key;
  };

  const today = process.env.FEED_TODAY || new Date().toISOString().slice(0, 10);

  // Group confirmed fixtures by date.
  const byDate = new Map();
  for (const m of data.group_fixtures || []) {
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
      return `${time} UTC — ${m.home} vs ${m.away} · Group ${m.group} · ${venueLabel(m.venue)}`;
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
  console.log(`feed.xml written — today=${today}, ${days.length} day item(s), ${matchCount} match(es).`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

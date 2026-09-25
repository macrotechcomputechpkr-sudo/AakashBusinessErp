// Run after `npm install` in the server folder:   node scripts/check-nepali-dates.js
// Confirms the Nepali calendar package is active and gives known dates.
// Add more rows from a printed patro if you like.
const cal = require('../utils/bsCalendar');
const known = [
    ['1943-04-14', 2000, 1, 1, 'BS 2000 Baishakh 1 (package epoch)'],
    ['2023-04-14', 2080, 1, 1, 'New Year 2080'],
    ['2024-04-13', 2081, 1, 1, 'New Year 2081'],
    ['2025-04-14', 2082, 1, 1, 'New Year 2082'],
    ['2025-07-17', 2082, 4, 1, 'Shrawan 1, 2082 (FY 2082/83 start)']
];
console.log('Status:', JSON.stringify(cal.status()));
if (!cal.available()) { console.log('Package not active - dates will use the old approximation.'); process.exit(1); }
let bad = 0;
for (const [ad, y, m, d, label] of known) {
    const bs = cal.adToBs(ad), back = cal.bsToAd(y, m, d);
    const ok = bs && bs.year === y && bs.month === m && bs.day === d && back === ad;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${ad} -> ${bs ? `${bs.year}-${bs.month}-${bs.day}` : 'null'}  (expected ${y}-${m}-${d}, ${label}; reverse ${back})`);
}
process.exit(bad ? 1 : 0);

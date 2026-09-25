// =============================================
// utils/nepaliDateUtils.js (frontend)
// Same conversion logic as server/utils/nepaliDateUtils.js, ported so
// report filters can show a live BS label next to the AD date picker
// without a round-trip to the server for every keystroke. Carries the
// SAME approximation caveat as the server version - see that file for
// the full explanation.
// =============================================

import { bsAvailable, adToBs } from './bsCalendar';

class NepaliDateConverter {
    constructor() {
        this.nepaliMonths = [
            { name: 'Baishakh', days: 31 }, { name: 'Jestha', days: 31 }, { name: 'Ashad', days: 31 },
            { name: 'Shrawan', days: 32 }, { name: 'Bhadra', days: 31 }, { name: 'Ashwin', days: 30 },
            { name: 'Kartik', days: 29 }, { name: 'Mangsir', days: 30 }, { name: 'Poush', days: 29 },
            { name: 'Magh', days: 30 }, { name: 'Falgun', days: 30 }, { name: 'Chaitra', days: 31 }
        ];
        this.referenceYear = 2000;
        this.referenceYearAD = 1943;
        this.referenceMonthAD = 4;
        this.referenceDayAD = 14;
    }

    toNepali(date) {
        // Accurate path (nepali-date-converter, self-checked in bsCalendar.js).
        if (bsAvailable()) {
            const ad = date instanceof Date
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                : String(date).slice(0, 10);
            const bs = adToBs(ad);
            if (bs) {
                const nepaliDate = `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`;
                const monthName = this.nepaliMonths[bs.month - 1].name;
                return { year: bs.year, month: bs.month, day: bs.day, date: nepaliDate, monthName, formatted: `${monthName} ${bs.day}, ${bs.year}` };
            }
        }
        try {
            const targetDate = new Date(date);
            const refDate = new Date(this.referenceYearAD, this.referenceMonthAD - 1, this.referenceDayAD);
            let diffDays = Math.floor((targetDate - refDate) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return null;

            let nepYear = this.referenceYear;
            let remainingDays = diffDays;
            while (remainingDays >= this.getYearDays(nepYear)) {
                remainingDays -= this.getYearDays(nepYear);
                nepYear++;
            }

            let nepMonth = 1, nepDay = 1;
            for (let i = 0; i < 12; i++) {
                const daysInMonth = this.getMonthDays(nepYear, i);
                if (remainingDays < daysInMonth) { nepMonth = i + 1; nepDay = remainingDays + 1; break; }
                remainingDays -= daysInMonth;
            }

            const nepaliDate = `${nepYear}-${String(nepMonth).padStart(2, '0')}-${String(nepDay).padStart(2, '0')}`;
            return { year: nepYear, month: nepMonth, day: nepDay, date: nepaliDate, monthName: this.nepaliMonths[nepMonth - 1].name, formatted: `${this.nepaliMonths[nepMonth - 1].name} ${nepDay}, ${nepYear}` };
        } catch { return null; }
    }

    getYearDays(year) { let t = 0; for (let i = 0; i < 12; i++) t += this.getMonthDays(year, i); return t; }
    getMonthDays(year, monthIndex) {
        const isLeap = this.isLeapYear(year);
        if (monthIndex === 2) return isLeap ? 32 : 31;
        if (monthIndex === 8) return isLeap ? 30 : 29;
        return this.nepaliMonths[monthIndex].days;
    }
    isLeapYear(year) { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0; }
}

const nepaliDateConverter = new NepaliDateConverter();

// FEATURE: "date selection should follow whatever English/Nepali/Dual
// is chosen in System Control" - a single formatter used by every
// report's date display, honoring that tenant-wide setting.
function formatDateForDisplay(isoDate, dateFormatSetting) {
    if (!isoDate) return '';
    if (dateFormatSetting === 'english') return isoDate;
    const bs = nepaliDateConverter.toNepali(isoDate);
    if (!bs) return isoDate;
    if (dateFormatSetting === 'nepali') return bs.formatted;
    return `${isoDate} (${bs.formatted} BS)`; // dual
}

// FEATURE: "Date Range, Month Range, Quarter, Yesterday, Today" - quick
// presets every report's date filter can offer, all resolving to plain
// ISO from/to strings the backend already understands.
function getQuickDateRange(preset) {
    const today = new Date();
    const iso = d => d.toISOString().slice(0, 10);
    const startOfMonth = (y, m) => new Date(y, m, 1);
    const endOfMonth = (y, m) => new Date(y, m + 1, 0);

    switch (preset) {
        case 'today': return { from: iso(today), to: iso(today) };
        case 'yesterday': { const y = new Date(today); y.setDate(y.getDate() - 1); return { from: iso(y), to: iso(y) }; }
        case 'this_month': return { from: iso(startOfMonth(today.getFullYear(), today.getMonth())), to: iso(endOfMonth(today.getFullYear(), today.getMonth())) };
        case 'last_month': { const m = today.getMonth() - 1, y = m < 0 ? today.getFullYear() - 1 : today.getFullYear(), mm = (m + 12) % 12; return { from: iso(startOfMonth(y, mm)), to: iso(endOfMonth(y, mm)) }; }
        case 'this_quarter': { const q = Math.floor(today.getMonth() / 3); return { from: iso(startOfMonth(today.getFullYear(), q * 3)), to: iso(endOfMonth(today.getFullYear(), q * 3 + 2)) }; }
        case 'last_quarter': { const q = Math.floor(today.getMonth() / 3) - 1, y = q < 0 ? today.getFullYear() - 1 : today.getFullYear(), qq = (q + 4) % 4; return { from: iso(startOfMonth(y, qq * 3)), to: iso(endOfMonth(y, qq * 3 + 2)) }; }
        case 'this_year': return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
        default: return { from: '', to: '' };
    }
}

export { nepaliDateConverter, formatDateForDisplay, getQuickDateRange };

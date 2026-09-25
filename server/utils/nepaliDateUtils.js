// =============================================
// nepaliDateUtils.js (FIXED)
//
// IMPORTANT CAVEAT (please read before relying on this in production):
// The Bikram Sambat calendar's month lengths are NOT derivable from a
// simple leap-year formula - they come from an official reference table
// published by Nepal's Calendar Determination Committee and vary
// irregularly per year. This class uses an approximation (fixed month
// lengths + a Gregorian-style leap rule) which will drift for some years.
// For anything user-facing/legal (invoices, fiscal filings) replace this
// with a maintained BS<->AD data table/library (e.g. a vetted npm package
// with an embedded official BS date table covering ~1970-2090 BS).
//
// FIX applied here: the previous version had an off-by-one bug in the
// month-resolution loop (`nepMonth = i + 2` while still inside the loop,
// instead of `i + 1` at the point the correct month is found), which
// produced wrong month numbers for many dates. That logic is corrected
// below.
// =============================================

const bsCalendar = require('./bsCalendar');

class NepaliDateConverter {
    constructor() {
        this.nepaliMonths = [
            { name: 'Baishakh', days: 31 },
            { name: 'Jestha', days: 31 },
            { name: 'Ashad', days: 31 },
            { name: 'Shrawan', days: 32 },
            { name: 'Bhadra', days: 31 },
            { name: 'Ashwin', days: 30 },
            { name: 'Kartik', days: 29 },
            { name: 'Mangsir', days: 30 },
            { name: 'Poush', days: 29 },
            { name: 'Magh', days: 30 },
            { name: 'Falgun', days: 30 },
            { name: 'Chaitra', days: 31 }
        ];

        this.referenceYear = 2000; // BS
        this.referenceYearAD = 1943;
        this.referenceMonthAD = 4;
        this.referenceDayAD = 14;
    }

    toNepali(date) {
        // Accurate path: official tables via nepali-date-converter (see bsCalendar.js).
        if (bsCalendar.available()) {
            const ad = date instanceof Date
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                : String(date).slice(0, 10);
            const bs = bsCalendar.adToBs(ad);
            if (bs) {
                const nepaliDate = `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`;
                const monthName = this.nepaliMonths[bs.month - 1].name;
                return { year: bs.year, month: bs.month, day: bs.day, date: nepaliDate, monthName, formatted: `${nepaliDate} (${monthName} ${bs.day}, ${bs.year})` };
            }
        }
        // Fallback: the old approximation (can be off by weeks).
        try {
            const targetDate = new Date(date);
            const refDate = new Date(this.referenceYearAD, this.referenceMonthAD - 1, this.referenceDayAD);
            let diffDays = Math.floor((targetDate - refDate) / (1000 * 60 * 60 * 24));

            if (diffDays < 0) {
                console.error('toNepali: date is before supported reference date');
                return null;
            }

            let nepYear = this.referenceYear;
            let remainingDays = diffDays;

            while (remainingDays >= this.getYearDays(nepYear)) {
                remainingDays -= this.getYearDays(nepYear);
                nepYear++;
            }

            // FIX: resolve month correctly (was off-by-one previously)
            let nepMonth = 1;
            let nepDay = 1;
            for (let i = 0; i < 12; i++) {
                const daysInMonth = this.getMonthDays(nepYear, i);
                if (remainingDays < daysInMonth) {
                    nepMonth = i + 1;
                    nepDay = remainingDays + 1;
                    break;
                }
                remainingDays -= daysInMonth;
            }

            const nepaliDate = `${nepYear}-${String(nepMonth).padStart(2, '0')}-${String(nepDay).padStart(2, '0')}`;
            return {
                year: nepYear,
                month: nepMonth,
                day: nepDay,
                date: nepaliDate,
                monthName: this.nepaliMonths[nepMonth - 1].name,
                formatted: `${nepaliDate} (${this.nepaliMonths[nepMonth - 1].name} ${nepDay}, ${nepYear})`
            };
        } catch (error) {
            console.error('Error converting to Nepali date:', error);
            return null;
        }
    }

    toEnglish(year, month, day) {
        if (bsCalendar.available()) {
            const ad = bsCalendar.bsToAd(year, month, day);
            if (ad) {
                const [y, m, d] = ad.split('-').map(Number);
                return { year: y, month: m, day: d, date: new Date(y, m - 1, d), formatted: ad };
            }
        }
        try {
            const nepYear = parseInt(year);
            const nepMonth = parseInt(month);
            const nepDay = parseInt(day);

            let totalDays = 0;
            let currentYear = this.referenceYear;

            while (currentYear < nepYear) {
                totalDays += this.getYearDays(currentYear);
                currentYear++;
            }

            for (let i = 0; i < nepMonth - 1; i++) {
                totalDays += this.getMonthDays(nepYear, i);
            }
            totalDays += nepDay - 1;

            const refDate = new Date(this.referenceYearAD, this.referenceMonthAD - 1, this.referenceDayAD);
            const targetDate = new Date(refDate);
            targetDate.setDate(refDate.getDate() + totalDays);

            return {
                year: targetDate.getFullYear(),
                month: targetDate.getMonth() + 1,
                day: targetDate.getDate(),
                date: targetDate,
                formatted: targetDate.toISOString().split('T')[0]
            };
        } catch (error) {
            console.error('Error converting to English date:', error);
            return null;
        }
    }

    getYearDays(year) {
        let total = 0;
        for (let i = 0; i < 12; i++) total += this.getMonthDays(year, i);
        return total;
    }

    getMonthDays(year, monthIndex) {
        const isLeap = this.isLeapYear(year);
        if (monthIndex === 2) return isLeap ? 32 : 31; // Ashad
        if (monthIndex === 8) return isLeap ? 30 : 29; // Poush
        return this.nepaliMonths[monthIndex].days;
    }

    isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }

    getCurrentFiscalYear() {
        const nepali = this.toNepali(new Date());
        if (!nepali) return null;
        const { year, month } = nepali;
        return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
    }
}

const nepaliDateConverter = new NepaliDateConverter();
module.exports = { nepaliDateConverter, NepaliDateConverter, bsStatus: bsCalendar.status };

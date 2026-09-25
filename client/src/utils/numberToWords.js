// =============================================
// utils/numberToWords.js
// Amount-in-words using the Nepali/Indian numbering system - groups by
// Thousand, then Lakh (1,00,000), then Crore (1,00,00,000), rather than
// the Western Million/Billion grouping. Matches the common South Asian
// accounting-document convention: "Rs. Twenty Nine Thousand Seventy
// Eight and Ninety Three Paisa Only."
// =============================================

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n) {
    if (n === 0) return '';
    if (n < 20) return ONES[n];
    const tens = Math.floor(n / 10), ones = n % 10;
    return TENS[tens] + (ones ? ' ' + ONES[ones] : '');
}

function threeDigitsToWords(n) {
    if (n === 0) return '';
    const hundreds = Math.floor(n / 100), rest = n % 100;
    let words = hundreds ? ONES[hundreds] + ' Hundred' : '';
    if (rest) words += (words ? ' ' : '') + twoDigitsToWords(rest);
    return words;
}

// FEATURE: Indian/Nepali grouping - Crore (10,000,000) > Lakh (100,000)
// > Thousand (1,000) > Hundred, NOT the Western Million/Billion split.
function integerToWords(n) {
    if (n === 0) return 'Zero';
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = n % 1000;

    const parts = [];
    if (crore) parts.push(threeDigitsToWords(crore) + ' Crore');
    if (lakh) parts.push(threeDigitsToWords(lakh) + ' Lakh');
    if (thousand) parts.push(threeDigitsToWords(thousand) + ' Thousand');
    if (hundred) parts.push(threeDigitsToWords(hundred));
    return parts.join(' ');
}

// FEATURE: full amount-in-words for a document total - e.g.
// amountToWords(29078.93, 'Rs') -> "Rs. Twenty Nine Thousand Seventy
// Eight and Ninety Three Paisa Only."
function amountToWords(amount, currencyLabel = 'Rs') {
    const value = Math.abs(Number(amount) || 0);
    const rupees = Math.floor(value);
    const paisa = Math.round((value - rupees) * 100);

    let words = `${currencyLabel}. ${integerToWords(rupees)}`;
    if (paisa > 0) words += ` and ${integerToWords(paisa)} Paisa`;
    words += ' Only.';
    return words;
}

export { integerToWords, amountToWords };

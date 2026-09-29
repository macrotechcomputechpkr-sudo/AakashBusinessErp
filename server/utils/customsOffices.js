// =============================================
// utils/customsOffices.js
// Customs Offices master (Customs Offices screen, Purchase Additional >
// Customs (Bhansar) tab). Nepal's customs offices are created for a
// company the first time its list is read (ensureDefaults); codes are
// short names of our own - edit them to match the codes you use.
// =============================================
const NEPAL_CUSTOMS_OFFICES = [
    ['MCH', 'Mechi Customs Office', 'मेची भन्सार कार्यालय', 'Jhapa', 'Kakarbhitta'],
    ['BDP', 'Bhadrapur Customs Office', 'भद्रपुर भन्सार कार्यालय', 'Jhapa', 'Bhadrapur'],
    ['BRT', 'Biratnagar Customs Office', 'विराटनगर भन्सार कार्यालय', 'Morang', 'Rani'],
    ['BRT-ICD', 'Biratnagar Dry Port (ICD) Customs Office', 'विराटनगर सुख्खा बन्दरगाह भन्सार कार्यालय', 'Morang', 'Biratnagar ICD'],
    ['RJB', 'Rajbiraj Customs Office', 'राजविराज भन्सार कार्यालय', 'Saptari', 'Kunauli'],
    ['THD', 'Thadi Customs Office', 'ठाडी भन्सार कार्यालय', 'Siraha', 'Thadi'],
    ['JNK', 'Janakpur Customs Office', 'जनकपुर भन्सार कार्यालय', 'Dhanusha', 'Janakpur'],
    ['JLS', 'Jaleshwar Customs Office', 'जलेश्वर भन्सार कार्यालय', 'Mahottari', 'Jaleshwar'],
    ['MLG', 'Malangwa Customs Office', 'मलंगवा भन्सार कार्यालय', 'Sarlahi', 'Malangwa'],
    ['GAU', 'Gaur Customs Office', 'गौर भन्सार कार्यालय', 'Rautahat', 'Gaur'],
    ['BRG', 'Birgunj Customs Office', 'वीरगंज भन्सार कार्यालय', 'Parsa', 'Birgunj'],
    ['SRS-ICD', 'Birgunj Dry Port (ICD Sirsiya) Customs Office', 'सुख्खा बन्दरगाह भन्सार कार्यालय, सिर्सिया', 'Parsa', 'Sirsiya ICD'],
    ['TIA', 'Tribhuvan International Airport Customs Office', 'त्रिभुवन अन्तर्राष्ट्रिय विमानस्थल भन्सार कार्यालय', 'Kathmandu', 'TIA'],
    ['TTP', 'Tatopani Customs Office', 'तातोपानी भन्सार कार्यालय', 'Sindhupalchok', 'Tatopani / Khasa'],
    ['RSW', 'Rasuwa Customs Office', 'रसुवा भन्सार कार्यालय', 'Rasuwa', 'Rasuwagadhi / Kerung'],
    ['PKR', 'Pokhara International Airport Customs Office', 'पोखरा अन्तर्राष्ट्रिय विमानस्थल भन्सार कार्यालय', 'Kaski', 'Pokhara Airport'],
    ['BHW', 'Bhairahawa Customs Office', 'भैरहवा भन्सार कार्यालय', 'Rupandehi', 'Belahiya'],
    ['BHW-ICD', 'Bhairahawa Dry Port (ICD) Customs Office', 'भैरहवा सुख्खा बन्दरगाह भन्सार कार्यालय', 'Rupandehi', 'Bhairahawa ICD'],
    ['GBIA', 'Gautam Buddha International Airport Customs Office', 'गौतम बुद्ध अन्तर्राष्ट्रिय विमानस्थल भन्सार कार्यालय', 'Rupandehi', 'GBIA'],
    ['KRN', 'Krishnanagar Customs Office', 'कृष्णनगर भन्सार कार्यालय', 'Kapilvastu', 'Krishnanagar'],
    ['KLB', 'Koilabas Customs Office', 'कोइलाबास भन्सार कार्यालय', 'Dang', 'Koilabas'],
    ['NPJ', 'Nepalgunj Customs Office', 'नेपालगञ्ज भन्सार कार्यालय', 'Banke', 'Jamunaha'],
    ['KLI', 'Kailali Customs Office', 'कैलाली भन्सार कार्यालय', 'Kailali', 'Gaurifanta / Dhangadhi'],
    ['MNR', 'Mahendranagar Customs Office', 'महेन्द्रनगर भन्सार कार्यालय', 'Kanchanpur', 'Gaddachauki'],
    ['KMK', 'Kimathanka Customs Office', 'किमाथाङ्का भन्सार कार्यालय', 'Sankhuwasabha', 'Kimathanka'],
    ['OLG', 'Olangchungola Customs Office', 'ओलाङचुङगोला भन्सार कार्यालय', 'Taplejung', 'Olangchungola'],
    ['KRL', 'Korala Customs Office', 'कोरला भन्सार कार्यालय', 'Mustang', 'Korala'],
    ['YRI', 'Yari Customs Office', 'यारी भन्सार कार्यालय', 'Humla', 'Yari / Hilsa']
];

// first time only (no default code present yet): add Nepal's offices, skipping names the company already has
async function ensureDefaults(c, t) {
    const { data: have } = await c.from('customs_offices').select('office_code, office_name').eq('tenant_id', t);
    const codes = new Set((have || []).map(x => x.office_code)), names = new Set((have || []).map(x => String(x.office_name || '').trim().toLowerCase()));
    if (NEPAL_CUSTOMS_OFFICES.some(([code]) => codes.has(code))) return 0;
    const rows = NEPAL_CUSTOMS_OFFICES.filter(([, name]) => !names.has(name.toLowerCase()))
        .map(([code, name, np, district, border]) => ({ tenant_id: t, office_code: code, office_name: name, office_name_np: np, district, border_point: border, location: district, is_active: true }));
    if (!rows.length) return 0;
    const { error } = await c.from('customs_offices').insert(rows);
    if (error) throw error;
    return rows.length;
}

module.exports = { NEPAL_CUSTOMS_OFFICES, ensureDefaults };

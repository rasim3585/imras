// Ülke adı → bayrak emoji (Nesine lig başlıkları esinli). Backend gerçek futbol
// verisi İngilizce ülke adı verir; ISO2'ye map edip regional-indicator emoji üretiriz.
// Eşleşmeyen ad → boş (başlık ikonu zaten var). Sanal ligler "Simulated" → bayrak yok.

const ISO: Record<string, string> = {
  turkey: 'TR', türkiye: 'TR', england: 'GB', 'united kingdom': 'GB', scotland: 'GB', wales: 'GB',
  spain: 'ES', germany: 'DE', france: 'FR', italy: 'IT', portugal: 'PT', netherlands: 'NL',
  belgium: 'BE', 'usa': 'US', 'united states': 'US', brazil: 'BR', argentina: 'AR', mexico: 'MX',
  russia: 'RU', ukraine: 'UA', poland: 'PL', romania: 'RO', bulgaria: 'BG', greece: 'GR',
  austria: 'AT', switzerland: 'CH', denmark: 'DK', sweden: 'SE', norway: 'NO', finland: 'FI',
  iceland: 'IS', ireland: 'IE', croatia: 'HR', serbia: 'RS', slovenia: 'SI', slovakia: 'SK',
  'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU', moldova: 'MD', georgia: 'GE', armenia: 'AM',
  azerbaijan: 'AZ', kazakhstan: 'KZ', israel: 'IL', 'saudi arabia': 'SA', qatar: 'QA', uae: 'AE',
  'united arab emirates': 'AE', egypt: 'EG', morocco: 'MA', tunisia: 'TN', algeria: 'DZ',
  nigeria: 'NG', ghana: 'GH', senegal: 'SN', 'south africa': 'ZA', japan: 'JP', 'south korea': 'KR',
  korea: 'KR', china: 'CN', india: 'IN', australia: 'AU', 'new zealand': 'NZ', chile: 'CL',
  peru: 'PE', colombia: 'CO', uruguay: 'UY', paraguay: 'PY', ecuador: 'EC', bolivia: 'BO',
  venezuela: 'VE', 'costa rica': 'CR', lebanon: 'LB', iran: 'IR', iraq: 'IQ', canada: 'CA',
  'northern ireland': 'GB', cyprus: 'CY', malta: 'MT', luxembourg: 'LU', estonia: 'EE',
  latvia: 'LV', lithuania: 'LT', belarus: 'BY', 'north macedonia': 'MK', albania: 'AL',
  'bosnia and herzegovina': 'BA', montenegro: 'ME', kosovo: 'XK', 'faroe islands': 'FO',
};

function emojiFromIso(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

/** Flag emoji for a country name, or '' if unknown/virtual. */
export function countryFlag(name: string | null | undefined): string {
  if (!name) return '';
  const iso = ISO[name.trim().toLowerCase()];
  return iso ? emojiFromIso(iso) : '';
}

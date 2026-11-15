/** The 8 divisions and 64 districts of Bangladesh, with English and Bangla names. */

export interface Division {
  id: string;
  en: string;
  bn: string;
}

export interface District {
  id: string;
  en: string;
  bn: string;
  division: string;
}

export const DIVISIONS: readonly Division[] = [
  { id: 'barishal', en: 'Barishal', bn: 'বরিশাল' },
  { id: 'chattogram', en: 'Chattogram', bn: 'চট্টগ্রাম' },
  { id: 'dhaka', en: 'Dhaka', bn: 'ঢাকা' },
  { id: 'khulna', en: 'Khulna', bn: 'খুলনা' },
  { id: 'mymensingh', en: 'Mymensingh', bn: 'ময়মনসিংহ' },
  { id: 'rajshahi', en: 'Rajshahi', bn: 'রাজশাহী' },
  { id: 'rangpur', en: 'Rangpur', bn: 'রংপুর' },
  { id: 'sylhet', en: 'Sylhet', bn: 'সিলেট' },
];

const D = (id: string, en: string, bn: string, division: string): District => ({ id, en, bn, division });

export const DISTRICTS: readonly District[] = [
  // Barishal
  D('barguna', 'Barguna', 'বরগুনা', 'barishal'),
  D('barishal', 'Barishal', 'বরিশাল', 'barishal'),
  D('bhola', 'Bhola', 'ভোলা', 'barishal'),
  D('jhalokati', 'Jhalokati', 'ঝালকাঠি', 'barishal'),
  D('patuakhali', 'Patuakhali', 'পটুয়াখালী', 'barishal'),
  D('pirojpur', 'Pirojpur', 'পিরোজপুর', 'barishal'),
  // Chattogram
  D('bandarban', 'Bandarban', 'বান্দরবান', 'chattogram'),
  D('brahmanbaria', 'Brahmanbaria', 'ব্রাহ্মণবাড়িয়া', 'chattogram'),
  D('chandpur', 'Chandpur', 'চাঁদপুর', 'chattogram'),
  D('chattogram', 'Chattogram', 'চট্টগ্রাম', 'chattogram'),
  D('coxsbazar', "Cox's Bazar", 'কক্সবাজার', 'chattogram'),
  D('cumilla', 'Cumilla', 'কুমিল্লা', 'chattogram'),
  D('feni', 'Feni', 'ফেনী', 'chattogram'),
  D('khagrachhari', 'Khagrachhari', 'খাগড়াছড়ি', 'chattogram'),
  D('lakshmipur', 'Lakshmipur', 'লক্ষ্মীপুর', 'chattogram'),
  D('noakhali', 'Noakhali', 'নোয়াখালী', 'chattogram'),
  D('rangamati', 'Rangamati', 'রাঙ্গামাটি', 'chattogram'),
  // Dhaka
  D('dhaka', 'Dhaka', 'ঢাকা', 'dhaka'),
  D('faridpur', 'Faridpur', 'ফরিদপুর', 'dhaka'),
  D('gazipur', 'Gazipur', 'গাজীপুর', 'dhaka'),
  D('gopalganj', 'Gopalganj', 'গোপালগঞ্জ', 'dhaka'),
  D('kishoreganj', 'Kishoreganj', 'কিশোরগঞ্জ', 'dhaka'),
  D('madaripur', 'Madaripur', 'মাদারীপুর', 'dhaka'),
  D('manikganj', 'Manikganj', 'মানিকগঞ্জ', 'dhaka'),
  D('munshiganj', 'Munshiganj', 'মুন্সীগঞ্জ', 'dhaka'),
  D('narayanganj', 'Narayanganj', 'নারায়ণগঞ্জ', 'dhaka'),
  D('narsingdi', 'Narsingdi', 'নরসিংদী', 'dhaka'),
  D('rajbari', 'Rajbari', 'রাজবাড়ী', 'dhaka'),
  D('shariatpur', 'Shariatpur', 'শরীয়তপুর', 'dhaka'),
  D('tangail', 'Tangail', 'টাঙ্গাইল', 'dhaka'),
  // Khulna
  D('bagerhat', 'Bagerhat', 'বাগেরহাট', 'khulna'),
  D('chuadanga', 'Chuadanga', 'চুয়াডাঙ্গা', 'khulna'),
  D('jashore', 'Jashore', 'যশোর', 'khulna'),
  D('jhenaidah', 'Jhenaidah', 'ঝিনাইদহ', 'khulna'),
  D('khulna', 'Khulna', 'খুলনা', 'khulna'),
  D('kushtia', 'Kushtia', 'কুষ্টিয়া', 'khulna'),
  D('magura', 'Magura', 'মাগুরা', 'khulna'),
  D('meherpur', 'Meherpur', 'মেহেরপুর', 'khulna'),
  D('narail', 'Narail', 'নড়াইল', 'khulna'),
  D('satkhira', 'Satkhira', 'সাতক্ষীরা', 'khulna'),
  // Mymensingh
  D('jamalpur', 'Jamalpur', 'জামালপুর', 'mymensingh'),
  D('mymensingh', 'Mymensingh', 'ময়মনসিংহ', 'mymensingh'),
  D('netrokona', 'Netrokona', 'নেত্রকোনা', 'mymensingh'),
  D('sherpur', 'Sherpur', 'শেরপুর', 'mymensingh'),
  // Rajshahi
  D('bogura', 'Bogura', 'বগুড়া', 'rajshahi'),
  D('chapainawabganj', 'Chapai Nawabganj', 'চাঁপাইনবাবগঞ্জ', 'rajshahi'),
  D('joypurhat', 'Joypurhat', 'জয়পুরহাট', 'rajshahi'),
  D('naogaon', 'Naogaon', 'নওগাঁ', 'rajshahi'),
  D('natore', 'Natore', 'নাটোর', 'rajshahi'),
  D('pabna', 'Pabna', 'পাবনা', 'rajshahi'),
  D('rajshahi', 'Rajshahi', 'রাজশাহী', 'rajshahi'),
  D('sirajganj', 'Sirajganj', 'সিরাজগঞ্জ', 'rajshahi'),
  // Rangpur
  D('dinajpur', 'Dinajpur', 'দিনাজপুর', 'rangpur'),
  D('gaibandha', 'Gaibandha', 'গাইবান্ধা', 'rangpur'),
  D('kurigram', 'Kurigram', 'কুড়িগ্রাম', 'rangpur'),
  D('lalmonirhat', 'Lalmonirhat', 'লালমনিরহাট', 'rangpur'),
  D('nilphamari', 'Nilphamari', 'নীলফামারী', 'rangpur'),
  D('panchagarh', 'Panchagarh', 'পঞ্চগড়', 'rangpur'),
  D('rangpur', 'Rangpur', 'রংপুর', 'rangpur'),
  D('thakurgaon', 'Thakurgaon', 'ঠাকুরগাঁও', 'rangpur'),
  // Sylhet
  D('habiganj', 'Habiganj', 'হবিগঞ্জ', 'sylhet'),
  D('moulvibazar', 'Moulvibazar', 'মৌলভীবাজার', 'sylhet'),
  D('sunamganj', 'Sunamganj', 'সুনামগঞ্জ', 'sylhet'),
  D('sylhet', 'Sylhet', 'সিলেট', 'sylhet'),
];

/** Older or alternative English spellings people still type. */
const ALIASES: Record<string, string> = {
  chittagong: 'chattogram',
  comilla: 'cumilla',
  jessore: 'jashore',
  bogra: 'bogura',
  barisal: 'barishal',
  coxbazar: 'coxsbazar',
  khagrachari: 'khagrachhari',
  chapai: 'chapainawabganj',
  nawabganj: 'chapainawabganj',
  laxmipur: 'lakshmipur',
  moulvibazaar: 'moulvibazar',
  netrakona: 'netrokona',
  jhalakati: 'jhalokati',
  maulvibazar: 'moulvibazar',
};

const BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]));

export function getDistrict(id: string): District | undefined {
  return BY_ID.get(id);
}

export function getDivision(id: string): Division | undefined {
  return DIVISIONS.find((d) => d.id === id);
}

export function districtsOf(divisionId: string): District[] {
  return DISTRICTS.filter((d) => d.division === divisionId);
}

function key(text: string): string {
  return text.toLowerCase().normalize('NFC').replace(/[^a-zঀ-৿]/g, '');
}

/** Find a district by id, English name, alias or Bangla name. */
export function findDistrict(text: string): District | undefined {
  const k = key(text.replace(/\s*(district|জেলা)\s*$/i, ''));
  if (!k) return undefined;
  const aliased = ALIASES[k];
  if (aliased) return BY_ID.get(aliased);
  return DISTRICTS.find((d) => d.id === k || key(d.en) === k || key(d.bn) === k);
}

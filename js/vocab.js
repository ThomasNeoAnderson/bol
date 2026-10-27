// vocab.js — the starter board and the default profile.
//
// A "profile" is everything that belongs to one user: buttons, categories,
// saved phrases, routines and settings. It is a plain JSON object, which makes
// it easy to save, snapshot and export. Photos and recordings are NOT stored
// inside it; the profile only holds their ids, and the bytes live in a separate
// IndexedDB store (see store.js).

// Category colours loosely follow the Fitzgerald key used in many AAC systems.
export const STARTER_CATEGORIES = [
  { id: 'needs',    en: 'Needs',    hi: 'ज़रूरतें',  emoji: '🙋', color: '#f4a259', kind: 'core' },
  { id: 'food',     en: 'Food',     hi: 'खाना',     emoji: '🍽️', color: '#e9c46a', kind: 'core' },
  { id: 'feelings', en: 'Feelings', hi: 'भावनाएँ',   emoji: '😀', color: '#f28fad', kind: 'core' },
  { id: 'people',   en: 'People',   hi: 'लोग',      emoji: '👪', color: '#8ecae6', kind: 'core' },
  { id: 'places',   en: 'Places',   hi: 'जगहें',     emoji: '🏠', color: '#90be6d', kind: 'core' },
  { id: 'home',     en: 'Home',     hi: 'घर',       emoji: '🛋️', color: '#b8a1e3', kind: 'core' },
  { id: 'play',     en: 'Play',     hi: 'खेल',      emoji: '🧸', color: '#f7b2bd', kind: 'core' },
  { id: 'school',   en: 'School',   hi: 'स्कूल',     emoji: '🏫', color: '#a3c4f3', kind: 'core' },
  // Routine boards used by the "Now" screen.
  { id: 'morning',  en: 'Morning',  hi: 'सुबह',     emoji: '🌅', color: '#ffd166', kind: 'routine' },
  { id: 'bedtime',  en: 'Bedtime',  hi: 'सोने का समय', emoji: '🌙', color: '#9aa5d1', kind: 'routine' },
  // Personal categories: caregivers fill these with photos.
  { id: 'family',   en: 'Family',   hi: 'परिवार',    emoji: '👨‍👩‍👧', color: '#7fc8a9', kind: 'personal' },
  { id: 'pets',     en: 'Pets',     hi: 'पालतू',     emoji: '🐶', color: '#d4a373', kind: 'personal' },
  { id: 'favs',     en: 'Favourites', hi: 'पसंदीदा', emoji: '⭐', color: '#ffb703', kind: 'personal' },
];

// Compact starter list: [emoji, English, Hindi, ...alternatives]
// Alternatives are [English, Hindi] pairs: other ways to say the same intent,
// shown on long-press.
const RAW = {
  needs: [
    ['✅', 'yes', 'हाँ'],
    ['❌', 'no', 'नहीं'],
    ['🙋', 'help', 'मदद', ['help me please', 'मेरी मदद करो']],
    ['✋', 'stop', 'रुको', ['stop it', 'बंद करो']],
    ['➕', 'more', 'और', ['I want more', 'मुझे और चाहिए']],
    ['🏁', 'finished', 'खत्म', ['I am finished', 'मेरा हो गया']],
    ['🚽', 'toilet', 'शौचालय', ['I need the toilet', 'मुझे शौचालय जाना है']],
    ['💧', 'water', 'पानी', ['I want water', 'मुझे पानी चाहिए'], ["I'm thirsty", 'मुझे प्यास लगी है']],
    ['🧘', 'break', 'आराम', ['I need a break', 'मुझे थोड़ा आराम चाहिए']],
    ['🤕', 'hurts', 'दर्द', ['it hurts', 'दर्द हो रहा है']],
  ],
  food: [
    ['🍽️', 'eat', 'खाना', ['I want to eat', 'मुझे खाना है']],
    ['🫓', 'roti', 'रोटी'],
    ['🍚', 'rice', 'चावल'],
    ['🥣', 'dal', 'दाल'],
    ['🥛', 'milk', 'दूध'],
    ['🍌', 'banana', 'केला'],
    ['🥭', 'mango', 'आम'],
    ['🍪', 'biscuit', 'बिस्कुट'],
    ['🧃', 'juice', 'जूस'],
    ['😋', 'hungry', 'भूख', ["I'm hungry", 'मुझे भूख लगी है']],
  ],
  feelings: [
    ['😀', 'happy', 'खुश', ['I feel happy', 'मैं खुश हूँ']],
    ['😢', 'sad', 'उदास', ['I feel sad', 'मैं उदास हूँ']],
    ['😠', 'angry', 'गुस्सा', ['I am angry', 'मुझे गुस्सा आ रहा है']],
    ['😨', 'scared', 'डर', ['I am scared', 'मुझे डर लग रहा है']],
    ['🥱', 'tired', 'थका हुआ', ['I am tired', 'मैं थक गया हूँ']],
    ['🤒', 'sick', 'बीमार', ['I feel sick', 'मेरी तबीयत ठीक नहीं है']],
    ['🤩', 'excited', 'उत्साहित'],
    ['😌', 'calm', 'शांत'],
    ['🙉', 'too loud', 'बहुत शोर', ['it is too loud', 'बहुत शोर है']],
    ['❤️', 'love', 'प्यार', ['I love you', 'मैं तुमसे प्यार करता हूँ']],
  ],
  people: [
    ['🙋', 'I', 'मैं'],
    ['👉', 'you', 'आप'],
    ['👩', 'mummy', 'मम्मी'],
    ['👨', 'papa', 'पापा'],
    ['👧', 'didi', 'दीदी'],
    ['👦', 'bhaiya', 'भैया'],
    ['👵', 'dadi', 'दादी'],
    ['👴', 'dada', 'दादा'],
    ['🧑‍🏫', 'teacher', 'टीचर'],
    ['🧒', 'friend', 'दोस्त'],
  ],
  places: [
    ['🏠', 'home', 'घर', ['I want to go home', 'मुझे घर जाना है']],
    ['🏫', 'school', 'स्कूल'],
    ['🏞️', 'park', 'पार्क'],
    ['🛒', 'shop', 'दुकान'],
    ['🏥', 'hospital', 'अस्पताल'],
    ['🛕', 'temple', 'मंदिर'],
    ['🌳', 'outside', 'बाहर', ['I want to go outside', 'मुझे बाहर जाना है']],
    ['🚗', 'car', 'गाड़ी'],
    ['🚌', 'bus', 'बस'],
    ['🏡', "nani's house", 'नानी का घर'],
  ],
  home: [
    ['🛏️', 'bed', 'बिस्तर'],
    ['🛁', 'bath', 'नहाना'],
    ['🪥', 'brush teeth', 'ब्रश करना'],
    ['👕', 'clothes', 'कपड़े'],
    ['📺', 'TV', 'टीवी', ['I want to watch TV', 'मुझे टीवी देखना है']],
    ['📱', 'phone', 'फ़ोन'],
    ['🌀', 'fan', 'पंखा', ['turn on the fan', 'पंखा चलाओ']],
    ['💡', 'light', 'लाइट'],
    ['🚪', 'door', 'दरवाज़ा'],
    ['💤', 'sleep', 'सोना', ['I want to sleep', 'मुझे सोना है']],
  ],
  play: [
    ['🧸', 'play', 'खेलना', ['I want to play', 'मुझे खेलना है']],
    ['⚽', 'ball', 'गेंद'],
    ['🛝', 'slide', 'फिसलपट्टी'],
    ['🧱', 'blocks', 'ब्लॉक'],
    ['🎵', 'music', 'गाना', ['play music', 'गाना चलाओ']],
    ['🖍️', 'colours', 'रंग'],
    ['📖', 'book', 'किताब'],
    ['🧩', 'puzzle', 'पहेली'],
    ['🫧', 'bubbles', 'बुलबुले'],
    ['🏃', 'run', 'दौड़ना'],
  ],
  school: [
    ['🎒', 'bag', 'बस्ता'],
    ['✏️', 'pencil', 'पेंसिल'],
    ['✍️', 'write', 'लिखना'],
    ['📚', 'read', 'पढ़ना'],
    ['🎨', 'draw', 'चित्र बनाना'],
    ['🍱', 'tiffin', 'टिफ़िन'],
    ['🤔', "I don't understand", 'मुझे समझ नहीं आया'],
    ['✔️', 'work done', 'काम हो गया', ['I finished my work', 'मेरा काम हो गया']],
    ['🤫', 'quiet', 'शांति'],
    ['⏳', 'wait', 'इंतज़ार', ['please wait', 'रुको, इंतज़ार करो']],
  ],
  morning: [
    ['⏰', 'wake up', 'उठना'],
    ['🚽', 'toilet', 'शौचालय'],
    ['🪥', 'brush teeth', 'ब्रश करना'],
    ['🛁', 'bath', 'नहाना'],
    ['👕', 'get dressed', 'कपड़े पहनना'],
    ['🍳', 'breakfast', 'नाश्ता'],
    ['🥛', 'milk', 'दूध'],
    ['🎒', 'school bag', 'बस्ता'],
  ],
  bedtime: [
    ['🩳', 'pyjamas', 'नाइट सूट'],
    ['🪥', 'brush teeth', 'ब्रश करना'],
    ['📖', 'story', 'कहानी', ['tell me a story', 'कहानी सुनाओ']],
    ['🤗', 'hug', 'गले लगो'],
    ['💡', 'light off', 'लाइट बंद करो'],
    ['💧', 'water', 'पानी'],
    ['💤', 'sleep', 'सोना'],
  ],
  family: [
    ['👩', 'mummy', 'मम्मी'],
    ['👨', 'papa', 'पापा'],
  ],
  pets: [
    ['🐶', 'dog', 'कुत्ता'],
    ['🐱', 'cat', 'बिल्ली'],
  ],
  favs: [],
};

/** Build the list of starter buttons. Each button gets a fixed slot number
 *  inside its category; slots are what keep the layout stable. */
function buildStarterButtons() {
  const buttons = [];
  for (const [cat, rows] of Object.entries(RAW)) {
    rows.forEach((row, slot) => {
      const [emoji, en, hi, ...alts] = row;
      buttons.push({
        id: `${cat}-${slot}`,
        cat,
        slot,               // position in the grid; never changes unless a caregiver moves it
        en, hi,             // label + main spoken text
        emoji,              // placeholder icon
        img: null,          // media id of a photo (optional)
        audio: null,        // media id of a recording (optional)
        hideText: false,
        alts: alts.map(([aEn, aHi]) => ({ en: aEn, hi: aHi, audio: null })),
      });
    });
  }
  return buttons;
}

export const DEFAULT_SETTINGS = {
  lang: 'en',            // 'en' or 'hi'
  rate: 0.9,             // speech speed
  speakOnTap: true,      // speak each word as it is tapped
  cols: 5,               // grid columns
  buttonSize: 'm',       // s | m | l | xl
  textSize: 'm',         // s | m | l | xl
  showText: true,        // show labels under icons
  colorByCategory: true,
  theme: 'light',        // light | dark | contrast | calm
  lockLayout: true,      // when locked, buttons cannot be moved or deleted
  showPhrases: true,
  showRecent: true,
  tapGuardMs: 300,       // ignore a second tap on the same button within this time
  pin: null,             // set on first entry to caregiver mode
  lastBackup: null,      // ISO date of the last export
};

// Default routine rules. First matching rule wins, so specific ones go first.
// days: 0 = Sunday ... 6 = Saturday
export const DEFAULT_ROUTINES = {
  enabled: true,
  fallback: 'needs',
  rules: [
    { id: 'r-breakfast', name: 'Breakfast', from: '07:30', to: '08:30', days: [0,1,2,3,4,5,6], cat: 'food' },
    { id: 'r-morning',   name: 'Morning routine', from: '06:00', to: '09:00', days: [0,1,2,3,4,5,6], cat: 'morning' },
    { id: 'r-lunch',     name: 'Lunch', from: '13:00', to: '14:00', days: [0,1,2,3,4,5,6], cat: 'food' },
    { id: 'r-school',    name: 'School', from: '09:00', to: '14:30', days: [1,2,3,4,5,6], cat: 'school' },
    { id: 'r-dinner',    name: 'Dinner', from: '19:30', to: '20:30', days: [0,1,2,3,4,5,6], cat: 'food' },
    { id: 'r-bedtime',   name: 'Bedtime', from: '20:30', to: '23:59', days: [0,1,2,3,4,5,6], cat: 'bedtime' },
  ],
};

export const SCHEMA_VERSION = 1;

/** A brand-new profile, as used on first launch or after "Reset". */
export function createDefaultProfile() {
  return {
    schema: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    categories: STARTER_CATEGORIES.map(c => ({ ...c })),
    buttons: buildStarterButtons(),
    phrases: [],
    recent: [],
    routines: structuredClone(DEFAULT_ROUTINES),
  };
}

/** Fill in any fields missing from an older or imported profile so the rest of
 *  the code can rely on them existing. Never throws away user data. */
export function normaliseProfile(p) {
  const d = createDefaultProfile();
  if (!p || typeof p !== 'object') return d;
  return {
    schema: SCHEMA_VERSION,
    createdAt: p.createdAt || d.createdAt,
    settings: { ...d.settings, ...(p.settings || {}) },
    categories: Array.isArray(p.categories) && p.categories.length ? p.categories : d.categories,
    buttons: Array.isArray(p.buttons) ? p.buttons.map(b => ({ alts: [], hideText: false, img: null, audio: null, ...b })) : d.buttons,
    phrases: Array.isArray(p.phrases) ? p.phrases : [],
    recent: Array.isArray(p.recent) ? p.recent : [],
    routines: p.routines && Array.isArray(p.routines.rules) ? { ...d.routines, ...p.routines } : d.routines,
  };
}

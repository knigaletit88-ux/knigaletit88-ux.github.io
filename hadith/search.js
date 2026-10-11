// Поиск по хадисам. Один и тот же файл в мини-приложении (hadith/search.js)
// и в боте (hadith-vercel/lib/search.js) — тест бота следит, чтобы они совпадали.
//
// Слово ищется с начала слова: «мать» больше не находит «принимать» и «думать».
// Русские окончания учитываются: «мать» находит «матери», «огонь» — «огня», «молитва» — «молитвой».
// Если точных совпадений нет (слово ещё не дописано), ищутся слова, которые с него начинаются.
// К арабским словам прирастают частицы (ال، و، ب), поэтому они ищутся и внутри слов.

export function normalize(text) {
  return String(text || "")
    .normalize("NFKC").toLowerCase().replace(/ё/g, "е")
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

const ENDINGS = new Set(`
  а я о е и ы у ю ь й
  ом ем ой ей ою ею ам ям ах ях ами ями ов ев ью ья ье ьи ьям ьях ьями ьев ьем
  ия ие ий ии ию ием иям иях иями ией
  ый ая яя ое ее ые ого его ому ему ым им ую юю ых их ыми ими
  ть ти ться тись л ла ло ли лся лась лось лись
  ешь ет ете ут ют ишь ит ите ат ят ется ются ится ятся утся атся
  ешься ишься емся имся етесь итесь юсь усь ся сь йте те тесь йся йтесь
  ил ила или ило ился илась илось ились ить иться
`.split(/\s+/).filter(Boolean)).add("");
// После основы из двух букв («дн» от «день», «сн» от «сон») — только самые частые окончания
const SHORT_ENDINGS = new Set(["", "а", "я", "у", "ю", "е", "и", "ы", "й", "ом", "ем", "ей", "ев", "ям", "ях", "ями"]);
// Слова, у которых основа меняется: мать — матери, имя — имени, небо — небеса
const GROUPS = [
  ["мать", "матер"], ["дочь", "дочер"], ["имя", "имен"], ["время", "времен"], ["бремя", "бремен"],
  ["знамя", "знамен"], ["небо", "небес"], ["чудо", "чудес"], ["ухо", "уш"], ["око", "оч"],
  ["друг", "друз"], ["сестра", "сестер"], ["мусульманин", "мусульман"], ["христианин", "христиан"],
  ["хозяин", "хозяев"], ["дитя", "дитят"],
];
const NOT_VOWEL = "[^аеиоуыэюяьй]";
const FLEETING = new RegExp(`^(.*${NOT_VOWEL})[ео](${NOT_VOWEL})$`);

function russianStems(word) {
  const stems = new Set();
  const add = (s) => { if (s.length >= 2 && s !== word) stems.add(s); };
  for (const ending of ENDINGS) {
    if (!ending || !word.endsWith(ending)) continue;
    const stem = word.slice(0, -ending.length);
    if (stem.length < 3 && !(stem.length === 2 && word.length <= 3)) continue;
    add(stem);
    // говорить → говор-ит, молиться → мол-ятся
    if (/^т(ь|ься|и|ись)$/.test(ending) && stem.length >= 4 && /[аеиоуыя]$/.test(stem)) add(stem.slice(0, -1));
  }
  // Беглая гласная: отец → отца, огонь → огня, день → дня (только от начальной формы — «дела» не даёт «для»)
  for (const s of [word, word.replace(/[ьй]$/, "")]) {
    const m = FLEETING.exec(s);
    if (m) add(m[1] + m[2]);
  }
  // У таких слов берём только их основы: «мать» — мать, матер-и (но не «мат-а»)
  const group = GROUPS.find((g) => g.some((m) => word === m || stems.has(m) || (m.length >= 4 && word.startsWith(m))));
  if (group) return group.filter((m) => m !== word);
  return [...stems];
}

// 2 — то самое слово (с окончанием), 1 — слово только начинается так же, 0 — нет
function makeTerm(word) {
  if (/[؀-ۿ]/.test(word)) return (w) => (w.includes(word) ? 2 : 0);
  if (!/[а-я]/.test(word)) return (w) => (w.startsWith(word) ? 2 : 0);
  if (word.length <= 2) return (w) => (w === word ? 2 : w.startsWith(word) ? 1 : 0); // «не» — не «ней»
  const stems = [word, ...russianStems(word)];
  return (w) => {
    for (const s of stems) {
      if (w.startsWith(s) && (s.length > 2 ? ENDINGS : SHORT_ENDINGS).has(w.slice(s.length))) return 2;
    }
    return w.startsWith(word) ? 1 : 0;
  };
}

export function compile(query) {
  const phrase = normalize(query);
  let words = [...new Set(phrase.split(" ").filter(Boolean))];
  if (words.some((w) => w.length > 1)) words = words.filter((w) => w.length > 1); // «о», «в», «и» не мешают
  return { phrase, terms: words.map(makeTerm) };
}

const wordCache = new WeakMap();
function wordsOf(item) {
  let words = wordCache.get(item);
  if (!words) {
    words = [...new Set(normalize(`${item[1]} ${item[2] || ""} ${item[3] || ""}`).split(" "))];
    wordCache.set(item, words);
  }
  return words;
}

const levelIn = (term, words) => {
  let best = 0;
  for (const w of words) {
    const level = term(w);
    if (level === 2) return 2;
    if (level > best) best = level;
  }
  return best;
};

// items: [[номер, заголовок, текст хадиса?, вступление «От …, что Пророк сказал»?], …]
// → [{id, title, text, intro, inTitle, inText}]: сначала совпадения в заголовке, потом в тексте,
// в конце — только во вступлении (имена передатчиков, «да будет доволен им Аллах»).
export function find(items, query) {
  const q = typeof query === "string" ? compile(query) : query;
  if (!q.terms.length) return [];
  const exact = [], partial = [];
  for (const item of items) {
    const words = wordsOf(item);
    let level = 2;
    for (const term of q.terms) {
      level = Math.min(level, levelIn(term, words));
      if (!level) break;
    }
    if (level) (level === 2 ? exact : partial).push(item);
  }
  const need = exact.length ? 2 : 1;
  const has = (text) => {
    const words = normalize(text).split(" ");
    return q.terms.every((t) => levelIn(t, words) >= need);
  };
  const multi = q.phrase.includes(" ");
  return (exact.length ? exact : partial)
    .map(([id, title, text, intro]) => {
      text = text || title;
      const inTitle = has(title);
      const inText = inTitle || has(`${title} ${text}`);
      const phrase = multi && normalize(`${title} ${text} ${intro || ""}`).includes(q.phrase);
      return { id: String(id), title, text, intro: intro || "", inTitle, inText, rank: (phrase ? 4 : 0) + (inTitle ? 2 : 0) + (inText ? 1 : 0) };
    })
    .sort((a, b) => b.rank - a.rank);
}

const TOKEN = /[\p{L}\p{N}ؐ-ًؚ-ٰٟۖ-ۭـ]+/gu;

// Найденные слова в тексте: точные совпадения, а если их нет — слова, которые начинаются с запроса
function hits(text, q) {
  const found = [[], []];
  for (const m of String(text).matchAll(TOKEN)) {
    const w = normalize(m[0]);
    const level = w ? Math.max(0, ...q.terms.map((t) => t(w))) : 0;
    if (level) found[2 - level].push(m);
  }
  return found[0].length ? found[0] : found[1];
}

// Части текста с пометкой, совпадает ли слово с запросом: [[кусок, найдено?], …]
export function parts(text, query) {
  const q = typeof query === "string" ? compile(query) : query;
  text = String(text);
  const out = [];
  let last = 0;
  for (const m of hits(text, q)) {
    if (m.index > last) out.push([text.slice(last, m.index), false]);
    out.push([m[0], true]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push([text.slice(last), false]);
  return out;
}

// Отрывок вокруг первого найденного слова
export function snippet(text, query, size = 170) {
  text = String(text).replace(/\s+/g, " ").trim();
  if (text.length <= size) return text;
  const q = typeof query === "string" ? compile(query) : query;
  const at = hits(text, q)[0]?.index || 0;
  let start = Math.max(0, at - Math.round(size * 0.35));
  let end = Math.min(text.length, start + size);
  start = Math.max(0, end - size);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length && text.lastIndexOf(" ", end) > start) end = text.lastIndexOf(" ", end);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

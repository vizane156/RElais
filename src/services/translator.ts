import { Glossary, GlossaryRule } from './glossary';

// Dictionnaire et expressions courantes bilingues français <-> anglais
const DICT_FR_EN: Record<string, string> = {
  // Salutations et courtoisie
  "bonjour": "hello",
  "salut": "hi",
  "bonsoir": "good evening",
  "bonne nuit": "good night",
  "au revoir": "goodbye",
  "à bientôt": "see you soon",
  "à plus tard": "see you later",
  "s'il vous plaît": "please",
  "s'il te plaît": "please",
  "merci": "thank you",
  "merci beaucoup": "thank you very much",
  "de rien": "you're welcome",
  "je vous en prie": "you're welcome",
  "avec plaisir": "with pleasure",
  "pardon": "sorry",
  "désolé": "sorry",
  "excusez-moi": "excuse me",
  "comment allez-vous": "how are you",
  "comment vas-tu": "how are you doing",
  "ça va": "how are you",
  "très bien": "very well",
  "bienvenue": "welcome",
  "enchante": "pleased to meet you",
  "enchanté": "nice to meet you",

  // Questions
  "qui": "who",
  "quoi": "what",
  "où": "where",
  "quand": "when",
  "comment": "how",
  "pourquoi": "why",
  "combien": "how much",
  "quelle heure est-il": "what time is it",
  "où est": "where is",
  "où sont": "where are",
  "parlez-vous anglais": "do you speak English",
  "parlez-vous français": "do you speak French",
  "tu parles anglais": "do you speak English",
  "comprenez-vous": "do you understand",
  "peux-tu m'aider": "can you help me",
  "pouvez-vous m'aider": "can you help me",

  // Verbes et phrases courantes
  "je m'appelle": "my name is",
  "je suis": "I am",
  "tu es": "you are",
  "il est": "he is",
  "elle est": "she is",
  "nous sommes": "we are",
  "vous êtes": "you are",
  "ils sont": "they are",
  "j'ai": "I have",
  "tu as": "you have",
  "il a": "he has",
  "nous avons": "we have",
  "j'aime": "I like",
  "je veux": "I want",
  "je voudrais": "I would like",
  "je cherche": "I am looking for",
  "je comprends": "I understand",
  "je ne comprends pas": "I don't understand",
  "je ne sais pas": "I don't know",
  "il fait beau": "the weather is nice",
  "il pleut": "it is raining",
  "c'est bien": "that's good",
  "c'est super": "that's great",
  "c'est vrai": "that's true",
  "d'accord": "okay",
  "oui": "yes",
  "non": "no",
  "peut-être": "maybe",
  "aujourd'hui": "today",
  "demain": "tomorrow",
  "hier": "yesterday",
  "maintenant": "now",
  "tout de suite": "right away",
  "ici": "here",
  "là-bas": "over there",
  "bon": "good",
  "mauvais": "bad",
  "grand": "big",
  "petit": "small",
  "facile": "easy",
  "difficile": "difficult",
  "ami": "friend",
  "famille": "family",
  "travail": "work",
  "maison": "house",
  "voiture": "car",
  "train": "train",
  "gare": "station",
  "aéroport": "airport",
  "hôtel": "hotel",
  "restaurant": "restaurant",
  "café": "coffee",
  "eau": "water",
  "pain": "bread",
  "addition": "bill",
  "relais": "Relais"
};

const DICT_EN_FR: Record<string, string> = {
  // Greetings & Courtesy
  "hello": "bonjour",
  "hi": "salut",
  "good morning": "bonjour",
  "good evening": "bonsoir",
  "good night": "bonne nuit",
  "goodbye": "au revoir",
  "bye": "au revoir",
  "see you soon": "à bientôt",
  "see you later": "à plus tard",
  "please": "s'il vous plaît",
  "thank you": "merci",
  "thank you very much": "merci beaucoup",
  "thanks": "merci",
  "you're welcome": "de rien",
  "welcome": "bienvenue",
  "sorry": "désolé",
  "excuse me": "excusez-moi",
  "how are you": "comment allez-vous",
  "how are you doing": "comment vas-tu",
  "very well": "très bien",
  "nice to meet you": "enchanté",
  "pleased to meet you": "enchanté",

  // Questions
  "who": "qui",
  "what": "quoi",
  "where": "où",
  "when": "quand",
  "how": "comment",
  "why": "pourquoi",
  "how much": "combien",
  "what time is it": "quelle heure est-il",
  "where is": "où est",
  "where are": "où sont",
  "do you speak french": "parlez-vous français",
  "do you speak english": "parlez-vous anglais",
  "do you understand": "comprenez-vous",
  "can you help me": "pouvez-vous m'aider",

  // Verbs & common phrases
  "my name is": "je m'appelle",
  "i am": "je suis",
  "you are": "vous êtes",
  "he is": "il est",
  "she is": "elle est",
  "we are": "nous sommes",
  "they are": "ils sont",
  "i have": "j'ai",
  "you have": "vous avez",
  "he has": "il a",
  "we have": "nous avons",
  "i like": "j'aime",
  "i want": "je veux",
  "i would like": "je voudrais",
  "i am looking for": "je cherche",
  "i understand": "je comprends",
  "i don't understand": "je ne comprends pas",
  "i do not understand": "je ne comprends pas",
  "i don't know": "je ne sais pas",
  "the weather is nice": "il fait beau",
  "it is raining": "il pleut",
  "that's good": "c'est bien",
  "that's great": "c'est super",
  "that's true": "c'est vrai",
  "okay": "d'accord",
  "yes": "oui",
  "no": "non",
  "maybe": "peut-être",
  "today": "aujourd'hui",
  "tomorrow": "demain",
  "yesterday": "hier",
  "now": "maintenant",
  "right away": "tout de suite",
  "here": "ici",
  "there": "là-bas",
  "good": "bon",
  "bad": "mauvais",
  "big": "grand",
  "small": "petit",
  "easy": "facile",
  "difficult": "difficile",
  "friend": "ami",
  "family": "famille",
  "work": "travail",
  "house": "maison",
  "car": "voiture",
  "train": "train",
  "station": "gare",
  "airport": "aéroport",
  "hotel": "hôtel",
  "restaurant": "restaurant",
  "coffee": "café",
  "water": "eau",
  "bread": "pain",
  "bill": "addition",
  "relais": "Relais"
};

// Mots isolés supplémentaires pour traduction mot-à-mot fluide
const WORD_FR_EN: Record<string, string> = {
  "le": "the", "la": "the", "les": "the", "un": "a", "une": "a", "des": "some",
  "ce": "this", "cette": "this", "ces": "these", "et": "and", "ou": "or", "mais": "but",
  "avec": "with", "sans": "without", "pour": "for", "dans": "in", "sur": "on", "sous": "under",
  "à": "to", "de": "of", "très": "very", "trop": "too", "plus": "more", "moins": "less",
  "beaucoup": "a lot", "vite": "fast", "lentement": "slowly", "toujours": "always", "jamais": "never",
  "temps": "time", "jour": "day", "nuit": "night", "matin": "morning", "soir": "evening",
  "monde": "world", "personne": "person", "chose": "thing", "mot": "word", "voix": "voice"
};

const WORD_EN_FR: Record<string, string> = {
  "the": "le", "a": "un", "an": "un", "some": "des", "this": "ce", "that": "cela",
  "these": "ces", "and": "et", "or": "ou", "but": "mais", "with": "avec", "without": "sans",
  "for": "pour", "in": "dans", "on": "sur", "under": "sous", "to": "à", "of": "de",
  "very": "très", "too": "trop", "more": "plus", "less": "moins", "fast": "vite",
  "slowly": "lentement", "always": "toujours", "never": "jamais", "time": "temps",
  "day": "jour", "night": "nuit", "morning": "matin", "evening": "soir", "world": "monde",
  "voice": "voix"
};

export async function translateText(
  text: string,
  fromLang: string,
  toLang: string,
  glossaryRules: GlossaryRule[] = [],
  useGlossary: boolean = true
): Promise<{ text: string; ms: number }> {
  const t0 = performance.now();
  if (!text || !text.trim()) {
    return { text: '', ms: 0 };
  }

  const glossary = useGlossary ? new Glossary(glossaryRules) : null;
  const { protectedText, slots } = glossary ? glossary.protect(text, fromLang) : { protectedText: text, slots: [] };

  const isFrToEn = fromLang === 'fr' || toLang === 'en';
  const dict = isFrToEn ? DICT_FR_EN : DICT_EN_FR;
  const wordDict = isFrToEn ? WORD_FR_EN : WORD_EN_FR;

  const rawLower = protectedText.toLowerCase().trim();
  const cleanPunct = rawLower.replace(/[.,!?;:…]+$/, '');
  const endingPunctMatch = protectedText.match(/[.,!?;:…]+$/);
  const endingPunct = endingPunctMatch ? endingPunctMatch[0] : '';

  let translated = '';

  // 1. Exact match in phrase dictionary
  if (dict[cleanPunct]) {
    translated = dict[cleanPunct];
  } else {
    // 2. Phrase matching with greedy replacement
    let working = protectedText;
    const sortedPhrases = Object.keys(dict).sort((a, b) => b.length - a.length);

    for (const phrase of sortedPhrases) {
      if (phrase.includes(' ')) {
        const regex = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
        working = working.replace(regex, dict[phrase]);
      }
    }

    // 3. Word-by-word replacement for remaining words
    const words = working.split(/(\s+|[,;:.!?…]+)/);
    const mappedWords = words.map((chunk) => {
      if (!chunk.trim() || /[,;:.!?…]/.test(chunk)) return chunk;
      const lower = chunk.toLowerCase();
      if (dict[lower]) {
        return matchCase(chunk, dict[lower]);
      }
      if (wordDict[lower]) {
        return matchCase(chunk, wordDict[lower]);
      }
      return chunk;
    });

    translated = mappedWords.join('');
  }

  // Capitalize first letter if original started with capital
  if (protectedText.length > 0 && protectedText[0] === protectedText[0].toUpperCase() && translated.length > 0) {
    translated = translated.charAt(0).toUpperCase() + translated.slice(1);
  }

  // Attach ending punctuation if it was stripped
  if (endingPunct && !translated.endsWith(endingPunct)) {
    translated += endingPunct;
  }

  // Restore glossary slots
  if (glossary && slots.length) {
    translated = glossary.restore(translated, slots);
  }

  const ms = Math.round(performance.now() - t0);
  return { text: translated, ms };
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCase(source: string, target: string): string {
  if (source.length === 0 || target.length === 0) return target;
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

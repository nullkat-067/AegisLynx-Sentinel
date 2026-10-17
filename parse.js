const FIELD_ALIASES = {
  name: ['nama', 'name'],
  age: ['umur', 'usia', 'age'],
  username: ['username', 'user name', 'roblox username', 'roblox'],
  gender: ['gender', 'jenis kelamin', 'jk'],
  city: ['askot', 'asal kota', 'kota', 'domisili'],
  reason: ['alasan masuk', 'alasan', 'reason'],
  joinVia: ['join grup lewat mana', 'join grup', 'masuk lewat', 'lewat mana', 'join via'],
};

export function normalizeForMatching(value) {
  const substitutions = {
    'ꭑ': 'm', 'ⴎ': 'u', 'ɾ': 'r', 'ҽ': 'e', 'ղ': 'n', 'ժ': 'd', 'ƙ': 'k', '᥆': 'o',
    '⟊': 't', 'ꫀ': 'e', '𐓣': 'n', '𐓺': 'n', 'ꭖ': 'x', '⍺': 'a', 'ძ': 'd', 'ყ': 'y',
    '᥍': 'n', 'ᥣ': 'l', 'ᥒ': 'n', 'ꪱ': 'i', 'ᥙ': 'u', '⍴': 'p', '⍹': 'w', '𐐼': 'a',
    '𐓼': 's', 'ׅ': '', '︩': '', '︪': '', '𑅁': 'i', '𝗮': 'a', '𝗯': 'b', '𝗰': 'c',
    '𝗱': 'd', '𝗲': 'e', '𝗳': 'f', '𝗴': 'g', '𝗵': 'h', '𝗶': 'i', '𝗷': 'j', '𝗸': 'k',
    '𝗹': 'l', '𝗺': 'm', '𝗻': 'n', '𝗼': 'o', '𝗽': 'p', '𝗾': 'q', '𝗿': 'r', '𝘀': 's',
    '𝘁': 't', '𝘂': 'u', '𝘃': 'v', '𝘄': 'w', '𝘅': 'x', '𝘆': 'y', '𝘇': 'z',
  };
  return [...String(value).normalize('NFKC').normalize('NFD')]
    .filter((character) => !/\p{M}/u.test(character))
    .map((character) => substitutions[character] ?? character)
    .join('')
    .toLowerCase();
}

export function getMessageText(message) {
  let content = message?.message;
  content = content?.ephemeralMessage?.message
    ?? content?.viewOnceMessage?.message
    ?? content?.viewOnceMessageV2?.message
    ?? content;
  if (!content) return '';
  return content.conversation
    ?? content.extendedTextMessage?.text
    ?? content.imageMessage?.caption
    ?? content.videoMessage?.caption
    ?? '';
}

export function getMessageType(message) {
  const content = message?.message || {};
  return Object.keys(content).find((key) => !key.endsWith('MessageContextInfo')) || 'unknown';
}

function cleanValue(value) {
  return String(value || '').replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '').trim();
}

function parseFieldLines(text) {
  return String(text).split(/\r?\n/).map((line) => {
    const normalized = normalizeForMatching(line);
    const separator = normalized.search(/[:=\-]/u);
    return {
      normalized,
      value: cleanValue(separator >= 0 ? normalized.slice(separator + 1) : normalized),
    };
  }).filter((line) => line.normalized);
}

function findFieldValue(lines, aliases) {
  for (const line of lines) {
    const alias = aliases.find((candidate) => line.normalized.includes(candidate));
    if (!alias) continue;
    const aliasIndex = line.normalized.indexOf(alias);
    const value = cleanValue(line.normalized.slice(aliasIndex + alias.length).replace(/^[^\p{L}\p{N}]+/u, ''));
    if (value) return value;
  }
  return null;
}

export function parseIntro(text) {
  const lines = parseFieldLines(text);
  const normalizedText = normalizeForMatching(text);
  const fields = {
    name: findFieldValue(lines, FIELD_ALIASES.name),
    age: null,
    username: findFieldValue(lines, FIELD_ALIASES.username),
    gender: findFieldValue(lines, FIELD_ALIASES.gender),
    city: findFieldValue(lines, FIELD_ALIASES.city),
    reason: findFieldValue(lines, FIELD_ALIASES.reason),
    joinVia: findFieldValue(lines, FIELD_ALIASES.joinVia),
  };
  const ageLine = lines.find((line) => FIELD_ALIASES.age.some((alias) => line.normalized.includes(alias)));
  const ageMatch = (ageLine?.normalized || normalizedText).match(/(?:umur|usia|age)\D{0,30}(\d{1,3})\b/u);
  fields.age = ageMatch ? Number.parseInt(ageMatch[1], 10) : null;
  const isIntro = Boolean(fields.name && Number.isInteger(fields.age) && fields.username);
  return { fields, isIntro };
                        }

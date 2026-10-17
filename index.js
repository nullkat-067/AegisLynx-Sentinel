import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { getMessageText, getMessageType, normalizeForMatching, parseIntro } from './Parse.js';
import pino from 'pino';
import readline from 'node:readline/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(PROJECT_DIR, 'auth_info_baileys');
const INFORMATION_DIR = join(PROJECT_DIR, 'Information');
const OWNER_FILE = join(INFORMATION_DIR, 'owner.json');
const ADMIN_FILE = join(INFORMATION_DIR, 'admin.json');
const CONFIG_FILE = join(INFORMATION_DIR, 'config.json');
const INTRO_FILE = join(INFORMATION_DIR, 'intro.json');
const KICK_LOG_FILE = join(INFORMATION_DIR, 'kick.json');
const MODLOG_FILE = join(INFORMATION_DIR, 'modlog.json');
const DEFAULT_MINIMUM_AGE = 12;
const BRAND = 'AegisLynx Sentinel';
const WARNING_MESSAGE = 'Maaf, kamu belum cukup umur untuk masuk ke grup ini.';
const CREDIT_MESSAGE = `Made by: NullKat Development\nBot engine: ${BRAND}`;
const logger = pino({ level: 'silent' });

function loadLocalEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Gagal membaca .env: ${error.message}`);
  }
}

loadLocalEnv(join(PROJECT_DIR, '.env'));

const COLOR = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m',
  magenta: '\x1b[35m', blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const paint = (color, text) => `${COLOR[color]}${text}${COLOR.reset}`;
const logInfo = (text) => console.log(`${paint('cyan', 'ℹ')} ${text}`);
const logSuccess = (text) => console.log(`${paint('green', '✔')} ${text}`);
const logWarn = (text) => console.log(`${paint('yellow', '⚠')} ${text}`);
const logError = (text) => console.error(`${paint('red', '✖')} ${text}`);

function printBanner() {
  console.log(paint('cyan', '╭────────────────────────────────────────────────────╮'));
  console.log(`${paint('cyan', '│')}  ${paint('bold', BRAND.padEnd(46))}${paint('cyan', '│')}`);
  console.log(`${paint('cyan', '│')}  ${paint('dim', 'Flexible intro validation • Safe group moderation'.padEnd(46))}${paint('cyan', '│')}`);
  console.log(`${paint('cyan', '│')}  ${paint('red', 'made by: NullKat Development'.padEnd(46))}${paint('cyan', '│')}`);
  console.log(paint('cyan', '╰────────────────────────────────────────────────────╯'));
  console.log(`${paint('blue', 'Mode:')} all groups   ${paint('blue', 'Minimum age:')} configurable\n`);
}

let pairingCodeRequested = false;
let phoneNumberPromise;
let minimumAge = DEFAULT_MINIMUM_AGE;
let kickQueue = Promise.resolve();
let introQueue = Promise.resolve();
let modlogQueue = Promise.resolve();
const botStartedAt = Date.now();
const detectedGroups = new Set();
const messageEvidenceCache = new Map();

async function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') logError(`Gagal membaca ${filePath}: ${error.message}`);
    return [];
  }
}

async function writeJsonArray(filePath, values) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
}

async function readJsonObject(filePath, fallback = {}) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    if (error.code !== 'ENOENT') logError(`Gagal membaca ${filePath}: ${error.message}`);
    return fallback;
  }
}

function appendRecord(filePath, record, queueName) {
  if (queueName === 'kick') kickQueue = kickQueue.then(async () => writeJsonArray(filePath, [...await readJsonArray(filePath), record]));
  if (queueName === 'intro') introQueue = introQueue.then(async () => writeJsonArray(filePath, [...await readJsonArray(filePath), record]));
  if (queueName === 'modlog') modlogQueue = modlogQueue.then(async () => writeJsonArray(filePath, [...(await readJsonArray(filePath)).slice(-1999), record]));
  const queue = queueName === 'kick' ? kickQueue : queueName === 'intro' ? introQueue : modlogQueue;
  return queue.catch((error) => logError(`Gagal menyimpan ${filePath}: ${error.message}`));
}

async function loadConfig() {
  const config = await readJsonObject(CONFIG_FILE, { minimumAge: DEFAULT_MINIMUM_AGE });
  const value = Number.parseInt(config.minimumAge, 10);
  if (Number.isInteger(value) && value >= 1 && value <= 100) minimumAge = value;
}

function formatUptime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 86400)} hari, ${Math.floor((seconds % 86400) / 3600)} jam, ${Math.floor((seconds % 3600) / 60)} menit, ${seconds % 60} detik`;
}

async function isOwner(number) {
  return (await readJsonArray(OWNER_FILE)).map(normalizePhoneNumber).includes(normalizePhoneNumber(number));
}

async function isConfiguredAdmin(number) {
  return (await readJsonArray(ADMIN_FILE)).map(normalizePhoneNumber).includes(normalizePhoneNumber(number));
}

async function isGroupAdmin(socket, message) {
  const groupJid = message.key.remoteJid;
  if (!groupJid?.endsWith('@g.us')) return false;
  try {
    const metadata = await socket.groupMetadata(groupJid);
    const sender = getSenderJid(message);
    const participant = metadata.participants.find((entry) => isSameUser(entry.id, sender) || isSameUser(entry.lid, sender) || isSameUser(entry.jid, sender));
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch (error) {
    logError(`[${groupJid}] Gagal memeriksa admin: ${error.message}`);
    return false;
  }
}

async function sendLongMessage(socket, jid, text) {
  for (const chunk of String(text).match(/[\s\S]{1,3500}/g) || ['']) await socket.sendMessage(jid, { text: chunk });
}

async function handleCommand(socket, message, requestReload, requestStop) {
  const text = getMessageText(message).trim();
  if (!text.startsWith('!')) return false;
  const senderNumber = normalizePhoneNumber(jidUserPart(getSenderJid(message)));
  const command = text.split(/\s+/)[0].toLowerCase();
  const owner = await isOwner(senderNumber);
  const admin = owner || await isConfiguredAdmin(senderNumber) || await isGroupAdmin(socket, message);
  if (command === '!credit') {
    await socket.sendMessage(message.key.remoteJid, { text: CREDIT_MESSAGE });
    return true;
  }
  if (!admin) return true;
  if (command === '!help') {
    await socket.sendMessage(message.key.remoteJid, { text: [
      `╭─ ${BRAND} ─╮`, '│ !help — daftar command', '│ !status — status bot', '│ !config — lihat batas umur',
      '│ !config <angka> — ubah batas umur', '│ !kickstats — riwayat kick', '│ !introstats — database intro',
      '│ !modlog — log moderasi', owner ? '│ !addowner <nomor> — tambah owner' : '', '╰────────────────────╯',
    ].filter(Boolean).join('\n') });
    return true;
  }
  if (command === '!status' || command === '!statues') {
    const kicks = await readJsonArray(KICK_LOG_FILE);
    await socket.sendMessage(message.key.remoteJid, { text: `STATUS ${BRAND}\n\nAktif: ya\nUptime: ${formatUptime(Date.now() - botStartedAt)}\nGrup terdeteksi: ${detectedGroups.size}\nTotal kick: ${kicks.length}\nBatas umur: ${minimumAge}+` });
    return true;
  }
  if (command === '!config') {
    const value = Number.parseInt(text.split(/\s+/)[1], 10);
    if (!Number.isInteger(value)) {
      await socket.sendMessage(message.key.remoteJid, { text: `Batas saat ini: ${minimumAge}\nCara ubah: !config 13\nUmur di bawah angka tersebut akan dikick.` });
    } else if (value < 1 || value > 100) {
      await socket.sendMessage(message.key.remoteJid, { text: 'Batas umur harus antara 1 sampai 100.' });
    } else {
      minimumAge = value;
      await writeFile(CONFIG_FILE, `${JSON.stringify({ minimumAge }, null, 2)}\n`, 'utf8');
      await socket.sendMessage(message.key.remoteJid, { text: `Batas umur disimpan: ${minimumAge}. Umur di bawah ${minimumAge} akan dikick.` });
    }
    return true;
  }
  if (command === '!kickstats' || command === '!introstats' || command === '!modlog') {
    const file = command === '!kickstats' ? KICK_LOG_FILE : command === '!introstats' ? INTRO_FILE : MODLOG_FILE;
    const name = command.slice(1);
    const records = await readJsonArray(file);
    await sendLongMessage(socket, message.key.remoteJid, `${name} (${records.length})\n\n${records.length ? JSON.stringify(records.slice(-100), null, 2) : 'Belum ada data.'}`);
    return true;
  }
  if (command === '!addowner' && owner) {
    const number = normalizePhoneNumber(text.split(/\s+/)[1]);
    if (!/^62\d{8,15}$/.test(number)) await socket.sendMessage(message.key.remoteJid, { text: 'Format nomor tidak valid.' });
    else {
      const owners = await readJsonArray(OWNER_FILE);
      if (!owners.map(normalizePhoneNumber).includes(number)) owners.push(number);
      await writeJsonArray(OWNER_FILE, owners);
      await socket.sendMessage(message.key.remoteJid, { text: `Owner tersimpan: ${number}` });
    }
    return true;
  }
  if (command === '!reload') {
    if (owner) await requestReload(message.key.remoteJid);
    return true;
  }
  if (command === '!stop') {
    if (owner) await requestStop(message.key.remoteJid);
    return true;
  }
  return true;
}

function getEvidence(message) {
  return {
    id: message.key.id,
    senderJid: getSenderJid(message),
    nomor: jidUserPart(getSenderJid(message)),
    text: getMessageText(message).slice(0, 2000),
    tipePesan: getMessageType(message),
    waktu: new Date().toISOString(),
  };
}

function detectRules(message) {
  const text = getMessageText(message);
  const normalized = normalizeForMatching(text);
  const rules = [];
  if (/(18\s*\+|18plus|seks|porno|porn|nsfw|bokep|telanjang)/u.test(normalized)) rules.push('adult_content');
  if (/(jomok|mesum|cabul|kontol|memek|ngentot)/u.test(normalized)) rules.push('vulgar');
  if (/https?:\/\/|www\.|chat\.whatsapp\.com/iu.test(text)) rules.push('link');
  if (/(jual|jualan|promosi|promo|open\s*po|di\s*jual)/iu.test(normalized)) rules.push('promotion');
  const content = message.message || {};
  if (content.audioMessage || content.pttMessage) rules.push('audio');
  return rules;
}

async function logRules(socket, message, groupJid, codes, extra = {}) {
  if (!codes.length) return;
  let groupName = groupJid;
  try { groupName = (await socket.groupMetadata(groupJid)).subject || groupJid; } catch {}
  const evidence = getEvidence(message);
  await appendRecord(MODLOG_FILE, {
    id: evidence.id, grup: groupName, groupJid, nomor: evidence.nomor, senderJid: evidence.senderJid,
    aturan: codes.map((code) => MODERATION_RULE_NAMES[code] || code), kodeAturan: codes,
    buktiChat: evidence.text || `[${evidence.tipePesan}]`, tipePesan: evidence.tipePesan,
    dikick: Boolean(extra.kicked), statusKick: extra.statusKick || 'tidak_dilakukan',
    pesanDihapus: Boolean(extra.deleted), waktu: evidence.waktu,
  }, 'modlog');
}

function findParticipant(metadata, senderJid) {
  return metadata?.participants?.find((entry) => isSameUser(entry.id, senderJid) || isSameUser(entry.lid, senderJid) || isSameUser(entry.jid, senderJid));
}

async function kickUnderage(socket, message, state, age) {
  const groupJid = message.key.remoteJid;
  const senderJid = getSenderJid(message);
  let metadata;
  try { metadata = await socket.groupMetadata(groupJid); } catch (error) {
    logError(`[${groupJid}] Metadata grup gagal dibaca: ${error.message}`);
    return;
  }
  const botIds = getBotJidCandidates(socket, state);
  const bot = metadata.participants.find((entry) => botIds.some((id) => isSameUser(entry.id, id) || isSameUser(entry.lid, id) || isSameUser(entry.jid, id)));
  const botAdmin = bot?.admin === 'admin' || bot?.admin === 'superadmin';
  logInfo(`[${groupJid}] Bot admin=${botAdmin ? 'ya' : 'tidak'}; botId=${bot?.id || 'tidak ditemukan'}; sender=${senderJid}; umur=${age}.`);
  if (!botAdmin) {
    await logRules(socket, message, groupJid, ['underage_intro'], { statusKick: 'bot_bukan_admin' });
    return;
  }
  const participant = findParticipant(metadata, senderJid);
  const targets = [...new Set([participant?.id, participant?.jid, participant?.lid, senderJid].filter(Boolean))];
  let kicked = false;
  let lastError;
  try { await socket.sendMessage(groupJid, { text: WARNING_MESSAGE }); } catch (error) { logWarn(`[${groupJid}] Peringatan gagal dikirim: ${error.message}`); }
  for (const target of targets) {
    try {
      await socket.groupParticipantsUpdate(groupJid, [target], 'remove');
      kicked = true;
      logSuccess(`[${groupJid}] Member umur ${age} berhasil dikeluarkan dengan target ${target}.`);
      break;
    } catch (error) {
      lastError = error;
      logWarn(`[${groupJid}] Target kick ${target} gagal: ${error.message}`);
    }
  }
  if (!kicked) logError(`[${groupJid}] Kick gagal: ${lastError?.message || 'target tidak ditemukan'}`);
  await appendRecord(KICK_LOG_FILE, { nomor: jidUserPart(senderJid), umur: age, grup: metadata.subject || groupJid, groupJid, waktu: new Date().toISOString(), status: kicked ? 'berhasil' : 'gagal' }, 'kick');
  await logRules(socket, message, groupJid, ['underage_intro'], { kicked, statusKick: kicked ? 'berhasil' : 'gagal' });
}

async function askPhoneNumber() {
  if (!phoneNumberPromise) phoneNumberPromise = (async () => {
    const rl = readline.createInterface({ input, output });
    try { return (await rl.question('Masukkan nomor WhatsApp dengan kode negara: ')).replace(/\D/g, ''); } finally { rl.close(); }
  })();
  return phoneNumberPromise;
}

async function requestPairing(socket, state) {
  if (state.creds.registered || pairingCodeRequested) return;
  pairingCodeRequested = true;
  try {
    const code = await socket.requestPairingCode(await askPhoneNumber());
    console.log(`${paint('green', 'PAIRING CODE')}: ${paint('bold', code)}`);
  } catch (error) {
    pairingCodeRequested = false;
    logError(`Gagal membuat pairing code: ${error.message}`);
  }
}

async function startBot() {
  await loadConfig();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  logInfo(`Session: ${state.creds.registered ? 'terdaftar' : 'belum terdaftar'} | Folder: ${AUTH_DIR}`);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }
  const socket = makeWASocket({ ...(version ? { version } : {}), auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) }, logger, browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false, syncFullHistory: false });
  let intentionalAction = null;
  const requestReload = async (jid) => { intentionalAction = 'reload'; await socket.sendMessage(jid, { text: `${BRAND} sedang reload.` }); await socket.end(undefined); };
  const requestStop = async (jid) => { intentionalAction = 'stop'; await socket.sendMessage(jid, { text: `${BRAND} dimatikan.` }); await socket.end(undefined); setTimeout(() => process.exit(0), 500); };
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('messages.update', async (updates) => {
    for (const { key, update } of updates) {
      const revoke = String(update?.messageStubType || '').toLowerCase().includes('revoke') || update?.messageStubType === 68;
      const cached = messageEvidenceCache.get(`${key.remoteJid}:${key.id}`);
      if (revoke && cached) {
        await logRules(socket, cached.message, key.remoteJid, ['deleted'], { deleted: true });
        messageEvidenceCache.delete(`${key.remoteJid}:${key.id}`);
      }
    }
  });
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !state.creds.registered) await requestPairing(socket, state);
    if (connection === 'open') { pairingCodeRequested = false; logSuccess(`${BRAND} terhubung sebagai ${socket.user?.id || 'akun tidak diketahui'}.`); }
    if (connection !== 'close') return;
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    if (intentionalAction === 'stop') return;
    if (intentionalAction === 'reload') { intentionalAction = null; pairingCodeRequested = false; phoneNumberPromise = undefined; setTimeout(() => startBot().catch((error) => logError(error.message)), 1000); return; }
    if (statusCode === DisconnectReason.loggedOut) { logError('Session logout. Hapus auth_info_baileys hanya jika memang ingin pairing ulang.'); return; }
    logWarn(`Koneksi terputus (${statusCode ?? 'tidak diketahui'}). Mencoba tersambung lagi...`);
    pairingCodeRequested = false; phoneNumberPromise = undefined;
    setTimeout(() => startBot().catch((error) => logError(`Gagal reconnect: ${error.message}`)), 3000);
  });
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      if (message.key.fromMe) continue;
      try {
        if (await handleCommand(socket, message, requestReload, requestStop)) continue;
        const groupJid = message.key.remoteJid;
        if (!groupJid?.endsWith('@g.us')) continue;
        detectedGroups.add(groupJid);
        const text = getMessageText(message);
        const parsed = parseIntro(text);
        logInfo(`[${groupJid}] Intro=${parsed.isIntro ? 'valid' : 'belum lengkap'} | umur=${parsed.fields.age ?? '-'} | batas=${minimumAge}.`);
        messageEvidenceCache.set(`${groupJid}:${message.key.id}`, { message });
        if (!parsed.isIntro) {
          await logRules(socket, message, groupJid, detectRules(message));
          continue;
        }
        const senderJid = getSenderJid(message);
        await appendRecord(INTRO_FILE, {
          nama: parsed.fields.name,
          umur: parsed.fields.age,
          username: parsed.fields.username,
          gender: parsed.fields.gender,
          askot: parsed.fields.city,
          alasan: parsed.fields.reason,
          joinVia: parsed.fields.joinVia,
          nomor: jidUserPart(senderJid),
          senderJid,
          grup: (await socket.groupMetadata(groupJid).catch(() => ({ subject: groupJid }))).subject || groupJid,
          waktu: new Date().toISOString(),
        }, 'intro');
        if (parsed.fields.age < minimumAge) await kickUnderage(socket, message, state, parsed.fields.age);
        else await socket.sendMessage(groupJid, { text: `Intro diterima, @${jidUserPart(senderJid)}. Selamat datang di grup!`, mentions: senderJid ? [senderJid] : [] });
      } catch (error) {
        logError(`Gagal memproses pesan: ${error.message}`);
      }
    }
  });
}

process.on('uncaughtException', (error) => logError(`Error tidak tertangani: ${error?.message || error}`));
process.on('unhandledRejection', (error) => logError(`Promise gagal: ${error?.message || error}`));

printBanner();
logInfo(`Memulai ${BRAND}...`);
startBot().catch((error) => { logError(`Bot gagal dijalankan: ${error?.message || error}`); process.exitCode = 1; });

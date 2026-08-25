
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const fetch = require('node-fetch');
const pino = require('pino');
const yts = require("yt-search");
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os'); 
const { tmpdir } = require('os');
const { sms, downloadMediaMessage } = require("./msg");
const { sendInteractiveMessage } = require("gifted-btns");
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const webp = require('node-webpmux');
const { writeFile } = require('fs/promises');
const {
   default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestWaWebVersion,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateWAMessageContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

// ============ CRASH FIX #1: Unhandled Errors ============
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});
const config = {
    selfMode: false,
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    ANTI_CALL: ' false',
    AUTO_TYPING: 'true',
    AUTOREACT: 'false',
    AUTO_READ: 'false',
    AUTO_LIKE_EMOJI: ['💋', '😶', '💫', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: '',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://i.ibb.co/750pdM9/b46b44ae51c1.jpg',
    NEWSLETTER_JID: '120363420261263259@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    OWNER_NUMBER: '254117312277',
    OWNER_NAME: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs🎀',
    BOT_FOOTER: 'ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7ycBQ4yltMfeegLF1m'
};

// =========================================================
// 🔒 PER-SOCKET BOT STATE
// Every connected WhatsApp account gets its own configuration
// and mutable settings. Nothing below is shared between sockets.
// =========================================================
function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(config));
}

function loadJsonFile(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn(`[BotState] Failed to load ${filePath}:`, err.message);
    }
    return fallback;
}

function saveJsonFile(filePath, value) {
    try {
        fs.ensureDirSync(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
        return true;
    } catch (err) {
        console.error(`[BotState] Failed to save ${filePath}:`, err.message);
        return false;
    }
}

async function createBotState(number, baseSessionPath) {
    const stateDir = path.join(baseSessionPath, 'bot-settings');
    fs.ensureDirSync(stateDir);

    const localConfigPath = path.join(stateDir, 'config.json');
    const localConfig = loadJsonFile(localConfigPath, cloneDefaultConfig());
    const botConfig = { ...cloneDefaultConfig(), ...(localConfig || {}) };

    const welcomeRaw = loadJsonFile(path.join(stateDir, 'welcome-settings.json'), {});
    const welcomeSettings = new Map(Object.entries(welcomeRaw || {}).map(([jid, value]) => [jid, {
        welcome: Boolean(value?.welcome),
        goodbye: Boolean(value?.goodbye),
        customWelcome: value?.customWelcome || '',
        customGoodbye: value?.customGoodbye || ''
    }]));

    const anticallSettings = {
        rejectCalls: false,
        blockCaller: false,
        notifyAdmin: false,
        autoReply: "🚫 I don't accept calls. Please send a text message instead.",
        blockedUsers: [],
        ...loadJsonFile(path.join(stateDir, 'anticall-settings.json'), {})
    };
    anticallSettings.blockedUsers = Array.isArray(anticallSettings.blockedUsers) ? anticallSettings.blockedUsers : [];

    const antilinkData = loadJsonFile(path.join(stateDir, 'antilink.json'), {});
    const chatbotRaw = loadJsonFile(path.join(stateDir, 'chatbot-state.json'), { enabled: false, history: {} });
    const chatbotHistory = new Map(Object.entries(chatbotRaw.history || {}));

    const state = {
        number,
        dir: stateDir,
        config: botConfig,
        welcomeSettings,
        anticallSettings,
        antilinkData,
        antilinkWarnings: {},
        imageSessions: {},
        chatbotEnabled: Boolean(chatbotRaw.enabled),
        chatbotHistory,
        autoReactEnabled: Boolean(loadJsonFile(path.join(stateDir, 'autoreact.json'), { enabled: false }).enabled),
        autoReadPM: Boolean(loadJsonFile(path.join(stateDir, 'autoread.json'), { enabled: false }).enabled),
        antiDeleteEnabled: Boolean(loadJsonFile(path.join(stateDir, 'antidelete.json'), { enabled: true }).enabled),
        antiDeleteMode: loadJsonFile(path.join(stateDir, 'antidelete.json'), { enabled: true, mode: 'all' }).mode || 'all'
    };

    state.saveConfig = () => saveJsonFile(localConfigPath, state.config);
    state.saveWelcomeSettings = () => saveJsonFile(path.join(stateDir, 'welcome-settings.json'), Object.fromEntries(state.welcomeSettings.entries()));
    state.saveAnticallSettings = () => saveJsonFile(path.join(stateDir, 'anticall-settings.json'), state.anticallSettings);
    state.saveAntilinkSettings = () => saveJsonFile(path.join(stateDir, 'antilink.json'), state.antilinkData);
    state.saveChatbotState = () => saveJsonFile(path.join(stateDir, 'chatbot-state.json'), {
        enabled: state.chatbotEnabled,
        history: Object.fromEntries(state.chatbotHistory.entries()),
        updated: new Date().toISOString()
    });
    state.saveAutoReact = () => saveJsonFile(path.join(stateDir, 'autoreact.json'), { enabled: state.autoReactEnabled });
    state.saveAutoRead = () => saveJsonFile(path.join(stateDir, 'autoread.json'), { enabled: state.autoReadPM });
    state.saveAntiDelete = () => saveJsonFile(path.join(stateDir, 'antidelete.json'), { enabled: state.antiDeleteEnabled, mode: state.antiDeleteMode });

    return state;
}

// Per-socket settings are created by createBotState() inside EmpirePair.

const TEMP_MEDIA_DIR = path.join(__dirname, 'tmp');

if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

const getFolderSizeInMB = (folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        let totalSize = 0;
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            if (fs.statSync(filePath).isFile()) {
                totalSize += fs.statSync(filePath).size;
            }
        }
        return totalSize / (1024 * 1024);
    } catch (err) {
        console.error('Error getting folder size:', err);
        return 0;
    }
};
// ==============================================
// 🤖 CHATBOT - AI Auto-Responder (With cta_url button)
// ==============================================

// Chatbot state is stored per socket under session_<number>/bot-settings/.

// Create fakevCard for quoting
const fakevCard = {
    key: {
        fromMe: false,
        participant: "0@s.whatsapp.net",
        remoteJid: "status@broadcast"
    },
    message: {
        contactMessage: {
            displayName: "❯❯ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴠᴇʀɪғɪᴇᴅ ✅",
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254762673217:+254762673217\nEND:VCARD`
        }
    }
};

// ==============================================
// GET AI RESPONSE FROM COD3UCHIHA API
// ==============================================
async function getAIResponse(message, sender, state) {
    try {
        const history = state?.chatbotHistory?.get(sender) || [];
        const lastMessages = history.slice(-5);
        let context = '';
        if (lastMessages.length > 0) {
            context = lastMessages.map(m => `${m.role}: ${m.content}`).join('\n') + '\n';
        }

        const apiUrl = `https://api.cod3uchiha.com/ai/gpt5?text=${encodeURIComponent(message)}`;
        console.log(`[Chatbot] Sending request to Cod3Uchiha API`);
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;
        let response = data?.result || data?.response || data?.answer || data?.data || data?.reply;
        
        if (typeof response === 'object') {
            response = JSON.stringify(response);
        }
        
        if (!response || response.length < 2) {
            throw new Error('Empty response from API');
        }

        if (state?.chatbotHistory) {
            const history = state.chatbotHistory.get(sender) || [];
            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: response });
            if (history.length > 20) {
                history.splice(0, history.length - 20);
            }
            state.chatbotHistory.set(sender, history);
        }

        return response;

    } catch (error) {
        console.error('[Chatbot] API Error:', error.message);
        return `🤖 *I'm having trouble connecting right now!*\n\nPlease try again later or use *menu* to see my commands.\n\n> Caseyrhodes Mini Bot 🎀`;
    }
}

// ==============================================
// CHATBOT HANDLER - Using the same logic as private mode message
// ==============================================
async function setupChatbot(socket) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;


    socket.ev.on('messages.upsert', async ({ messages }) => {
        if (!botState.chatbotEnabled) return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        if (jid === 'status@broadcast' || jid?.endsWith('@newsletter') || jid?.endsWith('@g.us')) return;

        let messageText = '';
        const msgType = getContentType(msg.message);
        
        if (msgType === 'conversation') {
            messageText = msg.message.conversation || '';
        } else if (msgType === 'extendedTextMessage') {
            messageText = msg.message.extendedTextMessage?.text || '';
        } else if (msgType === 'imageMessage') {
            messageText = msg.message.imageMessage?.caption || '';
        } else if (msgType === 'videoMessage') {
            messageText = msg.message.videoMessage?.caption || '';
        }

        if (!messageText || messageText.startsWith(botConfig.PREFIX)) return;

        const sender = msg.key.participant || jid;
        const senderName = sender.split('@')[0];

        console.log(`[Chatbot] 💬 Message from ${senderName}: "${messageText.substring(0, 50)}"`);

        try {
            await socket.sendPresenceUpdate('composing', sender);
        } catch (e) {}

        const response = await getAIResponse(messageText, sender, botState);
        botState.saveChatbotState();

        // ========== USE THE SAME LOGIC AS THE PRIVATE MODE MESSAGE ==========
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { 
                    message: { 
                        interactiveMessage: {
                            body: { text: response },
                            footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: { 
                                buttons: [
                                    { 
                                        name: 'cta_url', 
                                        buttonParamsJson: JSON.stringify({ 
                                            display_text: '📢 Join Channel', 
                                            url: botConfig.CHANNEL_LINK 
                                        }) 
                                    }
                                ] 
                            }
                        } 
                    } 
                }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
            
            console.log(`[Chatbot] ✅ Replied to ${senderName} with cta_url button + fakevCard`);
            
        } catch (error) {
            console.error('[Chatbot] Gifted buttons failed, using fallback:', error.message);
            
            // Fallback: Regular buttons
            try {
                await socket.sendMessage(sender, { 
                    text: response,
                    buttons: [
                        { 
                            buttonId: botConfig.CHANNEL_LINK, 
                            buttonText: { displayText: '📢 Join Channel' }, 
                            type: 1 
                        }
                    ],
                    headerType: 1,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363420261263259@newsletter',
                            newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: fakevCard });
                
                console.log(`[Chatbot] ✅ Fallback sent to ${senderName}`);
                
            } catch (fallbackError) {
                console.error('[Chatbot] Fallback failed:', fallbackError.message);
                await socket.sendMessage(sender, { 
                    text: `${response}\n\n📢 Join Channel: ${botConfig.CHANNEL_LINK}`
                }, { quoted: fakevCard });
            }
        }
    });

    console.log(`🤖 Chatbot handler registered. (Status: ${botState.chatbotEnabled ? 'ENABLED' : 'DISABLED'})`);
}
// ==============================================
// 🔗 STRONG ANTILINK - Advanced Link Protection
// ==============================================

// Antilink configuration is stored per socket under session_<number>/bot-settings/.

// Advanced link patterns - Strong detection
const LINK_PATTERNS = [
    // Standard URLs
    /https?:\/\/[^\s]+/gi,
    /www\.[^\s]+/gi,
    
    // URL shorteners
    /bit\.ly\/[^\s]+/gi,
    /tinyurl\.com\/[^\s]+/gi,
    /shorturl\.at\/[^\s]+/gi,
    /rb\.gy\/[^\s]+/gi,
    /cutt\.ly\/[^\s]+/gi,
    /ow\.ly\/[^\s]+/gi,
    /is\.gd\/[^\s]+/gi,
    /buff\.ly\/[^\s]+/gi,
    /shorte\.st\/[^\s]+/gi,
    /goo\.gl\/[^\s]+/gi,
    /bitly\.com\/[^\s]+/gi,
    /tiny\.cc\/[^\s]+/gi,
    /cli\.gs\/[^\s]+/gi,
    /lnkd\.in\/[^\s]+/gi,
    /db\.tt\/[^\s]+/gi,
    /qr\.co\/[^\s]+/gi,
    /bc\.vc\/[^\s]+/gi,
    /t\.co\/[^\s]+/gi,
    /migre\.me\/[^\s]+/gi,
    /soo\.gd\/[^\s]+/gi,
    
    // WhatsApp
    /chat\.whatsapp\.com\/[^\s]+/gi,
    /wa\.me\/[^\s]+/gi,
    /whatsapp\.com\/channel\/[^\s]+/gi,
    
    // Social Media
    /instagram\.com\/[^\s]+/gi,
    /instagr\.am\/[^\s]+/gi,
    /facebook\.com\/[^\s]+/gi,
    /fb\.com\/[^\s]+/gi,
    /twitter\.com\/[^\s]+/gi,
    /x\.com\/[^\s]+/gi,
    /t\.me\/[^\s]+/gi,
    /telegram\.org\/[^\s]+/gi,
    /youtube\.com\/[^\s]+/gi,
    /youtu\.be\/[^\s]+/gi,
    /tiktok\.com\/[^\s]+/gi,
    /vm\.tiktok\.com\/[^\s]+/gi,
    /snapchat\.com\/[^\s]+/gi,
    /pinterest\.com\/[^\s]+/gi,
    /reddit\.com\/[^\s]+/gi,
    /linkedin\.com\/[^\s]+/gi,
    /discord\.gg\/[^\s]+/gi,
    /discord\.com\/[^\s]+/gi,
    
    // Other platforms
    /github\.com\/[^\s]+/gi,
    /git\.io\/[^\s]+/gi,
    /medium\.com\/[^\s]+/gi,
    /substack\.com\/[^\s]+/gi,
    /patreon\.com\/[^\s]+/gi,
    /onlyfans\.com\/[^\s]+/gi,
    /twitch\.tv\/[^\s]+/gi,
    /spotify\.com\/[^\s]+/gi,
    /soundcloud\.com\/[^\s]+/gi,
    /dropbox\.com\/[^\s]+/gi,
    /drive\.google\.com\/[^\s]+/gi,
    /docs\.google\.com\/[^\s]+/gi,
    /meet\.google\.com\/[^\s]+/gi,
    /zoom\.us\/[^\s]+/gi,
    /webex\.com\/[^\s]+/gi,
    /microsoft\.com\/[^\s]+/gi,
    /apple\.com\/[^\s]+/gi,
    /amazon\.com\/[^\s]+/gi,
    /aliexpress\.com\/[^\s]+/gi,
    /ebay\.com\/[^\s]+/gi,
    /shopee\.com\/[^\s]+/gi,
    /temu\.com\/[^\s]+/gi,
    /shein\.com\/[^\s]+/gi,
    /wish\.com\/[^\s]+/gi,
    
    // IP addresses
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/gi,
    
    // Domain patterns
    /\b[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}\b/gi,
    
    // Suspicious keywords
    /(?:click|claim|win|free|prize|offer|promo|discount|crypto|bitcoin|investment|loan|money|urgent|verify|update|confirm|security|alert|notice|limited|exclusive|bonus|cash|reward|gift|voucher|coupon|deal|sale)[\s]*link/gi,
    /(?:download|install|update|verify|confirm|login|signin|signup|register|reset|recover|unlock|activate)[\s]*(?:now|here|today)/gi
];

// Suspicious keywords for additional detection
const SUSPICIOUS_WORDS = [
    'click here', 'claim now', 'free money', 'win prize', 
    'urgent', 'verify account', 'update payment', 'confirm identity',
    'limited offer', 'exclusive deal', 'bonus', 'cash reward',
    'gift card', 'voucher', 'promo code', 'discount',
    'crypto', 'bitcoin', 'investment', 'loan', 'billion',
    'million', 'lottery', 'winner', 'congratulations',
    'account suspended', 'security alert', 'unusual activity',
    'login attempt', 'password reset', 'recover account',
    'unlock account', 'verify now', 'activate now'
];

async function setupAntilink(socket) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        
        // Only work in groups
        if (!jid.endsWith('@g.us')) return;

        // Check if antilink is enabled for this group
        const groupSettings = botState.antilinkData[jid] || { 
            enabled: false, 
            action: 'delete', 
            warnMessage: true,
            strictMode: false,
            autoBan: false,
            exemptRoles: ['admin', 'owner']
        };
        if (!groupSettings.enabled) return;

        // Get message content
        let messageText = '';
        const msgType = getContentType(msg.message);
        
        if (msgType === 'conversation') {
            messageText = msg.message.conversation || '';
        } else if (msgType === 'extendedTextMessage') {
            messageText = msg.message.extendedTextMessage?.text || '';
        } else if (msgType === 'imageMessage') {
            messageText = msg.message.imageMessage?.caption || '';
        } else if (msgType === 'videoMessage') {
            messageText = msg.message.videoMessage?.caption || '';
        } else if (msgType === 'documentMessage') {
            messageText = msg.message.documentMessage?.caption || '';
        }

        if (!messageText) return;

        // Check if sender is admin or owner (skip if they are)
        try {
            const groupMetadata = await socket.groupMetadata(jid);
            const sender = msg.key.participant || msg.key.remoteJid;
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            const isOwner = sender.split('@')[0] === botConfig.OWNER_NUMBER;

            // Skip if sender is admin or owner
            if (isAdmin || isOwner) {
                console.log(`[Antilink] Admin/Owner sent link in ${jid}, skipping`);
                return;
            }
        } catch (err) {
            console.error('[Antilink] Error checking admin:', err);
        }

        // Check for links
        let containsLink = false;
        let detectedLinks = [];
        let isSuspicious = false;

        // Check all link patterns
        for (const pattern of LINK_PATTERNS) {
            const matches = messageText.match(pattern);
            if (matches) {
                containsLink = true;
                detectedLinks.push(...matches);
            }
        }

        // Check for suspicious keywords (bonus detection)
        const lowerText = messageText.toLowerCase();
        for (const word of SUSPICIOUS_WORDS) {
            if (lowerText.includes(word)) {
                isSuspicious = true;
                break;
            }
        }

        // If no link found but suspicious content, still warn
        if (!containsLink && isSuspicious && groupSettings.strictMode) {
            containsLink = true;
            detectedLinks = ['suspicious content'];
        }

        if (!containsLink) return;

        // Log detection
        console.log(`[Antilink] 🔗 Link detected in ${jid}:`, detectedLinks);

        try {
            const senderName = msg.key.participant?.split('@')[0] || 'Unknown';
            
            // Delete the message
            await socket.sendMessage(jid, { delete: msg.key });
            console.log(`[Antilink] 🗑️ Deleted link message from ${senderName}`);

            // Send warning (if enabled)
            if (groupSettings.warnMessage !== false) {
                let warningText = `⚠️ *Link Detected!*\n\n@${senderName}, links are NOT allowed in this group.\n`;
                
                if (detectedLinks.length > 0) {
                    warningText += `\n*Deleted ⚔️`;
                }
                
                if (isSuspicious) {
                    warningText += `\n*⚠️ Suspicious content detected!*`;
                }
                
                if (groupSettings.strictMode) {
                    warningText += `\n\n*🔒 Strict Mode Active:* This is your ${getWarningCount(botState, sender, jid)} warning.`;
                }
                
                warningText += `\n\n> ${botConfig.BOT_FOOTER}`;
                
                const warnMsg = await socket.sendMessage(jid, {
                    text: warningText,
                    mentions: [msg.key.participant]
                });

                // Auto-delete warning after 15 seconds
                setTimeout(async () => {
                    try {
                        await socket.sendMessage(jid, { delete: warnMsg.key });
                    } catch (err) {}
                }, 15000);
            }

            // Auto-ban if strict mode and multiple violations
            if (groupSettings.strictMode && groupSettings.autoBan) {
                const warningCount = getWarningCount(botState, sender, jid);
                if (warningCount >= 3) {
                    try {
                        await socket.groupParticipantsUpdate(jid, [sender], 'remove');
                        await socket.sendMessage(jid, {
                            text: `🚫 *@${senderName} has been removed for violating link rules.*\n\nMultiple link violations detected.`,
                            mentions: [sender]
                        });
                        console.log(`[Antilink] 🚫 Auto-banned ${senderName} from ${jid}`);
                    } catch (err) {
                        console.error('[Antilink] Auto-ban failed:', err);
                    }
                }
            }

        } catch (err) {
            console.error('[Antilink] Error:', err);
        }
    });

    console.log('🔗 Strong Antilink handler registered.');
}

// Helper function to track warnings
function getWarningCount(botState, sender, jid) {
    const key = `${jid}_${sender}`;
    if (!botState.antilinkWarnings[key]) botState.antilinkWarnings[key] = 0;
    botState.antilinkWarnings[key]++;
    return botState.antilinkWarnings[key];
}

// Helper function to reset warnings
function resetWarnings(botState, sender, jid) {
    const key = `${jid}_${sender}`;
    delete botState.antilinkWarnings[key];
}
const cleanTempFolderIfLarge = () => {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        if (sizeMB > 200) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            for (const file of files) {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                fs.unlinkSync(filePath);
            }
            console.log('Temp folder cleaned, size was:', sizeMB.toFixed(2), 'MB');
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
};

setInterval(cleanTempFolderIfLarge, 60 * 1000);

function hexToArgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

async function groupStatusPost(sock, jid, content) {
    const secret = crypto.randomBytes(32);
    const innerMsg = typeof content.toJSON === 'function' ? content.toJSON() : content;
    const fullContent = {
        messageContextInfo: { messageSecret: secret },
        groupStatusMessageV2: {
            message: {
                ...innerMsg,
                messageContextInfo: { messageSecret: secret }
            }
        }
    };
    const msg = generateWAMessageFromContent(jid, fullContent, {});
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}


const octokit = new Octokit({ auth: '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' });
const owner = 'caseyweb';
const repo = 'session';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

let totalcmds = async () => {
    try {
        const filePath = "./pair.js";
        const mytext = await fs.readFile(filePath, "utf-8");
        const lines = mytext.split("\n");
        let count = 0;
        for (const line of lines) {
            if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
            if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
                count++;
            }
        }
        return count;
    } catch (error) {
        console.error("Error reading pair.js:", error.message);
        return 0;
    }
}

async function joinGroup(socket) {
    const botConfig = socket.__botConfig || config;

    let retries = botConfig.MAX_RETRIES || 3;
    let inviteCode = 'Ex3h8pbav1w4iU9RKF7Qaw';
    if (botConfig.GROUP_INVITE_LINK) {
        const cleanInviteLink = botConfig.GROUP_INVITE_LINK.split('?')[0];
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', botConfig.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            console.log('Group join response:', JSON.stringify(response, null, 2));
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (botConfig.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const botConfig = socket.__botConfig || config;

    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '> mᥲძᥱ ᑲᥡ Caseyrhodes'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

async function downloadMedia(msg, type) {
    const mediaMsg = msg[`${type}Message`] || msg;
    const stream = await downloadContentFromMessage(mediaMsg, type);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function groupStatus(sock, jid, content) {
    const { backgroundColor } = content;
    delete content.backgroundColor;
    const inside = await generateWAMessageContent(content, {
        upload: sock.waUploadToServer,
        backgroundColor: backgroundColor || '#9C27B0',
    });
    const secret = crypto.randomBytes(32);
    const msg = generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: { messageSecret: secret },
            groupStatusMessageV2: {
                message: {
                    ...inside,
                    messageContextInfo: { messageSecret: secret },
                },
            },
        },
        {}
    );
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

function toVN(buffer) {
    return new Promise((resolve, reject) => {
        const input = new PassThrough();
        const output = new PassThrough();
        const chunks = [];
        input.end(buffer);
        ffmpeg(input)
            .noVideo()
            .audioCodec('libopus')
            .format('ogg')
            .audioChannels(1)
            .audioFrequency(48000)
            .on('error', reject)
            .on('end', () => resolve(Buffer.concat(chunks)))
            .pipe(output);
        output.on('data', (c) => chunks.push(c));
    });
}

function generateWaveform(buffer, bars = 64) {
    return new Promise((resolve, reject) => {
        const input = new PassThrough();
        input.end(buffer);
        const chunks = [];
        ffmpeg(input)
            .audioChannels(1)
            .audioFrequency(16000)
            .format('s16le')
            .on('error', reject)
            .on('end', () => {
                const raw = Buffer.concat(chunks);
                const samples = raw.length / 2;
                const amps = [];
                for (let i = 0; i < samples; i++) {
                    amps.push(Math.abs(raw.readInt16LE(i * 2)) / 32768);
                }
                const size = Math.floor(amps.length / bars);
                if (size === 0) return resolve(undefined);
                const avg = Array.from({ length: bars }, (_, i) =>
                    amps.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) / size
                );
                const max = Math.max(...avg);
                if (max === 0) return resolve(undefined);
                resolve(Buffer.from(avg.map((v) => Math.floor((v / max) * 100))).toString('base64'));
            })
            .pipe()
            .on('data', (c) => chunks.push(c));
    });
}

// ==============================================
// 🔥 AUTO-REACT FUNCTION - Reacts to messages automatically
// ==============================================
async function setupAutoReact(socket) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;

    // Configuration - customize these emojis
    const REACT_EMOJIS = ['🔥', '❤️', '💫', '✨', '🌟', '🎀', '🌸', '💗', '😊', '👏', '🎉', '💯', '⭐', '🌈', '💎'];
    
    // List of users to ignore (bot owner can still get reactions)
    const IGNORED_USERS = ['status@broadcast', '0@s.whatsapp.net'];
    
    // Toggle autoreact on/off (can be controlled via command)
    botState.autoReactEnabled = Boolean(botState.autoReactEnabled);
    
    socket.ev.on('messages.upsert', async ({ messages }) => {
        // Skip if autoreact is disabled
        if (!botState.autoReactEnabled) return;
        
        const msg = messages[0];
        if (!msg.message) return;
        
        // Don't react to own messages
        if (msg.key.fromMe) return;
        
        const jid = msg.key.remoteJid;
        
        // Skip status broadcasts and newsletters
        if (jid === 'status@broadcast' || jid === botConfig.NEWSLETTER_JID) return;
        if (IGNORED_USERS.includes(jid)) return;
        
        // Skip if message is from ignored users
        const sender = msg.key.participant || jid;
        if (IGNORED_USERS.includes(sender)) return;
        
        try {
            // Random delay to seem more natural (1-5 seconds)
            const delayTime = Math.floor(Math.random() * 4000) + 1000;
            await delay(delayTime);
            
            // Pick a random emoji
            const randomEmoji = REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
            
            // React to the message
            await socket.sendMessage(jid, {
                react: {
                    text: randomEmoji,
                    key: msg.key
                }
            });
            
            console.log(`[AutoReact] ✅ Reacted with ${randomEmoji} to ${sender.split('@')[0]}`);
            
        } catch (error) {
            // Silently fail - don't spam logs with errors
            if (error.message && !error.message.includes('rate')) {
                console.warn('[AutoReact] Failed to react:', error.message);
            }
        }
    });
    
    console.log('🔥 Auto-React handler registered.');
}

function setupNewsletterHandlers(socket) {
    const botConfig = socket.__botConfig || config;

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;
        const jid = message.key.remoteJid;
        if (jid !== botConfig.NEWSLETTER_JID) return;
        try {
            const emojis = ['🥹', '🌸', '👻', '💫', '🎀', '🎌', '💖', '❤️', '🔥', '🌟'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;
            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }
            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

function initAntiCallHandler(sock) {
    const botState = sock.__botState;
    const botConfig = sock.__botConfig;

    const ownerJid = botConfig.OWNER_NUMBER + '@s.whatsapp.net';
    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (call.status !== 'offer') continue;
            const caller = call.from;
            if (botState.anticallSettings.blockedUsers.includes(caller) || botState.anticallSettings.rejectCalls) {
                try {
                    await sock.rejectCall(call.id, caller);
                    console.log(`📞 Call rejected from: ${caller}`);
                } catch {}
            }
            if (botState.anticallSettings.autoReply) {
                try {
                    await sock.sendMessage(caller, { text: botState.anticallSettings.autoReply });
                } catch {}
            }
            if (botState.anticallSettings.notifyAdmin && ownerJid) {
                try {
                    await sock.sendMessage(ownerJid, {
                        text: `📞 *Anti-Call Alert*\n\nCaller: ${caller}\nType: ${call.isVideo ? 'video' : 'voice'}\nStatus: Rejected`
                    });
                } catch {}
            }
            if (botState.anticallSettings.blockCaller && !botState.anticallSettings.blockedUsers.includes(caller)) {
                botState.anticallSettings.blockedUsers.push(caller);
                botState.saveAnticallSettings();
                console.log(`🚫 Auto-blocked caller: ${caller}`);
            }
        }
    });
    console.log('🛡️ Anti-Call handler registered.');
}

function getParticipantJid(participant) {
    if (!participant) return null;
    if (typeof participant === 'string') return participant;
    return participant.id || participant.jid || participant.phoneNumber || null;
}

function getParticipantPhoneJid(participant) {
    if (!participant) return null;
    if (typeof participant === 'string') return participant;
    return participant.phoneNumber || participant.id || participant.jid || null;
}

async function setupWelcomeGoodbyeHandlers(sock) {
    const botState = sock.__botState;
    const botConfig = sock.__botConfig;

    console.log('👋 Setting up Welcome/Goodbye handler...');

    const normalizeGroup = (jid) => jid ? String(jid).split(':')[0] : jid;
    const getSetting = (jid) => {
        const normalized = normalizeGroup(jid);
        return botState.welcomeSettings.get(normalized) || botState.welcomeSettings.get(jid) || {
            welcome: false,
            goodbye: false,
            customWelcome: '',
            customGoodbye: ''
        };
    };
    const saveSetting = (jid, settings) => {
        const normalized = normalizeGroup(jid);
        botState.welcomeSettings.delete(jid);
        botState.welcomeSettings.set(normalized, settings);
        botState.saveWelcomeSettings();
    };

    sock.ev.on('group-participants.update', async (update) => {
        try {
            const id = normalizeGroup(update?.id);
            const action = update?.action;
            if (!id || !['add', 'remove'].includes(action)) return;

            const rawParticipants = Array.isArray(update?.participants) ? update.participants : [];
            if (!rawParticipants.length) return;

            const settings = getSetting(id);
            if (action === 'add' && !settings.welcome) return;
            if (action === 'remove' && !settings.goodbye) return;

            let metadata = null;
            try { metadata = await sock.groupMetadata(id); } catch (e) {
                console.warn('[Welcome] groupMetadata failed:', e.message);
            }

            const groupName = metadata?.subject || 'Group';
            const memberCount = metadata?.participants?.length || 0;

            for (const raw of rawParticipants) {
                const jid = typeof raw === 'string' ? raw : (raw?.id || raw?.jid || raw?.phoneNumber);
                const phoneJid = typeof raw === 'object' ? (raw?.phoneNumber || raw?.id || raw?.jid) : raw;
                if (!jid) continue;

                // Prefer the phone JID when available for a reliable WhatsApp mention;
                // otherwise use the participant JID/LID supplied by the event.
                const mentionJid = phoneJid || jid;
                const name = String(mentionJid).split('@')[0].split(':')[0];
                const template = action === 'add'
                    ? (settings.customWelcome || `🎉 *WELCOME!*\n\nHello {mention}, welcome to *{group}*! 🎊\n\n👥 Members: {membercount}\n📌 Please read the group rules and enjoy your stay!\n\n> ${botConfig.BOT_FOOTER}`)
                    : (settings.customGoodbye || `👋 *GOODBYE!*\n\n{mention} has left *{group}*.\n\n👥 Members: {membercount}\nWe wish you all the best! ❤️\n\n> ${botConfig.BOT_FOOTER}`);

                const text = template
                    .replace(/{name}/g, name)
                    .replace(/{group}/g, groupName)
                    .replace(/{membercount}/g, String(memberCount))
                    .replace(/{mention}/g, `@${name}`);

                if (action === 'add') {
                    // Fetch the new member's WhatsApp profile picture. For LID-based
                    // participant events, resolve the LID to a phone JID first when
                    // Baileys exposes the mapping. If the picture is unavailable, the
                    // welcome still falls back to a normal text message.
                    let profileUrl = null;
                    try {
                        let profileJid = mentionJid;
                        if (/@lid$/.test(String(profileJid)) && sock.signalRepository?.lidMapping?.getPNForLID) {
                            try {
                                const pn = await sock.signalRepository.lidMapping.getPNForLID(profileJid);
                                if (pn) profileJid = pn;
                            } catch (_) {}
                        }
                        profileUrl = await sock.profilePictureUrl(profileJid, 'image');
                    } catch (_) {
                        profileUrl = null;
                    }

                    // Keep the welcome as ONE message. When a profile picture is
                    // available it is sent as the message image with the welcome
                    // caption and the existing buttons attached to that same message.
                    const welcomePayload = {
                        mentions: [mentionJid],
                        buttons: [
                            { buttonId: `${botConfig.PREFIX}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 },
                            { buttonId: `${botConfig.PREFIX}groupinfo`, buttonText: { displayText: '📊 ɢʀᴏᴜᴘ ɪɴғᴏ' }, type: 1 },
                            { buttonId: `${botConfig.PREFIX}members`, buttonText: { displayText: '👥 ᴍᴇᴍʙᴇʀs' }, type: 1 },
                            { buttonId: `${botConfig.PREFIX}tagall`, buttonText: { displayText: '👥 ᴛᴀɢ ᴀʟʟ' }, type: 1 },
                            { buttonId: `${botConfig.PREFIX}alive`, buttonText: { displayText: '💓 ᴀʟɪᴠᴇ' }, type: 1 },
                            {
                                name: 'cta_url',
                                buttonParamsJson: JSON.stringify({
                                    display_text: '📢 ᴊᴏɪɴ ɴᴇᴡsʟᴇᴛᴛᴇʀ',
                                    url: botConfig.CHANNEL_LINK
                                })
                            }
                        ],
                        headerType: 1,
                        ...(profileUrl ? { image: { url: profileUrl }, caption: text, footer: botConfig.BOT_FOOTER } : { text, footer: botConfig.BOT_FOOTER })
                    };
                    await sock.sendMessage(id, welcomePayload);
                } else {
                    await sock.sendMessage(id, {
                        text,
                        mentions: [mentionJid],
                        buttons: [{ buttonId: `${botConfig.PREFIX}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }],
                        headerType: 1
                    });
                }
            }
        } catch (error) {
            console.error('[WelcomeGoodbye] Error:', error);
        }
    });

    console.log('👋 Welcome/Goodbye handler registered and ready!');
}

// ==================== ANTI-DELETE ====================
// Per-socket anti-delete cache.  We cache incoming messages first and then
// restore the original message when WhatsApp sends a REVOKE protocol event.
function setupAntiDelete(sock) {
    if (sock.__antiDeleteInstalled) return;
    sock.__antiDeleteInstalled = true;

    const botState = sock.__botState;
    const botConfig = sock.__botConfig || config;
    const cache = new Map();
    const MAX_CACHED = 5000;
    const TTL = 48 * 60 * 60 * 1000;
    const pending = new Map();

    const unwrap = (message) => {
        let m = message;
        for (let i = 0; i < 8 && m; i++) {
            if (m.protocolMessage) return m;
            if (m.ephemeralMessage?.message) { m = m.ephemeralMessage.message; continue; }
            if (m.viewOnceMessage?.message) { m = m.viewOnceMessage.message; continue; }
            if (m.viewOnceMessageV2?.message) { m = m.viewOnceMessageV2.message; continue; }
            if (m.viewOnceMessageV2Extension?.message) { m = m.viewOnceMessageV2Extension.message; continue; }
            if (m.documentWithCaptionMessage?.message) { m = m.documentWithCaptionMessage.message; continue; }
            break;
        }
        return m;
    };

    const cacheKey = (key) => {
        if (!key?.remoteJid || !key?.id) return null;
        return `${key.remoteJid}|${key.id}`;
    };

    const remember = (message) => {
        if (!message?.key?.id || !message?.message) return;
        const key = cacheKey(message.key);
        if (!key) return;
        cache.set(key, { message, time: Date.now() });
        while (cache.size > MAX_CACHED) {
            const first = cache.keys().next().value;
            if (first) cache.delete(first); else break;
        }
    };

    const findOriginal = (key) => {
        if (!key?.id) return null;
        const exact = cache.get(cacheKey(key));
        if (exact && Date.now() - exact.time <= TTL) return exact.message;

        // WhatsApp can omit participant/fromMe in revoke events. Match by chat + id.
        for (const [k, entry] of cache) {
            if (Date.now() - entry.time > TTL) { cache.delete(k); continue; }
            const originalKey = entry.message?.key;
            if (originalKey?.id === key.id && originalKey?.remoteJid === key.remoteJid) {
                return entry.message;
            }
        }
        return null;
    };

    const isRevoke = (message) => {
        const protocol = unwrap(message)?.protocolMessage;
        if (!protocol) return null;
        const type = protocol.type;
        return (type === 0 || type === 'REVOKE' || String(type).toUpperCase() === 'REVOKE') ? protocol : null;
    };

    const getMessageInfo = (original) => {
        const raw = unwrap(original?.message) || {};
        const sender = original?.key?.participant || (original?.key?.fromMe ? sock.user?.id : null) || original?.key?.remoteJid || 'Unknown';
        const senderName = String(sender).split('@')[0].split(':')[0];
        let type = 'Message';
        let body = '';

        if (raw.conversation) { type = 'Text'; body = raw.conversation; }
        else if (raw.extendedTextMessage) { type = 'Text'; body = raw.extendedTextMessage.text || ''; }
        else if (raw.imageMessage) { type = 'Image'; body = raw.imageMessage.caption || ''; }
        else if (raw.videoMessage) { type = 'Video'; body = raw.videoMessage.caption || ''; }
        else if (raw.audioMessage) { type = 'Audio'; body = raw.audioMessage.caption || ''; }
        else if (raw.documentMessage) { type = 'Document'; body = raw.documentMessage.caption || raw.documentMessage.fileName || ''; }
        else if (raw.stickerMessage) { type = 'Sticker'; body = ''; }
        else if (raw.contactMessage) { type = 'Contact'; body = raw.contactMessage.displayName || ''; }
        else if (raw.contactsArrayMessage) { type = 'Contacts'; body = ''; }
        else if (raw.locationMessage) { type = 'Location'; body = raw.locationMessage.name || raw.locationMessage.address || ''; }
        else if (raw.liveLocationMessage) { type = 'Live Location'; body = ''; }
        else if (raw.reactionMessage) { type = 'Reaction'; body = raw.reactionMessage.text || ''; }
        else if (raw.pollCreationMessage) { type = 'Poll'; body = raw.pollCreationMessage.name || ''; }
        else if (raw.listMessage) { type = 'List'; body = raw.listMessage.description || raw.listMessage.title || ''; }
        else if (raw.buttonsMessage) { type = 'Buttons'; body = raw.buttonsMessage.contentText || ''; }
        else if (raw.templateMessage) { type = 'Template'; body = raw.templateMessage.hydratedTemplate?.hydratedContentText || ''; }
        else if (raw.interactiveMessage) { type = 'Interactive'; body = raw.interactiveMessage.body?.text || ''; }
        else {
            type = Object.keys(raw)[0] || 'Message';
            body = raw.text || raw.caption || '';
        }

        return { senderName, type, body: String(body || '').trim() };
    };

    const flushChat = async (chat) => {
        const list = pending.get(chat);
        if (!list?.length) return;
        pending.delete(chat);
        if (!botState.antiDeleteEnabled) return;
        if (botState.antiDeleteMode === 'groups' && !String(chat).endsWith('@g.us')) return;

        const lines = [`🛡️ *ANTI-DELETE RECOVERY*`, ``, `♻️ *${list.length} deleted message${list.length === 1 ? '' : 's'} recovered*`, ``];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            lines.push(`*${i + 1}. ${item.type}* — @${item.senderName}`);
            if (item.body) lines.push(item.body.slice(0, 3500));
            else lines.push(`_[${item.type} message recovered]_`);
            lines.push('');
        }
        lines.push(`> ${botConfig.BOT_FOOTER}`);

        const mentions = [...new Set(list.map(x => x.participant).filter(Boolean))];
        const text = lines.join('\n').slice(0, 12000);
        const newsletterInfo = botConfig.NEWSLETTER_JID ? {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: botConfig.NEWSLETTER_JID,
                newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ',
                serverMessageId: Number(botConfig.NEWSLETTER_MESSAGE_ID) || -1
            }
        } : {};

        try {
            const ctaMsg = generateWAMessageFromContent(chat, {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text },
                            footer: { text: botConfig.BOT_FOOTER },
                            nativeFlowMessage: {
                                buttons: botConfig.CHANNEL_LINK ? [{
                                    name: 'cta_url',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: '📢 Join Newsletter',
                                        url: botConfig.CHANNEL_LINK
                                    })
                                }] : []
                            }
                        }
                    }
                }
            }, { quoted: fakevCard });
            ctaMsg.message.viewOnceMessage.message.interactiveMessage.body.contextInfo = {
                mentionedJid: mentions,
                ...newsletterInfo
            };
            await sock.relayMessage(chat, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch (err) {
            console.warn('[AntiDelete] CTA recovery failed, using plain message:', err.message);
            await sock.sendMessage(chat, {
                text,
                mentions,
                contextInfo: newsletterInfo
            }, { quoted: fakevCard });
        }
        console.log(`[AntiDelete] ♻️ Recovered ${list.length} deleted message(s) in ${chat}`);
    };

    const queueRecovery = (original) => {
        if (!original?.message || !original.key?.remoteJid) return;
        const chat = original.key.remoteJid;
        const participant = original.key.participant || (original.key.fromMe ? sock.user?.id : chat);
        const info = getMessageInfo(original);
        info.participant = participant;
        if (!pending.has(chat)) pending.set(chat, []);
        pending.get(chat).push(info);
        clearTimeout(pending.get(chat)._timer);
        const timer = setTimeout(() => flushChat(chat).catch(e => console.warn('[AntiDelete] Flush error:', e.message)), 800);
        pending.get(chat)._timer = timer;
    };

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages || []) {
            if (!m?.message) continue;
            const protocol = isRevoke(m.message);
            if (protocol) {
                // Do not restrict by owner/fromMe: recover deletions made by
                // other users AND messages sent by the bot itself.
                if (!botState.antiDeleteEnabled) continue;
                const original = findOriginal(protocol.key);
                if (original) queueRecovery(original);
                continue;
            }
            remember(m);
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const item of updates || []) {
            const protocol = isRevoke(item?.update?.message || item?.message);
            if (!protocol || !botState.antiDeleteEnabled) continue;
            const original = findOriginal(protocol.key);
            if (original) queueRecovery(original);
        }
    });

    const cleanup = setInterval(() => {
        const cutoff = Date.now() - TTL;
        for (const [key, entry] of cache) {
            if (entry.time < cutoff) cache.delete(key);
        }
    }, 10 * 60 * 1000);
    cleanup.unref?.();

    console.log('🛡️ Anti-Delete handler registered: sender + bot + groups/PM, batched recovery enabled.');
}
async function setupStatusHandlers(socket) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === botConfig.NEWSLETTER_JID) return;
        try {
            if (botConfig.AUTO_TYPING === 'true' && message.key.remoteJid) {
    await socket.sendPresenceUpdate("composing", message.key.remoteJid);
}
            if (botConfig.AUTO_VIEW_STATUS === 'true') {
                let retries = botConfig.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (botConfig.MAX_RETRIES - retries));
                    }
                }
            }
            if (botConfig.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = botConfig.AUTO_LIKE_EMOJI[Math.floor(Math.random() * botConfig.AUTO_LIKE_EMOJI.length)];
                let retries = botConfig.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (botConfig.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: '❌ *Only bot owner can view once messages, darling!* 😘' });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, { text: '❌ *Not a valid view-once message, love!* 😢' });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu);
    } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, { text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}` });
    }
}

function setupCommandHandlers(socket, number) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;

    if (!socket.downloadAndSaveMediaMessage) {
        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };
    }

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === botConfig.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted = type == "extendedTextMessage" && msg.message.extendedTextMessage.contextInfo != null ? msg.message.extendedTextMessage.contextInfo.quotedMessage || [] : [];
        const body = m.body;
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${botConfig.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = botConfig.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
        var args = body.trim().split(/ +/).slice(1);

        async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        if (botState.autoReadPM && !msg.key.remoteJid.endsWith('@g.us') && msg.key.remoteJid !== 'status@broadcast') {
            try { await socket.readMessages([msg.key]); } catch (e) {}
        }
        
        if (!command) return;
        const count = await totalcmds();

        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "❯❯ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴠᴇʀɪғɪᴇᴅ ✅",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254762673217:+254762673217\nEND:VCARD`
                }
            }
        };
        
if (botConfig.selfMode && !isOwner && command !== 'mode') {
    try {
        const ctaMsg = generateWAMessageFromContent(sender, {
            viewOnceMessage: { message: { interactiveMessage: {
                body: { text: '🔒 *Bot is in PRIVATE Mode*.\n\nOnly the owner can use commands.\n\n> ' + botConfig.BOT_FOOTER },
                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
            } } }
        }, { quoted: msg });
        await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
    } catch {
        await socket.sendMessage(sender, { text: '🔒 *Bot is in PRIVATE Mode*.', quoted: msg });
    }
    return;
}

        
        try {
               switch (command) {  
// ============ ANTILINK COMMANDS ============
// ============ STRONG ANTILINK COMMANDS ============

// Case: antilink - Toggle antilink on/off
case 'antilink':
case 'linkguard':
case 'antiurl': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴄᴀɴ ᴄᴏɴᴛʀᴏʟ ᴀɴᴛɪʟɪɴᴋ.',
                quoted: msg
            });
            break;
        }

        const action = (args[0] || '').toLowerCase();

        // Initialize group settings if not exists
        if (!botState.antilinkData[from]) {
            botState.antilinkData[from] = { 
                enabled: false, 
                action: 'delete', 
                warnMessage: true,
                strictMode: false,
                autoBan: false,
                exemptRoles: ['admin', 'owner']
            };
        }

        if (action === 'on') {
            botState.antilinkData[from].enabled = true;
            botState.saveAntilinkSettings();
            await socket.sendMessage(sender, {
                text: `🔗 *ᴀɴᴛɪʟɪɴᴋ ᴇɴᴀʙʟᴇᴅ!*\n\nᴀɴʏ ᴍᴇssᴀɢᴇs ᴡɪᴛʜ ʟɪɴᴋs ᴡɪʟʟ ʙᴇ ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ ᴅᴇʟᴇᴛᴇᴅ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}antilink off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else if (action === 'off') {
            botState.antilinkData[from].enabled = false;
            botState.saveAntilinkSettings();
            await socket.sendMessage(sender, {
                text: `🔗 *ᴀɴᴛɪʟɪɴᴋ ᴅɪsᴀʙʟᴇᴅ!*\n\nʟɪɴᴋs ᴀʀᴇ ɴᴏᴡ ᴀʟʟᴏᴡᴇᴅ ɪɴ ᴛʜɪs ɢʀᴏᴜᴘ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}antilink on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        else if (action === 'strict') {
            botState.antilinkData[from].strictMode = !botState.antilinkData[from].strictMode;
            botState.saveAntilinkSettings();
            const status = botState.antilinkData[from].strictMode ? 'ᴇɴᴀʙʟᴇᴅ' : 'ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `🔗 *sᴛʀɪᴄᴛ ᴍᴏᴅᴇ ${status}!*\n\n${botState.antilinkData[from].strictMode ? 'ᴇxᴛʀᴀ ᴅᴇᴛᴇᴄᴛɪᴏɴ ᴀɴᴅ ᴀᴜᴛᴏ-ʙᴀɴ ᴀʀᴇ ᴀᴄᴛɪᴠᴇ.' : 'ʀᴇɢᴜʟᴀʀ ᴍᴏᴅᴇ ᴀᴄᴛɪᴠᴇ.'}\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }
        else if (action === 'ban') {
            botState.antilinkData[from].autoBan = !botState.antilinkData[from].autoBan;
            botState.saveAntilinkSettings();
            const status = botState.antilinkData[from].autoBan ? 'ᴇɴᴀʙʟᴇᴅ' : 'ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `🔗 *ᴀᴜᴛᴏ-ʙᴀɴ ${status}!*\n\n${botState.antilinkData[from].autoBan ? 'ᴜsᴇʀs ᴡɪʟʟ ʙᴇ ʙᴀɴɴᴇᴅ ᴀғᴛᴇʀ 3 ᴠɪᴏʟᴀᴛɪᴏɴs.' : 'ᴀᴜᴛᴏ-ʙᴀɴ ᴅɪsᴀʙʟᴇᴅ.'}\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }
        else if (action === 'warn') {
            botState.antilinkData[from].warnMessage = botState.antilinkData[from].warnMessage !== false;
            botState.saveAntilinkSettings();
            const status = botState.antilinkData[from].warnMessage ? 'ᴇɴᴀʙʟᴇᴅ' : 'ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `🔗 *ᴡᴀʀɴɪɴɢs ${status}!*\n\n${botState.antilinkData[from].warnMessage ? 'ᴜsᴇʀs ᴡɪʟʟ ʀᴇᴄᴇɪᴠᴇ ᴡᴀʀɴɪɴɢs.' : 'ɴᴏ ᴡᴀʀɴɪɴɢs ᴡɪʟʟ ʙᴇ sᴇɴᴛ.'}\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }
        else if (action === 'reset') {
            if (args[1]) {
                const target = args[1].replace(/[^0-9]/g, '');
                resetWarnings(`${target}@s.whatsapp.net`, from);
                await socket.sendMessage(sender, {
                    text: `✅ *ʀᴇsᴇᴛ ᴡᴀʀɴɪɴɢs ғᴏʀ ${target}*`,
                    quoted: msg
                });
            } else {
                // Reset all warnings in group
                botState.antilinkWarnings = {};
                await socket.sendMessage(sender, {
                    text: `✅ *ʀᴇsᴇᴛ ᴀʟʟ ᴡᴀʀɴɪɴɢs ɪɴ ᴛʜɪs ɢʀᴏᴜᴘ*`,
                    quoted: msg
                });
            }
        }
        else {
            const status = botState.antilinkData[from].enabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
            const strict = botState.antilinkData[from].strictMode ? '✅ ᴏɴ' : '❌ ᴏғғ';
            const ban = botState.antilinkData[from].autoBan ? '✅ ᴏɴ' : '❌ ᴏғғ';
            const warn = botState.antilinkData[from].warnMessage !== false ? '✅ ᴏɴ' : '❌ ᴏғғ';
            
            await socket.sendMessage(sender, {
                text: `🔗 *ᴀɴᴛɪʟɪɴᴋ sᴛᴀᴛᴜs*\n\n📌 sᴛᴀᴛᴜs: ${status}\n🔒 sᴛʀɪᴄᴛ ᴍᴏᴅᴇ: ${strict}\n🚫 ᴀᴜᴛᴏ-ʙᴀɴ: ${ban}\n💬 ᴡᴀʀɴɪɴɢs: ${warn}\n\n*ᴜsᴀɢᴇ:*\n• \`${prefix}antilink on\` - ᴇɴᴀʙʟᴇ\n• \`${prefix}antilink off\` - ᴅɪsᴀʙʟᴇ\n• \`${prefix}antilink strict\` - ᴛᴏɢɢʟᴇ sᴛʀɪᴄᴛ ᴍᴏᴅᴇ\n• \`${prefix}antilink ban\` - ᴛᴏɢɢʟᴇ ᴀᴜᴛᴏ-ʙᴀɴ\n• \`${prefix}antilink warn\` - ᴛᴏɢɢʟᴇ ᴡᴀʀɴɪɴɢs\n• \`${prefix}antilink reset\` - ʀᴇsᴇᴛ ᴡᴀʀɴɪɴɢs\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}antilink on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}antilink off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}antilink strict`, buttonText: { displayText: '🔒 sᴛʀɪᴄᴛ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Antilink error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}

// Add these to your switch statement:

// ============ CHATBOT COMMAND ============
case 'chatbot':
case 'bot':
case 'ai':
case 'autoreply': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴄᴏɴᴛʀᴏʟ ᴛʜᴇ ᴄʜᴀᴛʙᴏᴛ.',
                quoted: msg
            });
            break;
        }

        const action = (args[0] || '').toLowerCase();

        if (action === 'on') {
            botState.chatbotEnabled = true;
            botState.saveChatbotState();
            await socket.sendMessage(sender, {
                text: `🤖 *ᴄʜᴀᴛʙᴏᴛ ᴇɴᴀʙʟᴇᴅ!*\n\nɪ ᴡɪʟʟ ɴᴏᴡ ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ ʀᴇsᴘᴏɴᴅ ᴛᴏ ᴀʟʟ ᴅɪʀᴇᴄᴛ ᴍᴇssᴀɢᴇs ᴜsɪɴɢ ᴀɪ.\n\n*Features:*\n• AI-powered responses\n• Conversation history\n• Multiple AI APIs\n• Natural conversations\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}chatbot off`, buttonText: { displayText: '❌ ᴛᴜʀɴ ᴏғғ' }, type: 1 },
                    { buttonId: `${prefix}chatbot clear`, buttonText: { displayText: '🗑️ ᴄʟᴇᴀʀ ʜɪsᴛᴏʀʏ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else if (action === 'off') {
            botState.chatbotEnabled = false;
            botState.saveChatbotState();
            await socket.sendMessage(sender, {
                text: `🤖 *ᴄʜᴀᴛʙᴏᴛ ᴅɪsᴀʙʟᴇᴅ!*\n\nɪ ᴡɪʟʟ ɴᴏᴛ ʀᴇsᴘᴏɴᴅ ᴛᴏ ᴍᴇssᴀɢᴇs ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}chatbot on`, buttonText: { displayText: '✅ ᴛᴜʀɴ ᴏɴ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        else if (action === 'clear' || action === 'reset') {
            // Clear conversation history
            if (args[1]) {
                // Clear specific user
                const target = args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                botState.chatbotHistory.delete(target);
                botState.saveChatbotState();
                await socket.sendMessage(sender, {
                    text: `🗑️ *ᴄʟᴇᴀʀᴇᴅ ʜɪsᴛᴏʀʏ ғᴏʀ ${args[1]}*`,
                    quoted: msg
                });
            } else {
                // Clear all history
                botState.chatbotHistory.clear();
                botState.saveChatbotState();
                await socket.sendMessage(sender, {
                    text: `🗑️ *ᴄʟᴇᴀʀᴇᴅ ᴀʟʟ ᴄʜᴀᴛ ʜɪsᴛᴏʀʏ*`,
                    quoted: msg
                });
            }
        }
        else if (action === 'stats') {
            const totalUsers = botState.chatbotHistory.size;
            let totalMessages = 0;
            for (const [_, history] of botState.chatbotHistory) {
                totalMessages += history.length;
            }
            await socket.sendMessage(sender, {
                text: `📊 *ᴄʜᴀᴛʙᴏᴛ sᴛᴀᴛs*\n\n👥 *ᴛᴏᴛᴀʟ ᴜsᴇʀs:* ${totalUsers}\n💬 *ᴛᴏᴛᴀʟ ᴍᴇssᴀɢᴇs:* ${totalMessages}\n📌 *sᴛᴀᴛᴜs:* ${botState.chatbotEnabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ'}\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }
        else {
            const status = botState.chatbotEnabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
            const users = botState.chatbotHistory.size;
            await socket.sendMessage(sender, {
                text: `🤖 *ᴄʜᴀᴛʙᴏᴛ sᴛᴀᴛᴜs*\n\n📌 sᴛᴀᴛᴜs: ${status}\n👥 ᴀᴄᴛɪᴠᴇ ᴜsᴇʀs: ${users}\n\n*ᴜsᴀɢᴇ:*\n• \`${prefix}chatbot on\` - ᴇɴᴀʙʟᴇ ᴄʜᴀᴛʙᴏᴛ\n• \`${prefix}chatbot off\` - ᴅɪsᴀʙʟᴇ ᴄʜᴀᴛʙᴏᴛ\n• \`${prefix}chatbot clear\` - ᴄʟᴇᴀʀ ᴀʟʟ ʜɪsᴛᴏʀʏ\n• \`${prefix}chatbot clear <number>\` - ᴄʟᴇᴀʀ ᴜsᴇʀ ʜɪsᴛᴏʀʏ\n• \`${prefix}chatbot stats\` - ᴠɪᴇᴡ sᴛᴀᴛs\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}chatbot on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}chatbot off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}chatbot stats`, buttonText: { displayText: '📊 sᴛᴀᴛs' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Chatbot command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}

// Case: linklist - Show groups with antilink enabled
case 'linklist':
case 'antilinklist': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const enabledGroups = Object.entries(botState.antilinkData)
            .filter(([_, settings]) => settings.enabled)
            .map(([jid, settings]) => {
                const groupName = settings.name || jid.split('@')[0] || 'Unknown';
                return `• ${groupName}\n  ${jid}`;
            });

        if (enabledGroups.length === 0) {
            await socket.sendMessage(sender, {
                text: '🔗 *ɴᴏ ɢʀᴏᴜᴘs ᴡɪᴛʜ ᴀɴᴛɪʟɪɴᴋ ᴇɴᴀʙʟᴇᴅ*\n\n> ${botConfig.BOT_FOOTER}',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, {
            text: `🔗 *ɢʀᴏᴜᴘs ᴡɪᴛʜ ᴀɴᴛɪʟɪɴᴋ*\n\n${enabledGroups.join('\n\n')}\n\nᴛᴏᴛᴀʟ: ${enabledGroups.length}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch (error) {
        console.error('Linklist error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}
// Case: autoreact / react / autorea - Toggle auto-react
case 'autoreact':
case 'react':
case 'autorea': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴄᴏɴᴛʀᴏʟ ᴀᴜᴛᴏ-ʀᴇᴀᴄᴛ.',
                quoted: msg
            });
            break;
        }

        const action = (args[0] || '').toLowerCase();
        
        if (action === 'on') {
            botState.autoReactEnabled = true;
            botState.saveAutoReact();
            await socket.sendMessage(sender, {
                text: `🔥 *ᴀᴜᴛᴏ-ʀᴇᴀᴄᴛ ᴇɴᴀʙʟᴇᴅ!*\n\nɪ ᴡɪʟʟ ɴᴏᴡ ʀᴇᴀᴄᴛ ᴛᴏ ᴍᴇssᴀɢᴇs ᴡɪᴛʜ ʀᴀɴᴅᴏᴍ ᴇᴍᴏᴊɪs.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}autoreact off`, buttonText: { displayText: '❌ ᴛᴜʀɴ ᴏғғ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else if (action === 'off') {
            botState.autoReactEnabled = false;
            botState.saveAutoReact();
            await socket.sendMessage(sender, {
                text: `🔥 *ᴀᴜᴛᴏ-ʀᴇᴀᴄᴛ ᴅɪsᴀʙʟᴇᴅ!*\n\nɪ ᴡɪʟʟ ɴᴏᴛ ʀᴇᴀᴄᴛ ᴛᴏ ᴍᴇssᴀɢᴇs.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}autoreact on`, buttonText: { displayText: '✅ ᴛᴜʀɴ ᴏɴ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        else {
            const status = botState.autoReactEnabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `🔥 *ᴀᴜᴛᴏ-ʀᴇᴀᴄᴛ sᴛᴀᴛᴜs*\n\n📌 sᴛᴀᴛᴜs: ${status}\n\n*ᴜsᴀɢᴇ:*\n• \`${prefix}autoreact on\`\n• \`${prefix}autoreact off\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}autoreact on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}autoreact off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('AutoReact command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}        
                // ============ OTHER COMMANDS ============
         
            case 'autoread':
case 'autoreadpm':
case 'readall': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg });
        break;
    }
    const arg = (args[0] || '').toLowerCase();
    let autoReadEnabled = botState.autoReadPM;
    if (arg === 'on') autoReadEnabled = true;
    else if (arg === 'off') autoReadEnabled = false;
    else autoReadEnabled = !autoReadEnabled;
    botState.autoReadPM = autoReadEnabled;
    botState.saveAutoRead();
    await socket.sendMessage(sender, {
        text: `📖 *ᴀᴜᴛᴏ-ʀᴇᴀᴅ ᴘᴍ:* ${autoReadEnabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ'}\n\n> ${botConfig.BOT_FOOTER}`,
        buttons: [{ buttonId: `${prefix}autoread ${autoReadEnabled ? 'off' : 'on'}`, buttonText: { displayText: autoReadEnabled ? '❌ ᴛᴜʀɴ ᴏғғ' : '✅ ᴛᴜʀɴ ᴏɴ' }, type: 1 }],
        headerType: 1
    }, { quoted: msg });
    break;
}

// Case: settings / ownersettings / botsettings - Owner settings panel
case 'settings':
case 'ownersettings':
case 'botsettings': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴀᴄᴄᴇss sᴇᴛᴛɪɴɢs.',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });

        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const anticallStatus = botState.anticallSettings.rejectCalls ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
        const autoreadStatus = botState.autoReadPM ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
        const modeStatus = botConfig.selfMode ? '🔒 ᴘʀɪᴠᴀᴛᴇ' : '🌐 ᴘᴜʙʟɪᴄ';
        const blockedCallers = botState.anticallSettings.blockedUsers.length;

        const settingsText = 
            `╭━━〔 *⚙️ ʙᴏᴛ sᴇᴛᴛɪɴɢs* 〕━━⊷\n` +
            `┃\n` +
            `┃ *📊 ʙᴏᴛ sᴛᴀᴛs*\n` +
            `┃ • ⏰ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s\n` +
            `┃ • 💾 ʀᴀᴍ: ${usedMemory}ᴍʙ/${totalMemory}ᴍʙ\n` +
            `┃ • 📦 ᴘʀᴇғɪx: ${botConfig.PREFIX}\n` +
            `┃ • 🌐 ᴍᴏᴅᴇ: ${modeStatus}\n` +
            `┃\n` +
            `┃ *🛡️ ᴘʀᴏᴛᴇᴄᴛɪᴏɴ*\n` +
            `┃ • 🛡️ ᴀɴᴛɪᴄᴀʟʟ: ${anticallStatus}\n` +
            `┃ • 🚫 ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs: ${blockedCallers}\n` +
            `┃\n` +
            `┃ *📖 ᴀᴜᴛᴏᴍᴀᴛɪᴏɴ*\n` +
            `┃ • 📖 ᴀᴜᴛᴏʀᴇᴀᴅ: ${autoreadStatus}\n` +
            `┃ • 👁️ ᴀᴜᴛᴏᴠɪᴇᴡ sᴛᴀᴛᴜs: ${botConfig.AUTO_VIEW_STATUS === 'true' ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
            `┃ • ❤️ ᴀᴜᴛᴏʟɪᴋᴇ sᴛᴀᴛᴜs: ${botConfig.AUTO_LIKE_STATUS === 'true' ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
            `┃\n` +
            `┃ *👑 ᴏᴡɴᴇʀ ɪɴғᴏ*\n` +
            `┃ • 👤 ɴᴀᴍᴇ: ${botConfig.OWNER_NAME}\n` +
            `┃ • 📞 ɴᴜᴍʙᴇʀ: ${botConfig.OWNER_NUMBER}\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━⊷\n` +
            `> ${botConfig.BOT_FOOTER}`;

        const buttons = [
            { buttonId: `${prefix}anticall`, buttonText: { displayText: '🛡️ ᴀɴᴛɪᴄᴀʟʟ' }, type: 1 },
            { buttonId: `${prefix}autoread`, buttonText: { displayText: '📖 ᴀᴜᴛᴏʀᴇᴀᴅ' }, type: 1 },
            { buttonId: `${prefix}bluetick`, buttonText: { displayText: '👁️ ʙʟᴜᴇᴛɪᴄᴋ' }, type: 1 },
            { buttonId: `${prefix}mode`, buttonText: { displayText: '🪀 ᴍᴏᴅᴇ' }, type: 1 }
        ];

        await socket.sendMessage(sender, {
            image: { url: botConfig.RCD_IMAGE_PATH },
            caption: settingsText,
            buttons: buttons,
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Settings] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: element / chem - Chemical element info
case 'element':
case 'chem': {
    try {
        const query = args.join(' ').trim();
        if (!query) {
            await socket.sendMessage(sender, {
                text: `⚗️ *ᴇʟᴇᴍᴇɴᴛ ɪɴғᴏ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}element <name or symbol>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}element Hydrogen\`\n• \`${prefix}element Fe\`\n• \`${prefix}element Gold\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⚗️', key: msg.key } });

        // Use popcat API for element info
        const { data } = await axios.get(`https://api.popcat.xyz/periodic-table?element=${encodeURIComponent(query)}`, { timeout: 10000 });

        if (!data || data.error) {
            await socket.sendMessage(sender, {
                text: `❌ *ɴᴏᴛ ғᴏᴜɴᴅ*\n\n"${query}" ɴᴏᴛ ғᴏᴜɴᴅ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        const info = `⚗️ *${data.name} (${data.symbol})*\n\n` +
                    `🔢 *ᴀᴛᴏᴍɪᴄ ɴᴜᴍʙᴇʀ:* ${data.atomic_number}\n` +
                    `⚖️ *ᴀᴛᴏᴍɪᴄ ᴍᴀss:* ${data.atomic_mass}\n` +
                    `📊 *ᴘᴇʀɪᴏᴅ:* ${data.period}\n` +
                    `💧 *ᴘʜᴀsᴇ:* ${data.phase}\n` +
                    `🔬 *ᴅɪsᴄᴏᴠᴇʀᴇᴅ ʙʏ:* ${data.discovered_by || 'N/A'}\n` +
                    `📝 *sᴜᴍᴍᴀʀʏ:* ${data.summary?.slice(0, 200) || 'N/A'}\n\n` +
                    `> ${botConfig.BOT_FOOTER}`;

        if (data.image) {
            await socket.sendMessage(sender, {
                image: { url: data.image },
                caption: info,
                buttons: [
                    { buttonId: `${prefix}element`, buttonText: { displayText: '⚗️ sᴇᴀʀᴄʜ ᴀɢᴀɪɴ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: info,
                buttons: [
                    { buttonId: `${prefix}element`, buttonText: { displayText: '⚗️ sᴇᴀʀᴄʜ ᴀɢᴀɪɴ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Element] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: dm / save - Save and forward replied message to bot's own number
case 'dm':
case 'save': {
    try {
        const quotedMsg2 = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg2) {
            await socket.sendMessage(sender, {
                text: `💾 *sᴀᴠᴇ ᴍᴇssᴀɢᴇ*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ sᴀᴠᴇ ᴀɴᴅ ғᴏʀᴡᴀʀᴅ ɪᴛ ᴛᴏ ᴛʜᴇ ʙᴏᴛ's ᴘᴇʀsᴏɴᴀʟ ᴄʜᴀᴛ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: fakevCard
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

        // Get bot's own number (the account the bot is connected to)
        const botJid = socket.user.id; // Format: "12345678910@s.whatsapp.net"
        
        // Extract number from JID (remove @s.whatsapp.net)
        const botNumber = botJid.split('@')[0];
        
        await socket.sendMessage(sender, {
            text: `📤 *ғᴏʀᴡᴀʀᴅɪɴɢ ᴛᴏ ʙᴏᴛ's ᴄʜᴀᴛ...*\n\n📱 *ʙᴏᴛ ɴᴜᴍʙᴇʀ:* ${botNumber}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });

        // Handle image
        if (quotedMsg2.imageMessage) {
            const stream = await downloadContentFromMessage(quotedMsg2.imageMessage, 'image');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await socket.sendMessage(botJid, {
                image: buffer,
                caption: `📸 *Saved Image*\n\n👤 *From:* ${sender.split('@')[0]}\n${quotedMsg2.imageMessage?.caption ? `📝 *Caption:* ${quotedMsg2.imageMessage.caption}` : ''}`
            });
        }
        // Handle video
        else if (quotedMsg2.videoMessage) {
            const stream = await downloadContentFromMessage(quotedMsg2.videoMessage, 'video');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await socket.sendMessage(botJid, {
                video: buffer,
                caption: `🎥 *Saved Video*\n\n👤 *From:* ${sender.split('@')[0]}\n${quotedMsg2.videoMessage?.caption ? `📝 *Caption:* ${quotedMsg2.videoMessage.caption}` : ''}`
            });
        }
        // Handle audio
        else if (quotedMsg2.audioMessage) {
            const stream = await downloadContentFromMessage(quotedMsg2.audioMessage, 'audio');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await socket.sendMessage(botJid, {
                audio: buffer,
                mimetype: 'audio/mp4',
                ptt: quotedMsg2.audioMessage?.ptt || false,
                caption: `🎵 *Saved Audio*\n\n👤 *From:* ${sender.split('@')[0]}`
            });
        }
        // Handle sticker
        else if (quotedMsg2.stickerMessage) {
            const stream = await downloadContentFromMessage(quotedMsg2.stickerMessage, 'sticker');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await socket.sendMessage(botJid, { 
                sticker: buffer,
                caption: `🎨 *Saved Sticker*\n\n👤 *From:* ${sender.split('@')[0]}`
            });
        }
        // Handle document
        else if (quotedMsg2.documentMessage) {
            const stream = await downloadContentFromMessage(quotedMsg2.documentMessage, 'document');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await socket.sendMessage(botJid, {
                document: buffer,
                mimetype: quotedMsg2.documentMessage?.mimetype,
                fileName: quotedMsg2.documentMessage?.fileName || 'document',
                caption: `📄 *Saved Document*\n\n👤 *From:* ${sender.split('@')[0]}`
            });
        }
        // Handle text
        else if (quotedMsg2.conversation || quotedMsg2.extendedTextMessage) {
            const textContent = quotedMsg2.conversation || quotedMsg2.extendedTextMessage?.text || 'No text';
            await socket.sendMessage(botJid, { 
                text: `💬 *Saved Message*\n\n👤 *From:* ${sender.split('@')[0]}\n📝 *Message:*\n${textContent}`
            });
        }
        // Handle location
        else if (quotedMsg2.locationMessage) {
            const { degreesLatitude, degreesLongitude } = quotedMsg2.locationMessage;
            const mapUrl = `https://maps.google.com/?q=${degreesLatitude},${degreesLongitude}`;
            await socket.sendMessage(botJid, {
                text: `📍 *Saved Location*\n\n👤 *From:* ${sender.split('@')[0]}\n🗺️ *Map:* ${mapUrl}`
            });
        }
        // Handle contact
        else if (quotedMsg2.contactMessage) {
            await socket.sendMessage(botJid, {
                text: `👤 *Saved Contact*\n\n👤 *From:* ${sender.split('@')[0]}\n📇 *Contact:* ${quotedMsg2.contactMessage.displayName || 'N/A'}\n📞 *Number:* ${quotedMsg2.contactMessage.vcard ? 'Check vCard' : 'N/A'}`
            });
        }
        else {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴛʏᴘᴇ*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴀᴜᴅɪᴏ, sᴛɪᴄᴋᴇʀ, ᴅᴏᴄᴜᴍᴇɴᴛ, ʟᴏᴄᴀᴛɪᴏɴ, ᴄᴏɴᴛᴀᴄᴛ, ᴏʀ ᴛᴇxᴛ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: fakevCard
            });
            break;
        }

        // Send success message with CTA button
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: `✅ *ᴍᴇssᴀɢᴇ sᴀᴠᴇᴅ!*\n\nғᴏʀᴡᴀʀᴅᴇᴅ ᴛᴏ ʙᴏᴛ's ᴘᴇʀsᴏɴᴀʟ ᴄʜᴀᴛ sᴜᴄᴄᴇssғᴜʟʟʏ.\n📱 *ʙᴏᴛ ɴᴜᴍʙᴇʀ:* ${botNumber}\n\n> ${botConfig.BOT_FOOTER}` },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '⭐ Star Repo',
                                                url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: `✅ *ᴍᴇssᴀɢᴇ sᴀᴠᴇᴅ!*\n\nғᴏʀᴡᴀʀᴅᴇᴅ ᴛᴏ ʙᴏᴛ's ᴄʜᴀᴛ: ${botNumber}\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: fakevCard
            });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[DM] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${err.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}



                // Case: mode
case 'mode':
case 'botmode':
case 'privatemode':
case 'publicmode': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *Owner Only*',
                quoted: msg
            });
            break;
        }

        if (!args[0]) {
            const currentMode = botConfig.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC';
            
            const modeMessage = {
                text: `🤖 *Bot Mode*\n\n┌─────────────────┐\n│ Current: ${currentMode}\n└─────────────────┘\n\nSelect option:`,
                buttons: [
                    {
                        buttonId: `${prefix}mode private`,
                        buttonText: { displayText: '🔒 PRIVATE' },
                        type: 1
                    },
                    {
                        buttonId: `${prefix}mode public`,
                        buttonText: { displayText: '🌐 PUBLIC' },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, modeMessage, { quoted: msg });
            break;
        }
        
        const mode = args[0].toLowerCase();
        
        if (mode === 'private' || mode === 'priv') {
            if (botConfig.selfMode) {
                await socket.sendMessage(sender, {
                    text: '🔒 Already in PRIVATE mode',
                    quoted: msg
                });
                break;
            }
            
            botConfig.selfMode = true;
            botState.saveConfig();
            
            await socket.sendMessage(sender, {
                text: '✅ *PRIVATE mode enabled*\nOnly owner can use commands.',
                buttons: [
                    {
                        buttonId: `${prefix}mode public`,
                        buttonText: { displayText: '🌐 SWITCH TO PUBLIC' },
                        type: 1
                    }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }
        
        if (mode === 'public' || mode === 'pub') {
            if (!botConfig.selfMode) {
                await socket.sendMessage(sender, {
                    text: '🌐 Already in PUBLIC mode',
                    quoted: msg
                });
                break;
            }
            
            botConfig.selfMode = false;
            botState.saveConfig();
            
            await socket.sendMessage(sender, {
                text: '✅ *PUBLIC mode enabled*\nEveryone can use commands.',
                buttons: [
                    {
                        buttonId: `${prefix}mode private`,
                        buttonText: { displayText: '🔒 SWITCH TO PRIVATE' },
                        type: 1
                    }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }
        
        await socket.sendMessage(sender, {
            text: '❌ Invalid. Use: private or public',
            buttons: [
                {
                    buttonId: `${prefix}mode private`,
                    buttonText: { displayText: '🔒 PRIVATE' },
                    type: 1
                },
                {
                    buttonId: `${prefix}mode public`,
                    buttonText: { displayText: '🌐 PUBLIC' },
                    type: 1
                }
            ],
            headerType: 1
        }, { quoted: msg });
        
    } catch (error) {
        console.error('Mode command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Error: ' + error.message,
            quoted: msg
        });
    }
    break;
}

    // Case: setprefix
                case 'setprefix':
                case 'prefix': {
                    try {
                        if (!isOwner) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Owner Only Command*\n\nThis command can only be used by the bot owner.',
                                quoted: msg
                            });
                            break;
                        }

                        if (args.length === 0) {
                            await socket.sendMessage(sender, {
                                text: `📌 *Current Prefix*\n\n┏━━━━━━━━━━━━━━━━━━┓\n┃ 🔹 Current prefix: *${botConfig.PREFIX}*\n┗━━━━━━━━━━━━━━━━━━┛\n\n*Usage:*\n${botConfig.PREFIX}setprefix <new prefix>\n\n*Example:*\n${botConfig.PREFIX}setprefix !\n\n> *CaseyRhodes Bot*`,
                                quoted: msg
                            });
                            break;
                        }
                        
                        const newPrefix = args[0];
                        
                        if (newPrefix.length > 3) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Invalid Prefix*\n\nPrefix must be 1-3 characters long!\n\n> *CaseyRhodes Bot*',
                                quoted: msg
                            });
                            break;
                        }
                        
                        const oldPrefix = botConfig.PREFIX;
                        botConfig.PREFIX = newPrefix;
                        botState.saveConfig();
                        prefix = newPrefix;
                        
                        await socket.sendMessage(sender, {
                            text: `✅ *Prefix Changed*\n\n┏━━━━━━━━━━━━━━━━━━┓\n┃ 🔹 Old Prefix: *${oldPrefix}*\n┃ 🔸 New Prefix: *${newPrefix}*\n┗━━━━━━━━━━━━━━━━━━┛\n\n*Example:*\n${newPrefix}alive\n\n> *CaseyRhodes Bot*`,
                            quoted: msg
                        });
                        
                    } catch (error) {
                        console.error('Setprefix command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Error changing prefix: ' + error.message,
                            quoted: msg
                        });
                    }
                    break;
                }
                // Case: anticall
              // Case: anticall - Manage anti-call protection
case 'anticall': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const action = args[0]?.toLowerCase();

        if (!action) {
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴄᴀʟʟ sᴛᴀᴛᴜs*\n\n` +
                      `• ᴘʀᴏᴛᴇᴄᴛɪᴏɴ: ${botState.anticallSettings.rejectCalls ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ'}\n` +
                      `• ʙʟᴏᴄᴋ ᴏɴ ᴄᴀʟʟ: ${botState.anticallSettings.blockCaller ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
                      `• ᴀᴜᴛᴏ-ʀᴇᴘʟʏ: ${botState.anticallSettings.autoReply ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
                      `• ʙʟᴏᴄᴋᴇᴅ ᴜsᴇʀs: ${botState.anticallSettings.blockedUsers.length}\n\n` +
                      `*ᴜsᴀɢᴇ:*\n` +
                      `• \`${prefix}anticall on\`\n` +
                      `• \`${prefix}anticall off\`\n` +
                      `• \`${prefix}anticall block <num>\`\n` +
                      `• \`${prefix}anticall unblock <num>\`\n` +
                      `• \`${prefix}anticall blocklist\`\n\n` +
                      `> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}anticall on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}anticall off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}anticall blocklist`, buttonText: { displayText: '📋 ʙʟᴏᴄᴋʟɪsᴛ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        switch (action) {
            case 'on':
                botState.anticallSettings.rejectCalls = true;
                botState.saveAnticallSettings();
                await socket.sendMessage(sender, {
                    text: `✅ *ᴀɴᴛɪ-ᴄᴀʟʟ ᴇɴᴀʙʟᴇᴅ*\n\nᴀʟʟ ɪɴᴄᴏᴍɪɴɢ ᴄᴀʟʟs ᴡɪʟʟ ʙᴇ ʀᴇᴊᴇᴄᴛᴇᴅ.\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;

            case 'off':
                botState.anticallSettings.rejectCalls = false;
                botState.saveAnticallSettings();
                await socket.sendMessage(sender, {
                    text: `❌ *ᴀɴᴛɪ-ᴄᴀʟʟ ᴅɪsᴀʙʟᴇᴅ*\n\nɪɴᴄᴏᴍɪɴɢ ᴄᴀʟʟs ᴡɪʟʟ ɴᴏᴛ ʙᴇ ʀᴇᴊᴇᴄᴛᴇᴅ.\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;

            case 'block': {
                const num = (args[1] || '').replace(/\D/g, '') + '@s.whatsapp.net';
                if (!args[1]) {
                    await socket.sendMessage(sender, {
                        text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}anticall block <number>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}anticall block 254712345678\``,
                        quoted: msg
                    });
                    break;
                }
                if (botState.anticallSettings.blockedUsers.includes(num)) {
                    await socket.sendMessage(sender, {
                        text: `ℹ️ *ᴀʟʀᴇᴀᴅʏ ʙʟᴏᴄᴋᴇᴅ*\n\n${args[1]} ɪs ᴀʟʀᴇᴀᴅʏ ɪɴ ᴛʜᴇ ʙʟᴏᴄᴋ ʟɪsᴛ.`,
                        quoted: msg
                    });
                    break;
                }
                botState.anticallSettings.blockedUsers.push(num);
                botState.saveAnticallSettings();
                await socket.sendMessage(sender, {
                    text: `✅ *${args[1]}* ʙʟᴏᴄᴋᴇᴅ ғʀᴏᴍ ᴄᴀʟʟɪɴɢ.\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            case 'unblock': {
                const num = (args[1] || '').replace(/\D/g, '') + '@s.whatsapp.net';
                if (!args[1]) {
                    await socket.sendMessage(sender, {
                        text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}anticall unblock <number>\``,
                        quoted: msg
                    });
                    break;
                }
                botState.anticallSettings.blockedUsers = botState.anticallSettings.blockedUsers.filter(u => u !== num);
                botState.saveAnticallSettings();
                await socket.sendMessage(sender, {
                    text: `✅ *${args[1]}* ᴜɴʙʟᴏᴄᴋᴇᴅ.\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            case 'blocklist':
            case 'list': {
                if (botState.anticallSettings.blockedUsers.length === 0) {
                    await socket.sendMessage(sender, {
                        text: `📋 *ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs*\n\nɴᴏ ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs.\n\n> ${botConfig.BOT_FOOTER}`,
                        quoted: msg
                    });
                    break;
                }
                const list = botState.anticallSettings.blockedUsers
                    .map((jid, i) => `${i + 1}. ${jid.split('@')[0]}`)
                    .join('\n');
                await socket.sendMessage(sender, {
                    text: `📋 *ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs*\n\n${list}\n\nᴛᴏᴛᴀʟ: ${botState.anticallSettings.blockedUsers.length}\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            default:
                await socket.sendMessage(sender, {
                    text: `❌ *ᴜɴᴋɴᴏᴡɴ ᴏᴘᴛɪᴏɴ*\n\nᴜsᴇ: \`${prefix}anticall on/off/block/unblock/blocklist\``,
                    quoted: msg
                });
        }
    } catch (error) {
        console.error('AntiCall error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ ᴍᴀɴᴀɢɪɴɢ ᴀɴᴛɪ-ᴄᴀʟʟ sᴇᴛᴛɪɴɢs*',
            quoted: msg
        });
    }
    break;
}
                // case country 
                // Case: country / countryinfo - Get detailed information about any country
case 'country':
case 'countryinfo': {
    try {
        if (!args.length) {
            await socket.sendMessage(sender, {
                text: '🌍 *Country Info*\n\nGet detailed information about any country.\n\n*Usage:* `.country <country name>`\n\n*Examples:*\n• `.country Kenya`\n• `.country Japan`\n• `.country Brazil`\n• `.country Germany`\n• `.country Australia`',
                buttons: [
                    { buttonId: `${prefix}country Kenya`, buttonText: { displayText: '🇰🇪 KENYA' }, type: 1 },
                    { buttonId: `${prefix}country Japan`, buttonText: { displayText: '🇯🇵 JAPAN' }, type: 1 },
                    { buttonId: `${prefix}country USA`, buttonText: { displayText: '🇺🇸 USA' }, type: 1 },
                    { buttonId: `${prefix}country UK`, buttonText: { displayText: '🇬🇧 UK' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🌍', key: msg.key } });

        const countryName = args.join(' ');

        // Send searching message
        const searchMsg = await socket.sendMessage(sender, {
            text: `🔍 *Searching for "${countryName}"...*`,
            quoted: fakevCard
        });

        const res = await axios.get(
            `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}`, 
            { timeout: 10000 }
        );
        
        const c = res.data[0];

        // Delete searching message
        try { await socket.sendMessage(sender, { delete: searchMsg.key }); } catch {}

        const currencies = Object.values(c.currencies || {})
            .map(cu => `${cu.name} (${cu.symbol || '—'})`)
            .join(', ');
            
        const languages = Object.values(c.languages || {}).join(', ');
        const flag = c.flag || c.flags?.emoji || '🏳️';
        
        // Format population with commas
        const population = c.population ? c.population.toLocaleString() : 'N/A';
        const area = c.area ? c.area.toLocaleString() : 'N/A';
        
        // Get dial code
        const dialCode = c.idd?.root 
            ? `${c.idd.root}${(c.idd.suffixes || []).join(', ')}` 
            : 'N/A';
        
        // Get timezones (first 3 max)
        const timezones = c.timezones 
            ? c.timezones.slice(0, 3).join(', ') + (c.timezones.length > 3 ? '...' : '')
            : 'N/A';
        
        // Get borders
        const borders = c.borders 
            ? c.borders.slice(0, 5).join(', ') + (c.borders.length > 5 ? '...' : '')
            : 'N/A';
        
        // Get driving side
        const drivingSide = c.car?.side || 'N/A';
        
        // Get start of week
        const startOfWeek = c.startOfWeek || 'N/A';

        const countryText = 
            `${flag} *${c.name.common}*\n` +
            `_${c.name.official}_\n\n` +
            `🌍 *Region:* ${c.subregion || c.region || 'N/A'}\n` +
            `🏙️ *Capital:* ${c.capital?.[0] || 'N/A'}\n` +
            `👥 *Population:* ${population}\n` +
            `📐 *Area:* ${area} km²\n` +
            `💰 *Currency:* ${currencies || 'N/A'}\n` +
            `🗣️ *Languages:* ${languages || 'N/A'}\n` +
            `📞 *Dial Code:* ${dialCode}\n` +
            `🌐 *TLD:* ${c.tld?.join(', ') || 'N/A'}\n` +
            `🗺️ *Timezones:* ${timezones}\n` +
            `🚗 *Driving Side:* ${drivingSide}\n` +
            `📅 *Start of Week:* ${startOfWeek}\n` +
            `🗾 *Borders:* ${borders}\n\n` +
            `> ${botConfig.BOT_FOOTER}`;

        // Build CTA buttons
        const ctaButtons = [];
        
        // Google Maps link
        if (c.latlng && c.latlng.length === 2) {
            const mapsUrl = `https://www.google.com/maps/place/${c.latlng[0]},${c.latlng[1]}`;
            ctaButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '🗺️ GOOGLE MAPS',
                    url: mapsUrl
                })
            });
        }
        
        // Wikipedia link
        ctaButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '📚 WIKIPEDIA',
                url: `https://en.wikipedia.org/wiki/${encodeURIComponent(c.name.common)}`
            })
        });
        
        // Follow Channel button
        ctaButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '📢 JOIN CHANNEL',
                url: botConfig.CHANNEL_LINK
            })
        });

        // Send ONE message with text and CTA buttons (no image)
        const ctaMsg = generateWAMessageFromContent(
            sender,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: countryText },
                            footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: { buttons: ctaButtons }
                        }
                    }
                }
            },
            { quoted: fakevCard }
        );
        await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('Country info error:', error);
        
        const countryName = args.join(' ');
        
        if (error.response?.status === 404) {
            await socket.sendMessage(sender, {
                text: `❌ *Country Not Found*\n\n"${countryName}" was not found.\n\n*Suggestions:*\n• Try the full country name\n• Check for spelling errors\n• Try an alternative name`,
                buttons: [
                    { buttonId: `${prefix}country`, buttonText: { displayText: '🔍 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        } else {
            await socket.sendMessage(sender, {
                text: `❌ *Error fetching country info*\n\nSomething went wrong. Please try again later.`,
                buttons: [
                    { buttonId: `${prefix}country ${countryName}`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        }
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                //case shazam
       // Case: shazam / identify / song - Identify a song from replied audio/video with CTA buttons
case 'shazam':
case 'identify':
case 'songs': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quoted) {
            await socket.sendMessage(sender, {
                text: `🎵 *sʜᴀᴢᴀᴍ - sᴏɴɢ ɪᴅᴇɴᴛɪғɪᴇʀ*\n\nᴘʟᴇᴀsᴇ *ʀᴇᴘʟʏ* ᴛᴏ ᴀɴ ᴀᴜᴅɪᴏ ᴏʀ ᴠɪᴅᴇᴏ ᴍᴇssᴀɢᴇ ᴛᴏ ɪᴅᴇɴᴛɪғʏ ᴛʜᴇ sᴏɴɢ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 Try Again' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        const msgType = Object.keys(quoted)[0];
        if (!['audioMessage', 'videoMessage'].includes(msgType)) {
            await socket.sendMessage(sender, {
                text: `❌ *ɪɴᴠᴀʟɪᴅ ᴍᴇᴅɪᴀ*\n\nᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀɴ *ᴀᴜᴅɪᴏ* 🎵 ᴏʀ *ᴠɪᴅᴇᴏ* 🎬 ᴍᴇssᴀɢᴇ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 Try Again' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎧', key: msg.key } });

        const processingMsg = await socket.sendMessage(sender, {
            text: '🎧 *ɪᴅᴇɴᴛɪғʏɪɴɢ sᴏɴɢ...*\n\nᴘʟᴇᴀsᴇ ᴡᴀɪᴛ ᴀ ᴍᴏᴍᴇɴᴛ...',
            quoted: fakevCard
        });

        let tempFile = null;
        
        const mediaType = msgType.replace('Message', '');
        const stream = await downloadContentFromMessage(quoted[msgType], mediaType);
        
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        tempFile = path.join(TEMP_MEDIA_DIR, `shazam_${Date.now()}.ogg`);
        await writeFile(tempFile, buffer);

        const form = new FormData();
        form.append('return', 'apple_music,spotify');
        form.append('api_token', 'test');
        form.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });

        const res = await axios.post('https://api.audd.io/', form, {
            headers: form.getHeaders(), timeout: 30000
        });
        
        const result = res.data?.result;

        try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch {}

        if (!result) {
            await socket.sendMessage(sender, {
                text: `❌ *sᴏɴɢ ɴᴏᴛ ғᴏᴜɴᴅ*\n\nᴄᴏᴜʟᴅ ɴᴏᴛ ɪᴅᴇɴᴛɪғʏ. ᴛʀʏ ᴀ ᴄʟᴇᴀʀᴇʀ ᴀᴜᴅɪᴏ ᴄʟɪᴘ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 Try Again' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            break;
        }

        const songText = 
            `🎵 *sᴏɴɢ ɪᴅᴇɴᴛɪғɪᴇᴅ!*\n\n` +
            `🎤 *ᴛɪᴛʟᴇ:* ${result.title || 'N/A'}\n` +
            `🎸 *ᴀʀᴛɪsᴛ:* ${result.artist || 'N/A'}\n` +
            `💿 *ᴀʟʙᴜᴍ:* ${result.album || 'N/A'}\n` +
            `📅 *ʀᴇʟᴇᴀsᴇ:* ${result.release_date || 'N/A'}\n\n` +
            `> ${botConfig.BOT_FOOTER}`;

        // Build CTA buttons
        const ctaButtons = [];
        
        if (result.apple_music?.url) {
            ctaButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '🍎 Apple Music',
                    url: result.apple_music.url
                })
            });
        }
        
        if (result.spotify?.external_urls?.spotify) {
            ctaButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '🟢 Spotify',
                    url: result.spotify.external_urls.spotify
                })
            });
        }
        
        // Always add channel button
        ctaButtons.push({
            name: 'cta_crl',
            buttonParamsJson: JSON.stringify({
                display_text: '📢 Join Channel',
                url: botConfig.CHANNEL_LINK
            })
        });

        // Send with CTA buttons
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: songText },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: { buttons: ctaButtons }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            // Fallback with regular buttons
            const fbButtons = [];
            if (result.apple_music?.url) fbButtons.push({ buttonId: result.apple_music.url, buttonText: { displayText: '🍎 Apple Music' }, type: 1 });
            if (result.spotify?.external_urls?.spotify) fbButtons.push({ buttonId: result.spotify.external_urls.spotify, buttonText: { displayText: '🟢 Spotify' }, type: 1 });
            fbButtons.push({ buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 Identify Another' }, type: 1 });
            
            await socket.sendMessage(sender, {
                text: songText,
                buttons: fbButtons,
                headerType: 1
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    } catch (err) {
        console.error('[Shazam] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `⚠️ *sʜᴀᴢᴀᴍ ғᴀɪʟᴇᴅ*\n\n${err.message}\n\nɴᴏᴛᴇ: ғʀᴇᴇ ᴀᴘɪ ʟɪᴍɪᴛᴇᴅ ᴛᴏ 10 ʀᴇǫᴜᴇsᴛs/ʜᴏᴜʀ\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}shazam`, buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: gitclone - Download a GitHub repository as a ZIP file
case 'gitclone': {
    try {
        if (!args[0]) {
            await socket.sendMessage(sender, {
                text: `📦 *GitHub Downloader*\n\nDownload any GitHub repository as a ZIP file.\n\n*Usage:* \`${prefix}gitclone <github_url>\`\n\n*Examples:*\n• \`${prefix}gitclone https://github.com/WhiskeySockets/Baileys\`\n• \`${prefix}gitclone https://github.com/adiwajshing/Baileys\``,
                buttons: [
                    { buttonId: `${prefix}gitclone https://github.com/WhiskeySockets/Baileys`, buttonText: { displayText: '📦 BAILEYS' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        const githubUrl = args[0];
        const GH_REGEX = /(?:https|git)(?::\/\/|@)github\.com[\/:]([^\/:]+)\/(.+)/i;

        if (!GH_REGEX.test(githubUrl)) {
            await socket.sendMessage(sender, {
                text: `⚠️ *Invalid GitHub Link*\n\nPlease provide a valid GitHub repository URL.\n\n*Example:* \`${prefix}gitclone https://github.com/user/repo\``,
                buttons: [
                    { buttonId: `${prefix}gitclone`, buttonText: { displayText: '🔄 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📦', key: msg.key } });

        const [, user, repo] = githubUrl.match(GH_REGEX);
        const cleanRepo = repo.replace(/\.git$/, '');
        const zipUrl = `https://api.github.com/repos/${user}/${cleanRepo}/zipball`;

        // Send fetching message
        const fetchingMsg = await socket.sendMessage(sender, {
            text: `📦 *Fetching Repository...*\n\n🔗 *Repo:* ${user}/${cleanRepo}\n⏳ Please wait...`,
            quoted: msg
        });

        try {
            // Fetch the repository ZIP
            const response = await fetch(zipUrl, { 
                method: 'HEAD',
                redirect: 'follow'
            });
            
            const cd = response.headers.get('content-disposition') || '';
            const filename = cd.match(/attachment; filename=(.*)/)?.[1] || `${cleanRepo}.zip`;

            // Delete fetching message
            try { await socket.sendMessage(sender, { delete: fetchingMsg.key }); } catch {}

            // Send the ZIP file
            await socket.sendMessage(sender, {
                document: { url: zipUrl },
                fileName: filename,
                mimetype: 'application/zip',
                caption: `📦 *Repository Downloaded!*\n\n` +
                         `👤 *Owner:* ${user}\n` +
                         `📂 *Repo:* ${cleanRepo}\n` +
                         `📁 *File:* ${filename}\n` +
                         `🔗 *URL:* https://github.com/${user}/${cleanRepo}\n\n` +
                         `> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `https://github.com/${user}/${cleanRepo}`, buttonText: { displayText: '🔗 VIEW REPO' }, type: 1 },
                    { buttonId: `${prefix}gitclone`, buttonText: { displayText: '📦 DOWNLOAD MORE' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (fetchError) {
            // Delete fetching message
            try { await socket.sendMessage(sender, { delete: fetchingMsg.key }); } catch {}

            throw fetchError;
        }

    } catch (err) {
        console.error('[GitClone] Error:', err.message);
        
        await socket.sendMessage(sender, {
            text: `❌ *Download Failed*\n\n${err.message}\n\n*Note:* Make sure the repository exists and is public.\n\n*Try:* \`${prefix}gitclone https://github.com/user/repo\``,
            buttons: [
                { buttonId: `${prefix}gitclone ${args[0] || ''}`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: emojimix / mixemoji / emojiblend - Mix two emojis together
case 'emojimix':
case 'mixemoji':
case 'emojiblend': {
    try {
        const parts = args.join(' ').split(/\s+/);
        const e1 = parts[0];
        const e2 = parts[1];

        if (!e1 || !e2) {
            await socket.sendMessage(sender, {
                text: '🎨 *Emoji Mix*\n\nMix two emojis together to create a new one!\n\n*Usage:* `.emojimix <emoji1> <emoji2>`\n\n*Examples:*\n• `.emojimix 😂 🔥`\n• `.emojimix 🐱 🌈`\n• `.emojimix 🎃 👻`\n• `.emojimix 😭 💕`\n• `.emojimix 🥺 🌸`',
                buttons: [
                    { buttonId: `${prefix}emojimix 😂 🔥`, buttonText: { displayText: '😂 + 🔥' }, type: 1 },
                    { buttonId: `${prefix}emojimix 🐱 🌈`, buttonText: { displayText: '🐱 + 🌈' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });

        // Send processing message
        const processingMsg = await socket.sendMessage(sender, {
            text: `🎨 *Mixing ${e1} + ${e2}...*\n\nPlease wait...`,
            quoted: msg
        });

        const cp1 = [...e1][0].codePointAt(0).toString(16).toLowerCase();
        const cp2 = [...e2][0].codePointAt(0).toString(16).toLowerCase();
        
        // Try multiple URL formats for better compatibility
        const urls = [
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp1}/u${cp1}_u${cp2}.png`,
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp2}/u${cp2}_u${cp1}.png`,
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp1}/u${cp2}_u${cp1}.png`,
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp2}/u${cp1}_u${cp2}.png`
        ];

        let imageData = null;
        let successUrl = '';

        for (const url of urls) {
            try {
                const response = await axios.get(url, { 
                    responseType: 'arraybuffer', 
                    timeout: 10000 
                });
                if (response.data && response.data.length > 1000) {
                    imageData = Buffer.from(response.data);
                    successUrl = url;
                    break;
                }
            } catch {
                continue;
            }
        }

        // Delete processing message
        try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch {}

        if (!imageData) {
            await socket.sendMessage(sender, {
                text: `❌ *Emoji Mix Failed*\n\nThis combination (${e1} + ${e2}) is not available.\n\n*Try these popular combos:*\n• 😂 + 🔥 = Laughing Fire\n• 🐱 + 🌈 = Rainbow Cat\n• 😭 + 💕 = Crying Love\n• 🥺 + 🌸 = Pleading Flower\n• 🎃 + 👻 = Spooky Ghost`,
                buttons: [
                    { buttonId: `${prefix}emojimix 😂 🔥`, buttonText: { displayText: '😂 + 🔥' }, type: 1 },
                    { buttonId: `${prefix}emojimix 😭 💕`, buttonText: { displayText: '😭 + 💕' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            break;
        }

        // Send the mixed emoji
        await socket.sendMessage(sender, {
            image: imageData,
            caption: `🎨 *Emoji Mix!*\n\n${e1} + ${e2} = ✨\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}emojimix`, buttonText: { displayText: '🎨 MIX MORE' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('EmojiMix error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Error mixing emojis*\n\nSomething went wrong. Try again later.`,
            buttons: [
                { buttonId: `${prefix}emojimix`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: eval / exec / run - Execute JavaScript code 
case 'eval':
case 'exec':
case 'run': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴅᴇ.',
                quoted: fakevCard
            });
            break;
        }

        const code = args.join(' ').trim();
        
        if (!code) {
            await socket.sendMessage(sender, {
                text: `⚠️ *ᴇᴠᴀʟ*\n\nᴘʀᴏᴠɪᴅᴇ ᴄᴏᴅᴇ ᴛᴏ ᴇxᴇᴄᴜᴛᴇ.\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}eval 2 + 2\`\n\`${prefix}eval socket.user.id\`\n\`${prefix}eval Object.keys(msg.message)\``,
                quoted: fakevCard
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

        const start = Date.now();
        let result, isError = false;

        try {
            const sandbox = {
                sock: socket,
                msg,
                sender,
                from,
                isGroup,
                isOwner,
                args,
                command,
                prefix,
                config,
                require,
                console: { 
                    log: (...a) => { result = a.join(' '); } 
                },
                global,
                process,
                os,
                fs,
                path,
                axios,
                crypto,
                moment
            };
            
            const raw = vm.runInNewContext(
                `(async () => { return (${code}) })()`,
                sandbox,
                { timeout: 8000 }
            );
            result = await raw;
        } catch (e) {
            result = e.message;
            isError = true;
        }

        const elapsed = Date.now() - start;
        const label = isError ? '❌ ᴇʀʀᴏʀ' : '✅ ʀᴇsᴜʟᴛ';
        const output = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
        const trimmed = output.length > 3000 ? output.slice(0, 3000) + '\n...[truncated]' : output;
        
        const resultText = `*${label}* (${elapsed}ms)\n\`\`\`\n${trimmed}\n\`\`\`\n\n> ${botConfig.BOT_FOOTER}`;

        // Send ONE message with CTA copy button only
        const ctaMsg = generateWAMessageFromContent(
            sender,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: resultText },
                            footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: {
                                buttons: [
                                    {
                                        name: 'cta_copy',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: ' Copy Result',
                                            copy_code: `${label} (${elapsed}ms)\n\n${output}`
                                        })
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            { quoted: fakevCard }
        );
        await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });

        await socket.sendMessage(sender, { react: { text: isError ? '❌' : '✅', key: msg.key } });

    } catch (err) {
        console.error('[Eval] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴇᴠᴀʟ ғᴀɪʟᴇᴅ*\n\n${err.message}`,
            quoted: fakevCard
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//case translate
// Case: translate
case 'translate':
case 'trt': {
    try {
        if (args.length < 2) {
            return await socket.sendMessage(sender, {
                text: `❌ *Usage:* \`.translate <lang> <text>\`\n\n*Examples:*\n• \`.translate fr Hello world\`\n• \`.translate sw Good morning\`\n\n🌍 *Common Codes:*\n• fr - French\n• es - Spanish\n• de - German\n• ar - Arabic\n• sw - Swahili\n• zh - Chinese\n• ja - Japanese\n• pt - Portuguese\n• hi - Hindi\n• ru - Russian`,
                quoted: msg
            });
        }
        
        const targetLang = args[0].toLowerCase();
        const text = args.slice(1).join(' ');
        
        if (!text) {
            return await socket.sendMessage(sender, {
                text: `❌ Please provide text to translate!\n\n*Example:* \`.translate fr Hello world\``,
                quoted: msg
            });
        }
        
        await socket.sendMessage(sender, { react: { text: '🌍', key: msg.key } });
        
        const res = await axios.get('https://api.mymemory.translated.net/get', {
            params: { 
                q: text, 
                langpair: `en|${targetLang}` 
            },
            timeout: 10000
        });
        
        const translated = res.data?.responseData?.translatedText;
        
        if (!translated || res.data.responseStatus !== 200) {
            throw new Error('Translation failed');
        }
        
        const translationText = `🌍 *Translation*\n\n` +
            `📝 *Original (en):*\n${text}\n\n` +
            `✅ *Translated (${targetLang.toUpperCase()}):*\n${translated}\n\n` +
            `> ${botConfig.BOT_FOOTER}`;
        
        await socket.sendMessage(sender, {
            text: translationText,
            quoted: msg
        });
        
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        
    } catch (error) {
        console.error('Translate error:', error);
        await socket.sendMessage(sender, {
            text: `❌ Translation failed! Check the language code and try again.\n\n*Common Codes:*\n• fr - French\n• es - Spanish\n• de - German\n• ar - Arabic\n• sw - Swahili\n• zh - Chinese\n• ja - Japanese\n• pt - Portuguese\n• hi - Hindi\n• ru - Russian\n\n*Usage:* \`.translate fr Hello world\``,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// ============ WELCOME COMMAND ============
case 'welcome':
case 'welc': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const action = (args[0] || '').toLowerCase();
        const settings = botState.welcomeSettings.get(String(from).split(':')[0]) || { 
            welcome: false, 
            goodbye: false, 
            customWelcome: '', 
            customGoodbye: ''
        };

        if (action === 'on') {
            settings.welcome = true;
            botState.welcomeSettings.set(String(from).split(':')[0], settings);
            botState.saveWelcomeSettings();
            await socket.sendMessage(sender, {
                text: `👋 *ᴡᴇʟᴄᴏᴍᴇ ᴇɴᴀʙʟᴇᴅ!*\n\nɴᴇᴡ ᴍᴇᴍʙᴇʀs ᴡɪʟʟ ʙᴇ ᴡᴇʟᴄᴏᴍᴇᴅ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}welcome off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else if (action === 'off') {
            settings.welcome = false;
            botState.welcomeSettings.set(String(from).split(':')[0], settings);
            botState.saveWelcomeSettings();
            await socket.sendMessage(sender, {
                text: `👋 *ᴡᴇʟᴄᴏᴍᴇ ᴅɪsᴀʙʟᴇᴅ!*\n\nɴᴏ ᴡᴇʟᴄᴏᴍᴇ ᴍᴇssᴀɢᴇs ᴡɪʟʟ ʙᴇ sᴇɴᴛ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}welcome on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        else {
            const status = settings.welcome ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `👋 *ᴡᴇʟᴄᴏᴍᴇ sᴛᴀᴛᴜs*\n\n📌 sᴛᴀᴛᴜs: ${status}\n\n*ᴜsᴀɢᴇ:*\n• \`${prefix}welcome on\`\n• \`${prefix}welcome off\`\n• \`${prefix}setwelcome <message>\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}welcome on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}welcome off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Welcome command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}

// ============ GOODBYE COMMAND ============
case 'goodbye':
case 'goodb': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const action = (args[0] || '').toLowerCase();
        const settings = botState.welcomeSettings.get(String(from).split(':')[0]) || { 
            welcome: false, 
            goodbye: false, 
            customWelcome: '', 
            customGoodbye: ''
        };

        if (action === 'on') {
            settings.goodbye = true;
            botState.welcomeSettings.set(String(from).split(':')[0], settings);
            botState.saveWelcomeSettings();
            await socket.sendMessage(sender, {
                text: `👋 *ɢᴏᴏᴅʙʏᴇ ᴇɴᴀʙʟᴇᴅ!*\n\nʟᴇᴀᴠɪɴɢ ᴍᴇᴍʙᴇʀs ᴡɪʟʟ ʀᴇᴄᴇɪᴠᴇ ᴀ ғᴀʀᴇᴡᴇʟʟ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}goodbye off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else if (action === 'off') {
            settings.goodbye = false;
            botState.welcomeSettings.set(String(from).split(':')[0], settings);
            botState.saveWelcomeSettings();
            await socket.sendMessage(sender, {
                text: `👋 *ɢᴏᴏᴅʙʏᴇ ᴅɪsᴀʙʟᴇᴅ!*\n\nɴᴏ ғᴀʀᴇᴡᴇʟʟ ᴍᴇssᴀɢᴇs ᴡɪʟʟ ʙᴇ sᴇɴᴛ.\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}goodbye on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        else {
            const status = settings.goodbye ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `👋 *ɢᴏᴏᴅʙʏᴇ sᴛᴀᴛᴜs*\n\n📌 sᴛᴀᴛᴜs: ${status}\n\n*ᴜsᴀɢᴇ:*\n• \`${prefix}goodbye on\`\n• \`${prefix}goodbye off\`\n• \`${prefix}setgoodbye <message>\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}goodbye on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}goodbye off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Goodbye command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}

// ============ SET WELCOME MESSAGE ============
case 'setwelcome':
case 'setwelc': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const newMessage = args.join(' ').trim();
        if (!newMessage) {
            await socket.sendMessage(sender, {
                text: `📝 *sᴇᴛ ᴡᴇʟᴄᴏᴍᴇ ᴍᴇssᴀɢᴇ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}setwelcome <message>\`\n\n*ᴘʟᴀᴄᴇʜᴏʟᴅᴇʀs:*\n• {name} - ᴍᴇᴍʙᴇʀ ɴᴀᴍᴇ\n• {group} - ɢʀᴏᴜᴘ ɴᴀᴍᴇ\n• {membercount} - ᴛᴏᴛᴀʟ ᴍᴇᴍʙᴇʀs\n• {mention} - ᴛᴀɢ ᴛʜᴇ ᴍᴇᴍʙᴇʀ\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}setwelcome Welcome {mention} to {group}! 🎉\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        const settings = botState.welcomeSettings.get(String(from).split(':')[0]) || { 
            welcome: false, 
            goodbye: false, 
            customWelcome: '', 
            customGoodbye: ''
        };
        
        settings.customWelcome = newMessage;
        settings.welcome = true;
        botState.welcomeSettings.set(String(from).split(':')[0], settings);
            botState.saveWelcomeSettings();

        await socket.sendMessage(sender, {
            text: `✅ *ᴄᴜsᴛᴏᴍ ᴡᴇʟᴄᴏᴍᴇ ᴍᴇssᴀɢᴇ sᴇᴛ!*\n\n📝 ${newMessage}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch (error) {
        console.error('Setwelcome error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}

// ============ SET GOODBYE MESSAGE ============
case 'setgoodbye':
case 'setgoodb': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const newMessage = args.join(' ').trim();
        if (!newMessage) {
            await socket.sendMessage(sender, {
                text: `📝 *sᴇᴛ ɢᴏᴏᴅʙʏᴇ ᴍᴇssᴀɢᴇ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}setgoodbye <message>\`\n\n*ᴘʟᴀᴄᴇʜᴏʟᴅᴇʀs:*\n• {name} - ᴍᴇᴍʙᴇʀ ɴᴀᴍᴇ\n• {group} - ɢʀᴏᴜᴘ ɴᴀᴍᴇ\n• {membercount} - ᴛᴏᴛᴀʟ ᴍᴇᴍʙᴇʀs\n• {mention} - ᴛᴀɢ ᴛʜᴇ ᴍᴇᴍʙᴇʀ\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}setgoodbye Goodbye {mention}, we will miss you! 👋\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        const settings = botState.welcomeSettings.get(String(from).split(':')[0]) || { 
            welcome: false, 
            goodbye: false, 
            customWelcome: '', 
            customGoodbye: ''
        };
        
        settings.customGoodbye = newMessage;
        settings.goodbye = true;
        botState.welcomeSettings.set(String(from).split(':')[0], settings);
            botState.saveWelcomeSettings();

        await socket.sendMessage(sender, {
            text: `✅ *ᴄᴜsᴛᴏᴍ ɢᴏᴏᴅʙʏᴇ ᴍᴇssᴀɢᴇ sᴇᴛ!*\n\n📝 ${newMessage}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch (error) {
        console.error('Setgoodbye error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}
// ============ ANTI-DELETE COMMAND ============
case 'antidelete':
case 'antidel': {
    try {
        const action = (args[0] || '').toLowerCase();
        const mode = (args[1] || '').toLowerCase();
        if (action === 'on' || action === 'enable') {
            botState.antiDeleteEnabled = true;
            if (mode === 'groups' || mode === 'all') botState.antiDeleteMode = mode;
            botState.saveAntiDelete();
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ ᴇɴᴀʙʟᴇᴅ*\n\nMode: *${botState.antiDeleteMode}*\nDeleted messages will be restored when possible.`,
                quoted: msg
            });
        } else if (action === 'off' || action === 'disable') {
            botState.antiDeleteEnabled = false;
            botState.saveAntiDelete();
            await socket.sendMessage(sender, {
                text: '🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ ᴅɪsᴀʙʟᴇᴅ*',
                quoted: msg
            });
        } else if (action === 'groups') {
            botState.antiDeleteEnabled = true;
            botState.antiDeleteMode = 'groups';
            botState.saveAntiDelete();
            await socket.sendMessage(sender, {
                text: '🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ ᴇɴᴀʙʟᴇᴅ ғᴏʀ ɢʀᴏᴜᴘs*',
                quoted: msg
            });
        } else {
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ*\n\nStatus: ${botState.antiDeleteEnabled ? '✅ ON' : '❌ OFF'}\nMode: ${botState.antiDeleteMode}\n\nUsage:\n• ${prefix}antidelete on\n• ${prefix}antidelete off\n• ${prefix}antidelete groups`,
                quoted: msg
            });
        }
    } catch (error) {
        console.error('AntiDelete command error:', error);
        await socket.sendMessage(sender, { text: `❌ Anti-delete error: ${error.message}`, quoted: msg });
    }
    break;
}

                // Case: alive
                case 'uptime':
                case 'alive': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const captionText = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*
*╭─────────────────⊷*
*┃* ʙᴏᴛ ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
*┃* ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeSockets.size}
*┃* ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
*┃* ᴠᴇʀsɪᴏɴ: ${botConfig.version}
*┃* ᴍᴏᴅᴇ: ${botConfig.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC'}
*┃* ᴀɴᴛɪᴄᴀʟʟ: ${botConfig.anticall ? '✅ ON' : '❌ OFF'}
*┃* ᴘʀᴇғɪx: ${botConfig.PREFIX}
*┃* ᴍᴇᴍᴏʀʏ ᴜsᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
*╰───────────────┈⊷*

> *▫️ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴍᴀɪɴ*
> sᴛᴀᴛᴜs: ONLINE ✅
> ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms`;

                        const aliveMessage = {
                            image: { url: "https://i.ibb.co/WL41FHC/2eaf023e6691.jpg" },
                            caption: `> ᴀᴍ ᴀʟɪᴠᴇ ɴ ᴋɪᴄᴋɪɴɢ 🥳\n\n${captionText}`,
                            buttons: [
                                {
                                    buttonId: `${botConfig.PREFIX}menu_action`,
                                    buttonText: { displayText: '📂 ᴍᴇɴᴜ ᴏᴘᴛɪᴏɴ' },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify({
                                            title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ ❏',
                                            sections: [
                                                {
                                                    title: `ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ`,
                                                    highlight_label: 'Quick Actions',
                                                    rows: [
                                                        { title: '📋 ғᴜʟʟ ᴍᴇɴᴜ', description: 'ᴠɪᴇᴡ ᴀʟʟ ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅs', id: `${botConfig.PREFIX}menu` },
                                                        { title: '💓 ᴀʟɪᴠᴇ ᴄʜᴇᴄᴋ', description: 'ʀᴇғʀᴇs ʙᴏᴛ sᴛᴀᴛᴜs', id: `${botConfig.PREFIX}alive` },
                                                        { title: '💫 ᴘɪɴɢ ᴛᴇsᴛ', description: 'ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴᴅ sᴘᴇᴇᴅ', id: `${botConfig.PREFIX}ping` }
                                                    ]
                                                },
                                                {
                                                    title: "ϙᴜɪᴄᴋ ᴄᴍᴅs",
                                                    highlight_label: 'Popular',
                                                    rows: [
                                                        { title: '🤖 ᴀɪ ᴄʜᴀᴛ', description: 'Start AI conversation', id: `${botConfig.PREFIX}ai Hello!` },
                                                        { title: '🎵 ᴍᴜsɪᴄ sᴇᴀʀᴄʜ', description: 'Download your favorite songs', id: `${botConfig.PREFIX}song` },
                                                        { title: '📰 ʟᴀᴛᴇsᴛ ɴᴇᴡs', description: 'Get current news updates', id: `${botConfig.PREFIX}news` }
                                                    ]
                                                }
                                            ]
                                        })
                                    }
                                },
                                { buttonId: `${botConfig.PREFIX}session`, buttonText: { displayText: '🌟 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                                { buttonId: `${botConfig.PREFIX}active`, buttonText: { displayText: '📈 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
                            ],
                            headerType: 1,
                            viewOnce: true,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363420261263259@newsletter',
                                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                                    serverMessageId: -1
                                }
                            }
                        };

                        await socket.sendMessage(m.chat, aliveMessage, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Alive command error:', error);
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const errorMessage = {
                            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
                            caption: `*🤖 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴀʟɪᴠᴇ*\n\n` +
                                    `*╭─────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*\n` +
                                    `*┃* ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s\n` +
                                    `*┃* sᴛᴀᴛᴜs: ᴏɴʟɪɴᴇ\n` +
                                    `*┃* ɴᴜᴍʙᴇʀ: ${number}\n` +
                                    `*┃* ᴍᴏᴅᴇ: ${botConfig.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC'}\n` +
                                    `*┃* ᴀɴᴛɪᴄᴀʟʟ: ${botConfig.anticall ? '✅ ON' : '❌ OFF'}\n` +
                                    `*┃* ᴘʀᴇғɪx: ${botConfig.PREFIX}\n` +
                                    `*╰──────────────⊷*\n\n` +
                                    `Type *${botConfig.PREFIX}menu* for commands`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363420261263259@newsletter',
                                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                                    serverMessageId: -1
                                }
                            }
                        };

                        await socket.sendMessage(m.chat, errorMessage, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: groupstatus
         // Case: groupstatus / ginfo / groupinfo / grpinfo / gstatus - Show group info
case 'groupstatus':
case 'ginfo':
case 'groupinfo':
case 'grpinfo':
case 'gstatus': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *Group Only Command*\n\nThis command can only be used in groups.',
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📊', key: msg.key } });

        let meta;
        try {
            meta = await socket.groupMetadata(from);
        } catch {
            await socket.sendMessage(sender, {
                text: '❌ Could not fetch group information.',
                quoted: msg
            });
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            break;
        }

        const participants = meta.participants || [];
        const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
        const superAdmins = participants.filter(p => p.admin === 'superadmin');
        const members = participants.filter(p => !p.admin);

        const createdAt = meta.creation
            ? new Date(meta.creation * 1000).toLocaleString('en-US', {
                day: 'numeric', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
                timeZone: 'Africa/Nairobi'
              })
            : 'Unknown';

        const ownerNum = meta.owner 
            ? meta.owner.split('@')[0] 
            : superAdmins[0]?.id.split('@')[0] || 'Unknown';

        let inviteLink = '';
        try {
            const code = await socket.groupInviteCode(from);
            inviteLink = `https://chat.whatsapp.com/${code}`;
        } catch { 
            inviteLink = 'Not available (Admin only)';
        }

        const desc = meta.desc
            ? `\n📄 *Description:*\n${meta.desc.trim().substring(0, 200)}${meta.desc.trim().length > 200 ? '...' : ''}`
            : '';

        const announce = meta.announce ? '🔒 Admins only' : '🌐 All members';
        const restrict = meta.restrict ? '🔒 Admins only' : '🌐 All members';
        const ephemeral = meta.ephemeral
            ? `${meta.ephemeral / 86400} days`
            : '❌ Off';

        const infoText =
            `╔══════════════════╗\n` +
            `  📊 *GROUP INFORMATION*\n` +
            `╚══════════════════╝\n\n` +
            `🏷️ *Name:* ${meta.subject || 'N/A'}\n` +
            `🆔 *ID:* \`${from.split('@')[0]}\`\n` +
            `👑 *Owner:* @${ownerNum}\n` +
            `📅 *Created:* ${createdAt}\n` +
            `${desc}\n` +
            `\n👥 *Members:* ${participants.length}\n` +
            `   ├ 👑 Super Admins: ${superAdmins.length}\n` +
            `   ├ 🛡️ Admins: ${admins.length}\n` +
            `   └ 👤 Members: ${members.length}\n` +
            `\n⚙️ *Settings:*\n` +
            `   ├ 💬 Messages: ${announce}\n` +
            `   ├ ✏️ Edit Info: ${restrict}\n` +
            `   └ ⏳ Disappearing: ${ephemeral}\n` +
            `\n🔗 *Invite:* ${inviteLink}\n\n` +
            `> ${botConfig.BOT_FOOTER}`;

        const mentions = [meta.owner, ...superAdmins.map(p => p.id)].filter(Boolean);

        // Build buttons
        const buttons = [];
        
        if (inviteLink && inviteLink.startsWith('https://')) {
            buttons.push({
                buttonId: inviteLink,
                buttonText: { displayText: '🔗 INVITE LINK' },
                type: 1
            });
        }
        
        buttons.push({
            buttonId: `${prefix}tagall`,
            buttonText: { displayText: '👥 TAG ALL' },
            type: 1
        });
        
        buttons.push({
            buttonId: `${prefix}tagadmins`,
            buttonText: { displayText: '🛡️ TAG ADMINS' },
            type: 1
        });

        // Try to send with group icon
        try {
            const pp = await socket.profilePictureUrl(from, 'image');
            await socket.sendMessage(sender, {
                image: { url: pp },
                caption: infoText,
                mentions: mentions,
                buttons: buttons,
                headerType: 1
            }, { quoted: msg });
        } catch {
            // Send without group icon
            await socket.sendMessage(sender, {
                text: infoText,
                mentions: mentions,
                buttons: buttons,
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('GroupStatus error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Error fetching group info*\n\n${error.message}`,
            buttons: [
                { buttonId: `${prefix}gstatus`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: togstatus / swgc / groupstatus - Send group status updates
case 'togstatus':
case 'swgc':
case 'groupstatus': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', 
                quoted: fakevCard
            });
            break;
        }

        // Check if user is admin or owner
        const isAdmin = isSenderGroupAdmin || isOwner;
        if (!isAdmin) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴄᴀɴ ᴘᴏsᴛ sᴛᴀᴛᴜs ᴜᴘᴅᴀᴛᴇs.',
                quoted: fakevCard
            });
            break;
        }

        const raw = args.join(' ').trim();
        let [caption, color, groupUrl] = raw.split('|').map(v => v?.trim());

        let targetGroupId = from;
        if (groupUrl) {
            try {
                const code = groupUrl.split('/').pop().split('?')[0];
                const info = await socket.groupGetInviteInfo(code);
                targetGroupId = info.id;
            } catch {
                await socket.sendMessage(sender, { 
                    text: '❌ ɪɴᴠᴀʟɪᴅ ɢʀᴏᴜᴘ ʟɪɴᴋ.', 
                    quoted: fakevCard 
                });
                break;
            }
        }

        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            (msg.message?.imageMessage ? msg.message : null) ||
            (msg.message?.videoMessage ? msg.message : null) ||
            (msg.message?.audioMessage ? msg.message : null);

        const COLORS = {
            blue: '#34B7F1', 
            green: '#25D366', 
            yellow: '#FFD700',
            orange: '#FF8C00', 
            red: '#FF3B30', 
            purple: '#9C27B0',
            gray: '#9E9E9E', 
            black: '#000000', 
            white: '#FFFFFF', 
            cyan: '#00BCD4'
        };

        const hasMedia = quotedMsg && (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage);

        // If no media and no caption
        if (!hasMedia && !caption) {
            await socket.sendMessage(sender, {
                text: `📝 *ɢʀᴏᴜᴘ sᴛᴀᴛᴜs*\n\n• \`${prefix}togstatus caption|color\`\n• \`${prefix}togstatus |blue\`\n• ʀᴇᴘʟʏ ᴛᴏ ɪᴍᴀɢᴇ/ᴠɪᴅᴇᴏ/ᴀᴜᴅɪᴏ\n\n🎨 blue, green, yellow, orange, red, purple, gray, black, white, cyan\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: fakevCard
            });
            break;
        }

        // Send typing indicator
        try {
            await socket.sendPresenceUpdate('composing', targetGroupId);
        } catch (e) {}

        // If no media, send text status
        if (!hasMedia) {
            const bgHex = COLORS[color?.toLowerCase()] || COLORS.blue;
            
            // Send using groupStatusPost (this posts as a group announcement)
            await groupStatusPost(socket, targetGroupId, {
                extendedTextMessage: { 
                    text: caption, 
                    backgroundArgb: hexToArgb(bgHex), 
                    font: 0 
                }
            });

            // Send success confirmation
            await socket.sendMessage(sender, {
                text: `✅ *ᴛᴇxᴛ sᴛᴀᴛᴜs sᴇɴᴛ!*\n\n📝 ${caption}\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: fakevCard
            });
            
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            break;
        }

        // Handle media messages
        await socket.sendMessage(sender, { react: { text: '📤', key: msg.key } });

        if (quotedMsg.imageMessage) {
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            
            // Send image status using groupStatusPost for proper group status
            const content = await generateWAMessageContent(
                { image: buffer, caption: caption || '📸 Group Status Update' }, 
                { upload: socket.waUploadToServer }
            );
            await groupStatusPost(socket, targetGroupId, content);

            await socket.sendMessage(sender, {
                text: '✅ *ɪᴍᴀɢᴇ sᴛᴀᴛᴜs sᴇɴᴛ!*',
                quoted: fakevCard
            });
        }
        else if (quotedMsg.videoMessage) {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            
            // Send video status using groupStatusPost
            const content = await generateWAMessageContent(
                { video: buffer, caption: caption || '🎬 Group Status Update' }, 
                { upload: socket.waUploadToServer }
            );
            await groupStatusPost(socket, targetGroupId, content);

            await socket.sendMessage(sender, {
                text: '✅ *ᴠɪᴅᴇᴏ sᴛᴀᴛᴜs sᴇɴᴛ!*',
                quoted: fakevCard
            });
        }
        else if (quotedMsg.audioMessage) {
            const stream = await downloadContentFromMessage(quotedMsg.audioMessage, 'audio');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            
            // Convert to voice note
            const vn = await toVN(buffer);
            const waveform = await generateWaveform(buffer);
            
            // Send audio status using groupStatusPost
            const content = await generateWAMessageContent(
                { 
                    audio: vn, 
                    mimetype: 'audio/ogg; codecs=opus', 
                    ptt: true,
                    waveform: Buffer.from(waveform, 'base64')
                }, 
                { upload: socket.waUploadToServer }
            );
            await groupStatusPost(socket, targetGroupId, content);

            await socket.sendMessage(sender, {
                text: '✅ *ᴀᴜᴅɪᴏ sᴛᴀᴛᴜs sᴇɴᴛ!*',
                quoted: fakevCard
            });
        }
        else {
            await socket.sendMessage(sender, { 
                text: '❌ ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴍᴇᴅɪᴀ.', 
                quoted: fakevCard 
            });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[togstatus] Error:', err);
        await socket.sendMessage(sender, { 
            text: `❌ *sᴛᴀᴛᴜs ᴇʀʀᴏʀ:* ${err.message}`, 
            quoted: fakevCard 
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: mediafire / mf / mfdl - Get MediaFire direct download link
case 'mediafire':
case 'mf':
case 'mfdl': {
    try {
        const url = args[0];
        
        if (!url || !url.includes('mediafire.com')) {
            await socket.sendMessage(sender, {
                text: `📁 *MediaFire Downloader*\n\nExtract direct download links from MediaFire.\n\n*Usage:* \`${prefix}mf <mediafire_url>\`\n\n*Example:*\n\`${prefix}mf https://www.mediafire.com/file/abc123/filename.zip/file\``,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📁', key: msg.key } });

        // Send processing message
        await socket.sendMessage(sender, {
            text: '⏳ *Extracting MediaFire link...*',
            quoted: msg
        });

        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
            }
        });

        // Try multiple patterns to find download link
        let dlUrl = '';
        let fileName = 'file';

        // Pattern 1: Direct download link
        const match1 = data.match(/href="(https:\/\/download\d+\.mediafire\.com[^"]+)"/);
        if (match1) dlUrl = match1[1];

        // Pattern 2: Alternative download link
        if (!dlUrl) {
            const match2 = data.match(/href="(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/i);
            if (match2) dlUrl = match2[1];
        }

        // Pattern 3: Another format
        if (!dlUrl) {
            const match3 = data.match(/(https:\/\/download\d+\.mediafire\.com\/[^\s"']+)/i);
            if (match3) dlUrl = match3[1];
        }

        if (!dlUrl) {
            throw new Error('Could not extract download link. File may be removed or private.');
        }

        // Try multiple patterns for filename
        const nameMatch1 = data.match(/<div class="filename">([^<]+)<\/div>/);
        const nameMatch2 = data.match(/class="dl-btn-label[^"]*">([^<]+)<\/span>/);
        const nameMatch3 = data.match(/<title>([^<]+)<\/title>/);
        
        if (nameMatch1) fileName = nameMatch1[1].trim();
        else if (nameMatch2) fileName = nameMatch2[1].trim();
        else if (nameMatch3) fileName = nameMatch3[1].trim().replace('MediaFire', '').replace(/[-–—]/g, '').trim();

        // Clean up filename
        fileName = fileName.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

        await socket.sendMessage(sender, {
            text: `📁 *MediaFire Download*\n\n` +
                  `📄 *File:* ${fileName}\n` +
                  `🔗 *Link:* ${dlUrl}\n\n` +
                  `> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[MediaFire] Error:', error.message);
        
        await socket.sendMessage(sender, {
            text: `❌ *MediaFire Failed*\n\n${error.message}\n\n*Tips:*\n• Make sure the file is public\n• Check if the link is valid\n• File may have been removed`,
            quoted: msg
        });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: npm - Search NPM packages
case 'npm': {
    try {
        const query = args.join(' ').trim();
        
        if (!query) {
            await socket.sendMessage(sender, {
                text: `📦 *ɴᴘᴍ sᴇᴀʀᴄʜ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}npm <package name>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}npm axios\`\n• \`${prefix}npm baileys\`\n• \`${prefix}npm figlet\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}npm axios`, buttonText: { displayText: '📦 ᴀxɪᴏs' }, type: 1 },
                    { buttonId: `${prefix}npm baileys`, buttonText: { displayText: '📦 ʙᴀɪʟᴇʏs' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📦', key: msg.key } });

        const { data } = await axios.get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=1`, { timeout: 10000 });
        
        if (!data?.objects?.length) {
            await socket.sendMessage(sender, {
                text: `❌ *ɴᴏᴛ ғᴏᴜɴᴅ*\n\nɴᴏ ᴘᴀᴄᴋᴀɢᴇ ғᴏᴜɴᴅ ғᴏʀ "${query}".\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        const pkg = data.objects[0].package;
        const pkgDate = pkg.date ? new Date(pkg.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';

        const result = `📦 *${pkg.name}*\n\n` +
                      `🔖 *ᴠᴇʀsɪᴏɴ:* ${pkg.version}\n` +
                      `📝 *ᴅᴇsᴄ:* ${pkg.description || 'N/A'}\n` +
                      `👤 *ᴘᴜʙʟɪsʜᴇʀ:* ${pkg.publisher?.username || 'N/A'}\n` +
                      `📜 *ʟɪᴄᴇɴsᴇ:* ${pkg.license || 'N/A'}\n` +
                      `📅 *ᴜᴘᴅᴀᴛᴇᴅ:* ${pkgDate}\n\n` +
                      `🔗 *ɴᴘᴍ:* https://npmjs.com/package/${pkg.name}\n` +
                      `🔗 *ʀᴇᴘᴏ:* ${pkg.links?.repository || 'N/A'}\n\n` +
                      `> ${botConfig.BOT_FOOTER}`;

        await socket.sendMessage(sender, {
            text: result,
            buttons: [
                { buttonId: `https://npmjs.com/package/${pkg.name}`, buttonText: { displayText: '🔗 ᴠɪᴇᴡ ᴏɴ ɴᴘᴍ' }, type: 1 },
                { buttonId: `${prefix}npm`, buttonText: { displayText: '📦 sᴇᴀʀᴄʜ ᴀɢᴀɪɴ' }, type: 1 }
            ],
            headerType: 1,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: botConfig.NEWSLETTER_JID,
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ',
                    serverMessageId: -1
                }
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[NPM] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *sᴇᴀʀᴄʜ ғᴀɪʟᴇᴅ*\n\n${error.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: tourl / imgtourl / imgurl / geturl / upload - Upload media to Catbox with copy button
// Case: tourl / imgtourl / imgurl / geturl / upload - Upload media to Catbox with copy button
case 'tourl':
case 'imgtourl':
case 'imgurl':
case 'url':
case 'upload': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const source = quoted || msg.message;
        
        if (!source) {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜᴘʟᴏᴀᴅ ᴛᴏ ᴜʀʟ*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴀᴜᴅɪᴏ, ᴏʀ ᴅᴏᴄᴜᴍᴇɴᴛ ᴛᴏ ᴜᴘʟᴏᴀᴅ ɪᴛ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: fakevCard
            });
            break;
        }

        let mediaContent = null;
        let mediaType = '';
        let mimeType = '';

        if (source.imageMessage) {
            mediaContent = source.imageMessage; mediaType = 'image'; mimeType = mediaContent.mimetype || 'image/jpeg';
        } else if (source.videoMessage) {
            mediaContent = source.videoMessage; mediaType = 'video'; mimeType = mediaContent.mimetype || 'video/mp4';
        } else if (source.audioMessage) {
            mediaContent = source.audioMessage; mediaType = 'audio'; mimeType = mediaContent.mimetype || 'audio/mpeg';
        } else if (source.documentMessage) {
            mediaContent = source.documentMessage; mediaType = 'document'; mimeType = mediaContent.mimetype || 'application/octet-stream';
        } else if (source.stickerMessage) {
            mediaContent = source.stickerMessage; mediaType = 'sticker'; mimeType = 'image/webp';
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴍᴇᴅɪᴀ*',
                quoted: fakevCard
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const uploadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *ᴜᴘʟᴏᴀᴅɪɴɢ ᴛᴏ ᴄᴀᴛʙᴏx...*',
            quoted: fakevCard
        });

        let tempPath = null;
        
        const stream = await downloadContentFromMessage(mediaContent, mediaType);
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        let ext = '';
        if (mimeType.includes('image/jpeg') || mimeType.includes('image/jpg')) ext = '.jpg';
        else if (mimeType.includes('image/png')) ext = '.png';
        else if (mimeType.includes('image/webp')) ext = '.webp';
        else if (mimeType.includes('video')) ext = '.mp4';
        else if (mimeType.includes('audio/mpeg') || mimeType.includes('audio/mp3')) ext = '.mp3';
        else if (mimeType.includes('audio/ogg')) ext = '.ogg';
        else if (mimeType.includes('audio')) ext = '.mp3';
        else if (mimeType.includes('pdf')) ext = '.pdf';
        else ext = '.bin';

        tempPath = path.join(TEMP_MEDIA_DIR, `catbox_${Date.now()}${ext}`);
        await writeFile(tempPath, buffer);

        const form = new FormData();
        form.append('fileToUpload', fs.createReadStream(tempPath), `file${ext}`);
        form.append('reqtype', 'fileupload');

        const { data: mediaUrl } = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(), timeout: 30000
        });

        try { await socket.sendMessage(sender, { delete: uploadingMsg.key }); } catch {}

        if (!mediaUrl || mediaUrl.toLowerCase().includes('error')) throw new Error('Catbox returned an error');

        const sizeStr = buffer.length < 1048576
            ? `${(buffer.length / 1024).toFixed(1)} KB`
            : `${(buffer.length / 1048576).toFixed(2)} MB`;

        const label = mimeType.includes('image') ? '🖼️ ɪᴍᴀɢᴇ'
            : mimeType.includes('video') ? '🎬 ᴠɪᴅᴇᴏ'
            : mimeType.includes('audio') ? '🎵 ᴀᴜᴅɪᴏ'
            : mimeType.includes('pdf') ? '📄 ᴅᴏᴄᴜᴍᴇɴᴛ'
            : '📁 ғɪʟᴇ';

        const caption = `☁️ *ᴜᴘʟᴏᴀᴅ ᴄᴏᴍᴘʟᴇᴛᴇ!*\n\n` +
                       `${label}\n` +
                       `📦 *sɪᴢᴇ:* ${sizeStr}\n` +
                       `🔗 *ʟɪɴᴋ:* ${mediaUrl}\n\n` +
                       `> ${botConfig.BOT_FOOTER}`;

        // Try CTA copy button, fallback to regular buttons
        try {
            const ctaMessage = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: caption },
                                footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                header: { title: '☁️ ᴜᴘʟᴏᴀᴅ sᴜᴄᴄᴇss', hasMediaAttachment: false },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: ' ᴄᴏᴘʏ ʟɪɴᴋ',
                                                copy_code: mediaUrl
                                            })
                                        },
                                        {
                                            name: 'cta_crl',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMessage.message, { messageId: ctaMessage.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: caption,
                buttons: [
                    { buttonId: `${prefix}tourl`, buttonText: { displayText: '📤 ᴜᴘʟᴏᴀᴅ ᴍᴏʀᴇ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        if (tempPath && fs.existsSync(tempPath)) try { fs.unlinkSync(tempPath); } catch {}

    } catch (err) {
        console.error('[Upload] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `⚠️ *ᴜᴘʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\n${err.message}`,
            quoted: fakevCard
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

case 'base64':
case 'encode': {
    // React to the command
    await socket.sendMessage(sender, {
        react: {
            text: "🔐",
            key: msg.key
        }
    });

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const textToEncode = args.join(' ');

    if (!textToEncode) {
        return await socket.sendMessage(sender, {
            text: '🔐 *Base64 Encoder*\n\n' +
                  'Please provide text to encode.\n' +
                  'Example: *.base64 Hello World*',
            buttons: [
                { buttonId: '.base64 Hello World', buttonText: { displayText: '🔐 Example' }, type: 1 },
                { buttonId: '.help base64', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }

    try {
        const encodedText = Buffer.from(textToEncode).toString('base64');
        
        await socket.sendMessage(sender, {
            text: `🔐 *Base64 Encoded Text*\n\n` +
                  `*Original:* ${textToEncode}\n` +
                  `*Encoded:* ${encodedText}\n\n` +
                  `> _Encoded by CaseyRhodes Tech_`,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363302677217436@newsletter',
                    newsletterName: 'CASEYRHODES TECH',
                    serverMessageId: 143
                }
            },
            buttons: [
                { buttonId: `.unbase64 ${encodedText}`, buttonText: { displayText: '🔓 Decode' }, type: 1 },
                { buttonId: '.base64', buttonText: { displayText: '🔄 New Encode' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (e) {
        console.error('[BASE64 ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ *Error encoding text!*\n\n' +
                  'Please try again with different text.',
            buttons: [
                { buttonId: '.base64', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}

case 'unbase64':
case 'decode':
case 'deb64': {
    // React to the command
    await socket.sendMessage(sender, {
        react: {
            text: "🔓",
            key: msg.key
        }
    });

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const base64Text = args.join(' ');

    if (!base64Text) {
        return await socket.sendMessage(sender, {
            text: '🔓 *Base64 Decoder*\n\n' +
                  'Please provide Base64 text to decode.\n' +
                  'Example: *.unbase64 SGVsbG8gV29ybGQ=*',
            buttons: [
                { buttonId: '.unbase64 SGVsbG8gV29ybGQ=', buttonText: { displayText: '🔓 Example' }, type: 1 },
                { buttonId: '.help unbase64', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }

    try {
        // Check if it's valid base64
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Text)) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid Base64 Format!*\n\n' +
                      'Please provide valid Base64 encoded text.',
                buttons: [
                    { buttonId: '.unbase64', buttonText: { displayText: '🔄 Try Again' }, type: 1 },
                    { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        const decodedText = Buffer.from(base64Text, 'base64').toString('utf-8');
        
        // Check if decoding was successful
        if (!decodedText || decodedText.trim() === '') {
            throw new Error('Empty result after decoding');
        }

        await socket.sendMessage(sender, {
            text: `🔓 *Base64 Decoded Text*\n\n` +
                  `*Encoded:* ${base64Text}\n` +
                  `*Decoded:* ${decodedText}\n\n` +
                  `> _Decoded by CaseyRhodes Tech_`,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363302677217436@newsletter',
                    newsletterName: 'CASEYRHODES TECH',
                    serverMessageId: 143
                }
            },
            buttons: [
                { buttonId: `.base64 ${decodedText}`, buttonText: { displayText: '🔐 Encode' }, type: 1 },
                { buttonId: '.unbase64', buttonText: { displayText: '🔄 New Decode' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (e) {
        console.error('[UNBASE64 ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ *Error decoding text!*\n\n' +
                  'Please check if the Base64 text is valid.',
            buttons: [
                { buttonId: '.unbase64', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}

// Case: bot_stats
// Case: bot_stats
case 'session': {
    try {
        const from = m.key.remoteJid;
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const activeCount = activeSockets.size;

        const captionText = `*╭──────────────⊷*
*┃* Uptime: ${hours}h ${minutes}m ${seconds}s
*┃* Memory: ${usedMemory}MB / ${totalMemory}MB
*┃* Active Users: ${activeCount}
*┃* Your Number: ${number}
*┃* Version: ${botConfig.version}
*╰──────────────⊷*`;

        // Create single message with image and newsletter context
        const statsMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'POWERED BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(from, statsMessage, { 
            quoted: m
        });
    } catch (error) {
        console.error('Bot stats error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { 
            text: '❌ Failed to retrieve stats. Please try again later.' 
        }, { quoted: m });
    }
    break;
}
// Case: bot_info
case 'info': {
    try {
        const from = m.key.remoteJid;
        const captionText = `*╭───────────────⊷*
*┃*  👤 ɴᴀᴍᴇ: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ
*┃*  🇰🇪 ᴄʀᴇᴀᴛᴏʀ: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃*  🌐 ᴠᴇʀsɪᴏɴ: ${botConfig.version}
*┃*  📍 ᴘʀᴇғɪx: ${botConfig.PREFIX}
*┃*  📖 ᴅᴇsᴄ: ʏᴏᴜʀ sᴘɪᴄʏ, ʟᴏᴠɪɴɢ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏɴ 😘
*╰──────────────⊷*`;
        
        // Create single message with image and newsletter context
        const infoMessage = {
            image: { url: "https://i.ibb.co/750pdM9/b46b44ae51c1.jpg" },
            caption: captionText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'MINI BOT BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        };
        
        await socket.sendMessage(from, infoMessage, { quoted: m });
    } catch (error) {
        console.error('Bot info error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { text: '❌ Failed to retrieve bot info.' }, { quoted: m });
    }
    break;
}
//case menu
case 'menu': {
  try {
    const from = msg?.key?.remoteJid || sender;
    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    
    let menuText = `*╭─────────────────⊷*  
*┃* *🌟ʙᴏᴛ ɴᴀᴍᴇ*: ᴄᴀsᴇʀʜᴏᴅᴇs ᴍɪɴɪ
*┃* *🌸ᴜsᴇʀ*: ɢᴜᴇsᴛ
*┃* *📍ᴘʀᴇғɪx*: .
*┃* *⏰ᴜᴘᴛɪᴍᴇ* : ${hours}h ${minutes}m ${seconds}s
*┃* *📂sᴛᴏʀᴀɢᴇ* : ${usedMemory}MB/${totalMemory}MB
*┃*  🔮 *ᴄᴏᴍᴍᴀɴᴅs*: ${count}
*┃* *🎭ᴅᴇᴠ*: ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ
*╰──────────────────⊷*
*\`Ξ ѕєlєct α cαtєgσrч вєlσw:\`*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ ッ
`;
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363408915265322@newsletter',
                 newsletterName: '*B͛L͛O͛O͛D͛ R͛A͛V͛E͛N͛ M͛I͛N͛I͛ B͛O͛T͛ 👻',
            serverMessageId: -1
        }
    };

    const menuMessage = {
      image: { url: "https://i.ibb.co/750pdM9/b46b44ae51c1.jpg" },
      caption: `*🎀 B͛L͛O͛O͛D͛ R͛A͛V͛E͛N͛ M͛I͛N͛I͛ B͛O͛T͛ 🎀*\n${menuText}`,
      buttons: [
        {
          buttonId: `${botConfig.PREFIX}quick_commands`,
          buttonText: { displayText: '🤖 C͛H͛O͛O͛SE͛ C͛A͛T͛E͛G͛O͛R͛Y͛' },
          type: 4,
          nativeFlowInfo: {
            name: 'single_select',
            paramsJson: JSON.stringify({
              title: '🌟 C͛H͛O͛O͛SE͛ C͛A͛T͛E͛G͛O͛R͛Y͛',
              sections: [
                {
                  title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                  highlight_label: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ',
                  rows: [
                    { title: "📜 ᴀʟʟᴍᴇɴᴜ", description: "get all command in list", id: `${botConfig.PREFIX}allmenu` }, 
                     { title: "🤖 CHATBOT", description: "reply with chatgpt", id: `${botConfig.PREFIX}chatbot` }, 
                    { title: "🎨 ʟᴏɢᴏ ᴍᴇɴᴜ", description: "get your own logo texts", id: `${botConfig.PREFIX}logomenu` }, 
                    { title: "🟢 ᴀʟɪᴠᴇ", description: "Check if bot is active", id: `${botConfig.PREFIX}alive` }, 
                    { title: "⚙️ sᴇᴛᴛɪɴɢs", description: "change your settings", id: `${botConfig.PREFIX}settings` },
                    { title: "♻️ᴀᴜᴛᴏʙɪᴏ", description: "set your bio on and off", id: `${botConfig.PREFIX}autobio` },
                    { title: "🪀MODE", description: "set your bot public or private", id: `${botConfig.PREFIX}mode` },    
                    { title: "🌟owner", description: "get in touch with dev", id: `${botConfig.PREFIX}owner` },
                    { title: "🎭ʜᴀᴄᴋ", description: "prank others", id: `${botConfig.PREFIX}hack` },
                    { title: "🗣️ᴄᴀʟᴄᴜʟᴀᴛᴏʀ", description: "do your own math", id: `${botConfig.PREFIX}calculator` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "View bot statistics", id: `${botConfig.PREFIX}session` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "Get bot information", id: `${botConfig.PREFIX}active` },
                    { title: "🔰sᴇᴛᴘᴘ", description: "set your own profile", id: `${botConfig.PREFIX}setpp` },
                    { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${botConfig.PREFIX}menu` },
                    { title: "📜 ϙᴜʀᴀɴ", description: "List all your quran by number", id: `${botConfig.PREFIX}quran` },
                    { title: "🔮sᴄʀᴇᴇɴsʜᴏᴏᴛ", description: "get website screenshots", id: `${botConfig.PREFIX}ss` },
                    { title: "💌ғᴇᴛᴄʜ", description: "get url content", id: `${botConfig.PREFIX}get` },  
                    { title: "🏓 ᴘɪɴɢ", description: "Check bot response speed", id: `${botConfig.PREFIX}ping` },
                    { title: "📜 ᴘᴅғ", description: "change text to pdf", id: `${botConfig.PREFIX}pdf` },
                    { title: "🔗 ᴘᴀɪʀ", description: "Generate pairing code", id: `${botConfig.PREFIX}pair` },
                    { title: "✨ ғᴀɴᴄʏ", description: "Fancy text generator", id: `${botConfig.PREFIX}fancy` },
                    { title: "🔮tts", description: "voice converter", id: `${botConfig.PREFIX}tts` },
                    { title: "🎉ɪᴍᴀɢᴇ", description: "random image generator", id: `${botConfig.PREFIX}img` },
                    { title: "🎨 ʟᴏɢᴏ", description: "Create custom logos", id: `${botConfig.PREFIX}logo` },
                    { title: "❇️ᴠᴄғ", description: "Create group contacts", id: `${botConfig.PREFIX}vcf` },
                    { title: "📦 ʀᴇᴘᴏ", description: "Bot repository info", id: `${botConfig.PREFIX}repo` },
                    { title: "📦 ɢɪᴛᴄʟᴏɴᴇ", description: "Download GitHub repos", id: `${botConfig.PREFIX}gitclone` }
                  ]
                },
                {
                  title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                  highlight_label: 'New',
                  rows: [
                    { title: "🎵 sᴏɴɢ", description: "Download music from YouTube", id: `${botConfig.PREFIX}song` }, 
                    { title: "🎀play", description: "play favourite songs", id: `${botConfig.PREFIX}play` },
                    { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "Download TikTok videos", id: `${botConfig.PREFIX}tiktok` },
                    { title: "🎵 sʜᴀᴢᴀᴍ", description: "Identify songs from audio", id: `${botConfig.PREFIX}shazam` },
                    { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "Download Facebook content", id: `${botConfig.PREFIX}fb` },
                    { title: "📸 ɪɴsᴛᴀɢʀᴀᴍ", description: "Download Instagram content", id: `${botConfig.PREFIX}ig` },
                    { title: "🖼️ ᴀɪ ɪᴍɢ", description: "Generate AI images", id: `${botConfig.PREFIX}aiimg` },
                    { title: "👀 ᴠɪᴇᴡᴏɴᴄᴇ", description: "Access view-once media", id: `${botConfig.PREFIX}viewonce` },
                    { title: "🖼️ sᴛɪᴄᴋᴇʀ", description: "Convert image/video to sticker", id: `${botConfig.PREFIX}sticker` },
                    { title: "📤 ᴛᴏᴜʀʟ", description: "Upload media to URL", id: `${botConfig.PREFIX}tourl` },
                    { title: "📁 ᴍᴇᴅɪᴀғɪʀᴇ", description: "Get MediaFire download link", id: `${botConfig.PREFIX}mf` }
                  ]
                },
                {
                  title: "🫂 ɢʀᴏᴜᴘ sᴇᴛᴛɪɴɢs",
                  highlight_label: 'Popular',
                  rows: [
                    { title: "➕ ᴀᴅᴅ", description: "Add Numbers to Group", id: `${botConfig.PREFIX}add` },
                    { title: "🦶 ᴋɪᴄᴋ", description: "Remove Number from Group", id: `${botConfig.PREFIX}kick` },
                    { title: "🔓 ᴜɴʟᴏᴄᴋ", description: "Open group", id: `${botConfig.PREFIX}unlock` },
                    { title: "🔒 ʟᴏᴄᴋ", description: "Close Group", id: `${botConfig.PREFIX}lock` },
                    { title: "👑 ᴘʀᴏᴍᴏᴛᴇ", description: "Promote Member to Admin", id: `${botConfig.PREFIX}promote` },
                    { title: "😢 ᴅᴇᴍᴏᴛᴇ", description: "Demote Member from Admin", id: `${botConfig.PREFIX}demote` },
                    { title: "👥 ᴛᴀɢᴀʟʟ", description: "Tag All Members", id: `${botConfig.PREFIX}tagall` },
                    { title: "👻 ʜɪᴅᴇᴛᴀɢ", description: "Silent tag all", id: `${botConfig.PREFIX}hidetag` },
                    { title: "👤 ᴊᴏɪɴ", description: "Join A Group", id: `${botConfig.PREFIX}join` },
                    { title: "💠 ʟᴇᴀᴠᴇ", description: "Bot leaves group", id: `${botConfig.PREFIX}leave` },
                    { title: "📊 ɢʀᴏᴜᴘ ɪɴғᴏ", description: "View group info", id: `${botConfig.PREFIX}ginfo` },
                    { title: "👥 ᴍᴇᴍʙᴇʀs", description: "List all members", id: `${botConfig.PREFIX}members` },
                    { title: "📢 ɢʀᴏᴜᴘsᴛᴀᴛᴜs", description: "Post group status", id: `${botConfig.PREFIX}togstatus` },
                    { title: "👋 ᴡᴇʟᴄᴏᴍᴇ", description: "Toggle welcome", id: `${botConfig.PREFIX}welcome` },
                    { title: "👋 ɢᴏᴏᴅʙʏᴇ", description: "Toggle goodbye", id: `${botConfig.PREFIX}goodbye` }
                  ]
                },
                {
                  title: "📰 ɴᴇᴡs & ɪɴғᴏ",
                  rows: [
                    { title: "📰 ɴᴇᴡs", description: "Get latest news", id: `${botConfig.PREFIX}news` },
                    { title: "🚀 ɴᴀsᴀ", description: "NASA updates", id: `${botConfig.PREFIX}nasa` },
                    { title: "🌍 ᴄᴏᴜɴᴛʀʏ", description: "Country details", id: `${botConfig.PREFIX}country` },
                    { title: "🕐 ᴛɪᴍᴇ", description: "Check world time", id: `${botConfig.PREFIX}time` },
                    { title: "🌍 ᴛʀᴀɴsʟᴀᴛᴇ", description: "Translate text", id: `${botConfig.PREFIX}translate` }
                  ]
                },
                {
                  title: "🖤 ғᴜɴ",
                  rows: [
                    { title: "😂 ᴊᴏᴋᴇ", description: "Random joke", id: `${botConfig.PREFIX}joke` },
                    { title: "😂 ᴍᴇᴍᴇ", description: "Random meme", id: `${botConfig.PREFIX}meme` },
                    { title: "🐈 ᴄᴀᴛ", description: "Cute cat pic", id: `${botConfig.PREFIX}cat` },
                    { title: "💡 ғᴀᴄᴛ", description: "Random fact", id: `${botConfig.PREFIX}fact` },
                    { title: "🎨 ᴇᴍᴏᴊɪ ᴍɪx", description: "Mix emojis", id: `${botConfig.PREFIX}emojimix` }
                  ]
                },
                {
                  title: "🔧 ᴛᴏᴏʟs",
                  rows: [
                    { title: "🤖 ᴀɪ", description: "Chat with AI", id: `${botConfig.PREFIX}ai` },
                    { title: "🎵 ʟʏʀɪᴄs", description: "Get song lyrics", id: `${botConfig.PREFIX}lyrics` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "Weather forecast", id: `${botConfig.PREFIX}weather` },
                    { title: "📖 ᴀᴜᴛᴏʀᴇᴀᴅ", description: "Auto-read PM", id: `${botConfig.PREFIX}autoread` },
                    { title: "👁️ ʙʟᴜᴇᴛɪᴄᴋ", description: "Toggle read receipts", id: `${botConfig.PREFIX}bluetick` },
                    { title: "🛡️ ᴀɴᴛɪᴄᴀʟʟ", description: "Block calls", id: `${botConfig.PREFIX}anticall` }
                  ]
                }
              ]
            })
          }
        }
      ],
      headerType: 1,
      contextInfo: messageContext
    };
    
    // IMPORTANT: Keep the entire menu in ONE WhatsApp message.
    // The image, category selector, JOIN CHANNEL button, newsletter context,
    // and fakevCard quote are all sent together below. Do not call sendMessage
    // again for the channel button or category menu.
    const menuMedia = await prepareWAMessageMedia(
      { image: { url: 'https://i.ibb.co/750pdM9/b46b44ae51c1.jpg' } },
      { upload: socket.waUploadToServer }
    );
    const menuInteractive = generateWAMessageFromContent(from, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: '🎀 B͛L͛O͛O͛D͛ R͛A͛V͛E͛N͛ M͛I͛N͛I͛ B͛O͛T͛ 🎀',
              hasMediaAttachment: true,
              imageMessage: menuMedia.imageMessage
            },
            body: { text: menuText },
            footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ ッ' },
            nativeFlowMessage: {
              buttons: [
                {
                  name: 'single_select',
                  buttonParamsJson: JSON.stringify({
                    title: '🤖 C͛H͛O͛O͛SE͛ C͛A͛T͛E͛G͛O͛R͛Y͛',
                    sections: JSON.parse(menuMessage.buttons[0].nativeFlowInfo.paramsJson).sections
                  })
                },
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({
                    display_text: '📢 JOIN CHANNEL',
                    url: botConfig.CHANNEL_LINK,
                    merchant_url: botConfig.CHANNEL_LINK
                  })
                }
              ]
            },
            contextInfo: messageContext
          }
        }
      }
    }, { quoted: fakevCard });

    // Keep the menu as ONE native WhatsApp message and preserve its image header.
    // The gifted relay is bypassed only for this message because its conversion
    // path can drop the prepared imageMessage.
    socket.__bypassGiftedRelay = true;
    try {
      await socket.relayMessage(from, menuInteractive.message, { messageId: menuInteractive.key.id });
    } finally {
      socket.__bypassGiftedRelay = false;
    }
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    
  } catch (error) {
    console.error('Menu command error:', error);
    await socket.sendMessage(from, {
      image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
      caption: `*⚡ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ*\n\n${botConfig.PREFIX}allmenu ᴛᴏ ᴠɪᴇᴡ ᴀʟʟ ᴄᴍᴅs\n\n> ${botConfig.BOT_FOOTER}`
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}

// Case: fact / facts / funfact - Get a random interesting fact
case 'fact':
case 'facts':
case 'funfact': {
    try {
        await socket.sendMessage(sender, { react: { text: '💡', key: msg.key } });

        let fact;
        
        try {
            const res = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', {
                params: { language: 'en' },
                timeout: 8000
            });
            fact = res.data?.text;
            if (!fact) throw new Error('empty');
        } catch {
            // Fallback facts if API fails
            const fallbacks = [
                "ʜᴏɴᴇʏ ɴᴇᴠᴇʀ sᴘᴏɪʟs — ᴇᴅɪʙʟᴇ ʜᴏɴᴇʏ ʜᴀs ʙᴇᴇɴ ғᴏᴜɴᴅ ɪɴ 3,000-ʏᴇᴀʀ-ᴏʟᴅ ᴇɢʏᴘᴛɪᴀɴ ᴛᴏᴍʙs.",
                "ᴀ ɢʀᴏᴜᴘ ᴏғ ғʟᴀᴍɪɴɢᴏs ɪs ᴄᴀʟʟᴇᴅ ᴀ 'ғʟᴀᴍʙᴏʏᴀɴᴄᴇ'.",
                "ʙᴀɴᴀɴᴀs ᴀʀᴇ ᴄᴜʀᴠᴇᴅ ʙᴇᴄᴀᴜsᴇ ᴛʜᴇʏ ɢʀᴏᴡ ᴛᴏᴡᴀʀᴅs ᴛʜᴇ sᴜɴ.",
                "ᴛʜᴇ ᴇɪғғᴇʟ ᴛᴏᴡᴇʀ ᴄᴀɴ ʙᴇ 15 ᴄᴍ ᴛᴀʟʟᴇʀ ɪɴ sᴜᴍᴍᴇʀ ᴅᴜᴇ ᴛᴏ ᴍᴇᴛᴀʟ ᴇxᴘᴀɴsɪᴏɴ.",
                "ᴏᴄᴛᴏᴘᴜsᴇs ʜᴀᴠᴇ ᴛʜʀᴇᴇ ʜᴇᴀʀᴛs ᴀɴᴅ ʙʟᴜᴇ ʙʟᴏᴏᴅ.",
                "sʜᴀʀᴋs ᴀʀᴇ ᴏʟᴅᴇʀ ᴛʜᴀɴ ᴛʀᴇᴇs — ᴛʜᴇʏ'ᴠᴇ ᴇxɪsᴛᴇᴅ ғᴏʀ ᴏᴠᴇʀ 400 ᴍɪʟʟɪᴏɴ ʏᴇᴀʀs.",
                "ᴀ ᴅᴀʏ ᴏɴ ᴠᴇɴᴜs ɪs ʟᴏɴɢᴇʀ ᴛʜᴀɴ ᴀ ʏᴇᴀʀ ᴏɴ ᴠᴇɴᴜs.",
                "ᴡᴏᴍʙᴀᴛ ᴘᴏᴏᴘ ɪs ᴄᴜʙᴇ-sʜᴀᴘᴇᴅ."
            ];
            fact = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        await socket.sendMessage(sender, {
            text: `💡 *ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ*\n\n${fact}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}fact`, buttonText: { displayText: '💡 ᴀɴᴏᴛʜᴇʀ ғᴀᴄᴛ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Fact] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀᴄᴛ ғᴇᴛᴄʜ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: save / nitumie / statussave - Save a WhatsApp status
case 'save':
case 'nitumie':
case 'statussave': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quoted) {
            await socket.sendMessage(sender, {
                text: `📌 *sᴀᴠᴇ sᴛᴀᴛᴜs*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀ sᴛᴀᴛᴜs ɪᴍᴀɢᴇ ᴏʀ ᴠɪᴅᴇᴏ ᴡɪᴛʜ \`${prefix}save\` ᴛᴏ sᴀᴠᴇ ɪᴛ.\n\n*ᴜsᴀɢᴇ:* ʀᴇᴘʟʏ ᴛᴏ sᴛᴀᴛᴜs + \`${prefix}save\``,
                quoted: msg
            });
            break;
        }

        const isImage = !!quoted.imageMessage;
        const isVideo = !!quoted.videoMessage;

        if (!isImage && !isVideo) {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴍᴇᴅɪᴀ*\n\nᴏɴʟʏ *ɪᴍᴀɢᴇ* ᴀɴᴅ *ᴠɪᴅᴇᴏ* sᴛᴀᴛᴜsᴇs ᴄᴀɴ ʙᴇ sᴀᴠᴇᴅ.`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });

        const mediaType = isImage ? 'image' : 'video';
        const msgContent = isImage ? quoted.imageMessage : quoted.videoMessage;

        // Download media
        const stream = await downloadContentFromMessage(msgContent, mediaType);
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const caption = msgContent.caption || `📥 *sᴛᴀᴛᴜs sᴀᴠᴇᴅ ʙʏ ${botConfig.OWNER_NAME}*`;

        // Send the saved status back
        await socket.sendMessage(sender, {
            [mediaType]: buffer,
            caption: `${caption}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}save`, buttonText: { displayText: '💾 sᴀᴠᴇ ᴍᴏʀᴇ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1,
            contextInfo: {
                externalAdReply: {
                    title: 'sᴛᴀᴛᴜs sᴀᴠᴇᴅ ✅',
                    body: `${botConfig.OWNER_NAME} · sᴛᴀᴛᴜs ᴅᴏᴡɴʟᴏᴀᴅᴇʀ`,
                    thumbnailUrl: botConfig.RCD_IMAGE_PATH,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[StatusSave] Error:', err.message);
        
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ sᴀᴠᴇ sᴛᴀᴛᴜs*\n\n${err.message}`,
            buttons: [
                { buttonId: `${prefix}save`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}


case 'allmenu': {
  try {
    await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    

    let allMenuText = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*
*╭───────────────⊷*
*┃*  🤖 *ʙᴏᴛ*: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *ᴘʀᴇғɪx*: ${botConfig.PREFIX}
*┃*  ⏰ *ᴜᴘᴛɪᴍᴇ*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *ᴍᴇᴍᴏʀʏ*: ${usedMemory}MB/${totalMemory}MB
*┃*  🔮 *ᴄᴏᴍᴍᴀɴᴅs*: ${count}
*┃*  🇰🇪 *ᴏᴡɴᴇʀ*: ${botConfig.OWNER_NAME}
*╰────────────────⊷*

 ╭─『 🌐 *ɢᴇɴᴇʀᴀʟ* 』─╮
*┃*  🟢 ${prefix}alive
*┃*  🏓 ${prefix}ping
*┃*  📋 ${prefix}menu
*┃*  📜 ${prefix}allmenu
*┃*  📊 ${prefix}ginfo
*┃*  👥 ${prefix}members
*┃*  🛡️ ${prefix}admins
*┃*  🟢 ${prefix}online
*┃*  🌟 ${prefix}profile
*┃*  📸 ${prefix}igstalk
*┃*  🔮 ${prefix}repo
*┃*  🔮 ${prefix}github
*┃*  🎀 ${prefix}gitclone
*┃*  👑 ${prefix}owner
*┃*  🔗 ${prefix}pair
*┃*  🔗 ${prefix}connect
*┃*  🌍 ${prefix}country
*┃*  🕐 ${prefix}time
*┃*  🌍 ${prefix}translate
*┃*  🔮 ${prefix}horo
*┃*  🎨 ${prefix}emojimix
*┃*  🎨 ${prefix}ascii
*┃*  🧮 ${prefix}calc
*┃*  🧮 ${prefix}math
*┃*  💡 ${prefix}fact
*┃*  💐 ${prefix}comp
*┃*  📜 ${prefix}quran
*┃*  💠 ${prefix}bible
*┃*  ✨ ${prefix}fancy
*┃*  🔮 ${prefix}ss
*┃*  📱 ${prefix}qr
*┃*  🖼️ ${prefix}wallpaper
*┃*  📰 ${prefix}news
*┃*  🚀 ${prefix}nasa
*┃*  📧 ${prefix}tempmail
*┃*  📦 ${prefix}npm
*┃*  ⚗️ ${prefix}element
*┃*  📝 ${prefix}gjid
*┃*  📡 ${prefix}newsletter
*┃*  📍 ${prefix}jid
*╰──────────────⊷*

 ╭─『 🎨 *ʟᴏɢᴏ ᴄᴏᴍᴍᴀɴᴅs* 』─╮
*┃*  🎨 ${prefix}logo
*┃*  🐉 ${prefix}dragonball
*┃*  🌀 ${prefix}naruto
*┃*  ⚔️ ${prefix}arena
*┃*  💻 ${prefix}hacker
*┃*  ⚙️ ${prefix}mechanical
*┃*  💡 ${prefix}incandescent
*┃*  🏆 ${prefix}gold
*┃*  🏖️ ${prefix}sand
*┃*  🌅 ${prefix}sunset
*┃*  💧 ${prefix}water
*┃*  🌧️ ${prefix}rain
*┃*  🍫 ${prefix}chocolate
*┃*  🎨 ${prefix}graffiti
*┃*  💥 ${prefix}boom
*┃*  🟣 ${prefix}purple
*┃*  👕 ${prefix}cloth
*┃*  🎬 ${prefix}1917
*┃*  👶 ${prefix}child
*┃*  🐱 ${prefix}cat
*┃*  📝 ${prefix}typo
*┃*  🎨 ${prefix}logomenu
*╰──────────────⊷*

 ╭─『 🎭 *ᴀɴɪᴍᴇ ʟᴏɢᴏs* 』─╮
*┃*  😎 ${prefix}garl
*┃*  😎 ${prefix}loli
*┃*  😎 ${prefix}imgloli
*┃*  💫 ${prefix}waifu
*┃*  💫 ${prefix}imgwaifu
*┃*  💫 ${prefix}neko
*┃*  💫 ${prefix}imgneko
*┃*  💕 ${prefix}megumin
*┃*  💕 ${prefix}imgmegumin
*┃*  💫 ${prefix}maid
*┃*  💫 ${prefix}imgmaid
*┃*  😎 ${prefix}awoo
*┃*  😎 ${prefix}imgawoo
*┃*  🧚🏻 ${prefix}animegirl
*┃*  ⛱️ ${prefix}anime
*┃*  🧚‍♀️ ${prefix}anime1
*┃*  🧚‍♀️ ${prefix}anime2
*┃*  🧚‍♀️ ${prefix}anime3
*┃*  🧚‍♀️ ${prefix}anime4
*┃*  🧚‍♀️ ${prefix}anime5
*╰──────────────⊷*

 ╭─『 🎵 *ᴅᴏᴡɴʟᴏᴀᴅs* 』─╮
*┃*  🎵 ${prefix}song
*┃*  🎵 ${prefix}ytmp3
*┃*  🎊 ${prefix}play
*┃*  🎬 ${prefix}ytmp4
*┃*  📱 ${prefix}tiktok
*┃*  📱 ${prefix}tt
*┃*  📘 ${prefix}fb
*┃*  📘 ${prefix}fbdl
*┃*  📸 ${prefix}ig
*┃*  🎵 ${prefix}shazam
*┃*  🎵 ${prefix}lyrics
*┃*  📤 ${prefix}tourl
*┃*  📁 ${prefix}mf
*┃*  📁 ${prefix}mediafire
*┃*  📦 ${prefix}apk
*┃*  🖼️ ${prefix}aiimg
*┃*  👀 ${prefix}viewonce
*┃*  👀 ${prefix}vv
*┃*  🖼️ ${prefix}sticker
*┃*  🎨 ${prefix}attp
*┃*  🔍 ${prefix}stickersearch
*┃*  🗣️ ${prefix}tts
*┃*  📦 ${prefix}gitclone
*╰──────────────⊷*

 ╭─『 🫂 *ɢʀᴏᴜᴘ* 』─╮
*┃*  ➕ ${prefix}add
*┃*  🦶 ${prefix}kick
*┃*  🦶 ${prefix}kickall
*┃*  🔓 ${prefix}unlock
*┃*  🔒 ${prefix}lock
*┃*  👑 ${prefix}promote
*┃*  😢 ${prefix}demote
*┃*  🔗 ${prefix}link
*┃*  🔗 ${prefix}invite
*┃*  🔄 ${prefix}revoke
*┃*  📝 ${prefix}rename
*┃*  📝 ${prefix}gname
*┃*  📝 ${prefix}desc
*┃*  📝 ${prefix}gdesc
*┃*  👥 ${prefix}tagall
*┃*  👻 ${prefix}hidetag
*┃*  🎌 ${prefix}tagadmins
*┃*  👤 ${prefix}join
*┃*  💠 ${prefix}leave
*┃*  🖼️ ${prefix}setgpp
*┃*  🖼️ ${prefix}gpp
*┃*  🖼️ ${prefix}fullgpp
*┃*  🆕 ${prefix}create
*┃*  🆕 ${prefix}newgc
*┃*  📊 ${prefix}poll
*┃*  📢 ${prefix}togstatus
*┃*  👋 ${prefix}welcome
*┃*  👋 ${prefix}goodbye
*┃*  👋 ${prefix}setwelcome
*┃*  👋 ${prefix}setgoodbye
*┃*  📇 ${prefix}vcfgen
*┃*  📇 ${prefix}vcfgroup
*┃*  📇 ${prefix}vcfnumber
*┃*  📇 ${prefix}vcfread
*┃*  📇 ${prefix}vcard
*┃*  📋 ${prefix}auditlog
*┃*  📋 ${prefix}req
*┃*  📋 ${prefix}listrequests
*┃*  ✅ ${prefix}accept
*┃*  ✅ ${prefix}approve
*┃*  ❌ ${prefix}reject
*┃*  ⏳ ${prefix}disapp
*┃*  🗑️ ${prefix}del
*┃*  ⚙️ ${prefix}groupsettings
*┃*  📢 ${prefix}everyone
*┃*  🖼️ ${prefix}gcpp
*┃*  🔍 ${prefix}onwa
*┃*  📍 ${prefix}location
*╰──────────────⊷*

 ╭─『 ⚽ *sᴘᴏʀᴛs* 』─╮
*┃*  ⚽ ${prefix}livescore
*┃*  🏆 ${prefix}sportnews
*┃*  🏆 ${prefix}standings
*┃*  ⚽ ${prefix}topscorers
*┃*  📅 ${prefix}upcomingmatches
*┃*  📋 ${prefix}gamehistory
*╰──────────────⊷*

 ╭─『 😂 *ғᴜɴ* 』─╮
*┃*  😂 ${prefix}joke
*┃*  🌚 ${prefix}darkjoke
*┃*  😂 ${prefix}meme
*┃*  💫 ${prefix}waifu
*┃*  🐈 ${prefix}cat
*┃*  🐕 ${prefix}dog
*┃*  💡 ${prefix}fact
*┃*  💘 ${prefix}pickupline
*┃*  🔥 ${prefix}roast
*┃*  ❤️ ${prefix}lovequote
*┃*  💭 ${prefix}quote
*┃*  💐 ${prefix}comp
*┃*  🎨 ${prefix}emojimix
*┃*  🎨 ${prefix}ascii
*┃*  💻 ${prefix}hack
*╰──────────────⊷*

 ╭─『 ⚙️ *ᴏᴡɴᴇʀ* 』─╮
*┃*  ⚙️ ${prefix}settings
*┃*  🔰 ${prefix}ad
*┃*  🛡️ ${prefix}anticall
*┃*  📖 ${prefix}autoread
*┃*  👁️ ${prefix}bluetick
*┃*  🪀 ${prefix}mode
*┃*  ⚡ ${prefix}eval
*┃*  📢 ${prefix}poststatus
*┃*  📢 ${prefix}broadcast
*┃*  📢 ${prefix}bc
*┃*  👁️ ${prefix}presence
*┃*  👁️ ${prefix}typing
*┃*  🔰 ${prefix}setpp
*┃*  🖼️ ${prefix}fullpp
*┃*  🖼️ ${prefix}removedp
*┃*  📌 ${prefix}pin
*┃*  📌 ${prefix}unpin
*┃*  📁 ${prefix}archive
*┃*  💀 ${prefix}killgc
*┃*  🔄 ${prefix}restart
*╰──────────────⊷*

 ╭─『 🔒 *ᴘʀɪᴠᴀᴄʏ* 』─╮
*┃*  🔒 ${prefix}privacy
*┃*  🖼️ ${prefix}mydp
*┃*  📝 ${prefix}mystatus
*┃*  👥 ${prefix}groupadd
*┃*  👁️ ${prefix}lastseen
*┃*  🟢 ${prefix}myonline
*╰──────────────⊷*

 ╭─『 🔧 *ᴛᴏᴏʟs* 』─╮
*┃*  🤖 ${prefix}ai
*┃*  🤖 ${prefix}chatbot
*┃*  📊 ${prefix}winfo
*┃*  🔍 ${prefix}whois
*┃*  🔥 ${prefix}element
*┃*  🌦️ ${prefix}weather
*┃*  🔗 ${prefix}shorturl
*┃*  💾 ${prefix}savestatus
*┃*  💾 ${prefix}save
*┃*  🖼️ ${prefix}getpp
*┃*  🚫 ${prefix}block
*┃*  ✅ ${prefix}unblock
*┃*  🚫 ${prefix}blocklist
*┃*  🔮 ${prefix}github
*┃*  📲 ${prefix}fc
*┃*  📝 ${prefix}setbio
*┃*  📜 ${prefix}pdf
*┃*  📱 ${prefix}send
*┃*  📇 ${prefix}vcf
*┃*  📇 ${prefix}vcard
*┃*  ⭐ ${prefix}star
*┃*  ⭐ ${prefix}unstar
*┃*  🏢 ${prefix}bizprofile
*┃*  👤 ${prefix}myprofile
*╰──────────────⊷*

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ* ッ
`;

    const buttons = [
      {buttonId: `${prefix}alive`, buttonText: {displayText: 'Alive'}, type: 1},
      {buttonId: `${prefix}menu`, buttonText: {displayText: 'Menu'}, type: 1}
    ];

    const buttonMessage = {
      image: { url:"https://i.ibb.co/750pdM9/b46b44ae51c1.jpg" },
      caption: allMenuText,
      footer: "Click buttons for quick actions",
      buttons: buttons,
      headerType: 4
    };

    await socket.sendMessage(from, buttonMessage, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Allmenu command error:', error);
    await socket.sendMessage(from, {
      text: `❌ *Oh, darling, the menu got shy! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
//============ USER COMMANDS ============

// Case: block - Block a user (owner only)
case 'block': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg }); break; }
        
        let targetJid;
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length) {
            targetJid = mentioned[0];
        } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            targetJid = msg.message.extendedTextMessage.contextInfo.participant;
        } else if (args[0]) {
            const num = args[0].replace(/[^0-9]/g, '');
            targetJid = `${num}@s.whatsapp.net`;
        } else {
            await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}block @user\` ᴏʀ \`${prefix}block 2547xxxx\``, quoted: msg });
            break;
        }
        
        await socket.sendMessage(sender, { react: { text: '🚫', key: msg.key } });
        await socket.updateBlockStatus(targetJid, 'block');
        await socket.sendMessage(sender, { text: `🚫 *ʙʟᴏᴄᴋᴇᴅ*\n\n@${targetJid.split('@')[0]}\n\n> ${botConfig.BOT_FOOTER}`, mentions: [targetJid], quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}


// Case: setbio - Set WhatsApp bio (owner only)
case 'setbio': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg }); break; }
        
        const bio = args.join(' ').trim();
        if (!bio) { await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}setbio <text>\``, quoted: msg }); break; }
        
        await socket.sendMessage(sender, { react: { text: '📝', key: msg.key } });
        await socket.query({
            tag: 'iq', attrs: { to: S_WHATSAPP_NET, type: 'set', xmlns: 'status' },
            content: [{ tag: 'status', attrs: {}, content: Buffer.from(bio, 'utf-8') }]
        });
        await socket.sendMessage(sender, { text: `✅ *ʙɪᴏ sᴇᴛ!*\n\n${bio}\n\n> ${botConfig.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}


// Case: whois - User info
case 'whois': {
    try {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetJid = mentioned[0] || msg.message?.extendedTextMessage?.contextInfo?.participant || nowsender;
        const number = targetJid.split('@')[0];
        
        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
        
        let pp; try { pp = await socket.profilePictureUrl(targetJid, 'image'); } catch { pp = botConfig.RCD_IMAGE_PATH; }
        let about = 'No status';
        try { const s = await socket.fetchStatus(targetJid); if (s?.status) about = s.status; } catch {}
        
        await socket.sendMessage(sender, {
            image: { url: pp },
            caption: `👤 *ᴡʜᴏɪs*\n\n📞 *ɴᴜᴍʙᴇʀ:* +${number}\n💬 *sᴛᴀᴛᴜs:* ${about}\n🌐 *ᴊɪᴅ:* ${targetJid}\n\n> ${botConfig.BOT_FOOTER}`,
            mentions: [targetJid],
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: mygroups - List all groups (owner only)
case 'mygroups': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg }); break; }
        
        await socket.sendMessage(sender, { react: { text: '📋', key: msg.key } });
        const groups = Object.values(await socket.groupFetchAllParticipating());
        if (!groups.length) { await socket.sendMessage(sender, { text: '❌ *ɴᴏ ɢʀᴏᴜᴘs*', quoted: msg }); break; }
        
        const text = groups.map((g, i) => `${i + 1}. ${g.subject} (${g.participants.length} members)`).join('\n');
        await socket.sendMessage(sender, { text: `📋 *ᴍʏ ɢʀᴏᴜᴘs (${groups.length})*\n\n${text}\n\n> ${botConfig.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}


case 'creact': {
    const q = args.join(" ").trim();

    if (!q.includes(",")) {
        return await socket.sendMessage(sender, {
            text:
                '😒 Please provide the channel link and emoji separated by a comma.\n\n' +
                'Example:\n' +
                '.creact https://whatsapp.com/channel/120363396379901844/123,🔥'
        });
    }

    try {
        const commaIndex = q.indexOf(",");

        let link = q.slice(0, commaIndex).trim();
        let emoji = q.slice(commaIndex + 1).trim();

        if (!link || !emoji) {
            return await socket.sendMessage(sender, {
                text: '❌ Please provide both the channel link and emoji.'
            });
        }

        link = link.replace(/\/+$/, "");

        const match = link.match(
            /^https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([^/?#]+)\/([^/?#]+)$/i
        );

        if (!match) {
            return await socket.sendMessage(sender, {
                text:
                    '❌ Invalid WhatsApp Channel link.\n\n' +
                    'Use:\n' +
                    'https://whatsapp.com/channel/CHANNEL_ID/MESSAGE_ID'
            });
        }

        const channelId = match[1];
        const messageId = match[2];
        const channelJid = `${channelId}@newsletter`;

        if (typeof socket.newsletterReactMessage !== "function") {
            throw new Error(
                "newsletterReactMessage() is not available in your Baileys version."
            );
        }

        // Number of reaction attempts
        const TOTAL_REACTIONS = 200;

        // Delay between attempts (milliseconds)
        const DELAY_MS = 1500;

        let successful = 0;
        let failed = 0;

        await socket.sendMessage(sender, {
            text:
                `🚀 *Starting Channel reactions...*\n\n` +
                `📢 Channel: ${channelId}\n` +
                `🆔 Message: ${messageId}\n` +
                `❤️ Emoji: ${emoji}\n` +
                `🔢 Attempts: ${TOTAL_REACTIONS}\n\n` +
                `⏳ Please wait...`,
            quoted: fakevCard
        });

        for (let i = 1; i <= TOTAL_REACTIONS; i++) {
            try {
                await socket.newsletterReactMessage(
                    channelJid,
                    messageId,
                    emoji
                );

                successful++;

                console.log(
                    `[CREACT] ${i}/${TOTAL_REACTIONS} ✅ ${emoji}`
                );

            } catch (err) {
                failed++;

                console.error(
                    `[CREACT] ${i}/${TOTAL_REACTIONS} ❌`,
                    err?.message || err
                );
            }

            // Prevent sending all requests at once
            if (i < TOTAL_REACTIONS) {
                await new Promise(resolve =>
                    setTimeout(resolve, DELAY_MS)
                );
            }
        }

        await socket.sendMessage(sender, {
            text:
                `✅ *CREACT FINISHED*\n\n` +
                `📢 Channel: ${channelId}\n` +
                `🆔 Message: ${messageId}\n` +
                `❤️ Emoji: ${emoji}\n\n` +
                `📤 Attempts: ${TOTAL_REACTIONS}\n` +
                `✅ Successful: ${successful}\n` +
                `❌ Failed: ${failed}`,
            quoted: fakevCard
        });

        console.log(
            `[CREACT] Finished: ${successful}/${TOTAL_REACTIONS} successful`
        );

    } catch (e) {
        console.error("❌ [CREACT] Error:", e);

        await socket.sendMessage(sender, {
            text:
                `❌ *CREACT ERROR*\n\n` +
                `📛 ${e?.message || e}\n\n` +
                `Make sure the Channel link is valid and your Baileys version supports newsletter reactions.`,
            quoted: fakevCard
        });
    }

    break;
}
		
// Case: fc (follow channel)
// Case: follow - Open WhatsApp channel link
case 'follow': {
  if (args.length === 0) {
    return await socket.sendMessage(sender, {
      text: '❗ Please provide a WhatsApp channel username or link.\n\nExample:\n.follow caseyrhodestech\nor\n.follow https://whatsapp.com/channel/...'
    });
  }

  const input = args[0];
  let channelLink = input;
  
  // If username only, construct the WhatsApp channel link
  if (!input.startsWith('http')) {
    channelLink = `https://whatsapp.com/channel/${input}`;
  }

  try {
    await socket.sendMessage(sender, { react: { text: '📢', key: msg.key } });
    
    const followText = `📢 *WhatsApp Channel*\n\n🔗 Link: ${channelLink}\n\n> Click the button below to open the channel!`;
    
    const ctaMsg = generateWAMessageFromContent(
      sender,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: { text: followText },
              footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
              nativeFlowMessage: {
                buttons: [
                  {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                      display_text: '📢 Open Channel',
                      url: channelLink
                    })
                  }
                ]
              }
            }
          }
        }
      },
      { quoted: fakevCard }
    );
    
    await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
    
    console.log(`SENT CHANNEL LINK: ${channelLink}`);
    
  } catch (e) {
    console.error('❌ Error in follow command:', e.message);
    await socket.sendMessage(sender, {
      text: `❌ Error: ${e.message}`
    });
  }
  break;
}
// Case: poll / vote - Create a WhatsApp native poll
case 'poll':
case 'vote': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴄᴀɴ ᴄʀᴇᴀᴛᴇ ᴘᴏʟʟs.',
                quoted: msg
            });
            break;
        }

        const input = args.join(' ').trim();
        
        if (!input) {
            await socket.sendMessage(sender, {
                text: `📊 *ᴄʀᴇᴀᴛᴇ ᴘᴏʟʟ*\n\n*ᴜsᴀɢᴇ:*\n\`${prefix}poll Question | Option1 | Option2 | ...\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}poll Favourite color? | Red | Blue | Green\`\n\`${prefix}poll Best food? | Pizza | Burger | Sushi | Pasta\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}poll Best food? | Pizza | Burger | Sushi`, buttonText: { displayText: '🍕 ғᴏᴏᴅ ᴘᴏʟʟ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        const parts = input.split('|').map(s => s.trim()).filter(Boolean);
        
        if (parts.length < 3) {
            await socket.sendMessage(sender, {
                text: `❌ *ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ*\n\nʏᴏᴜ ɴᴇᴇᴅ ᴀ ϙᴜᴇsᴛɪᴏɴ ᴀɴᴅ ᴀᴛ ʟᴇᴀsᴛ *2 ᴏᴘᴛɪᴏɴs*.\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}poll Best fruit? | Apple | Mango | Banana\``,
                quoted: msg
            });
            break;
        }

        const [question, ...options] = parts;
        
        if (options.length > 12) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴛᴏᴏ ᴍᴀɴʏ ᴏᴘᴛɪᴏɴs*\n\nᴍᴀxɪᴍᴜᴍ *12 ᴏᴘᴛɪᴏɴs* ᴀʟʟᴏᴡᴇᴅ.',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📊', key: msg.key } });

        // Send the poll
        await socket.sendMessage(from, {
            poll: {
                name: question,
                values: options,
                selectableCount: 1
            }
        });

        await socket.sendMessage(sender, {
            text: `✅ *ᴘᴏʟʟ ᴄʀᴇᴀᴛᴇᴅ!*\n\n📊 *ϙᴜᴇsᴛɪᴏɴ:* ${question}\n📋 *ᴏᴘᴛɪᴏɴs:* ${options.length}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Poll] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴘᴏʟʟ ᴄʀᴇᴀᴛɪᴏɴ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: ping
// Case: ping - Check bot response time and uptime with channel CTA
case 'ping': {
    try {
        await socket.sendMessage(sender, { react: { text: '🏓', key: msg.key } });

        const start = performance.now();
        
        const responseTime = (performance.now() - start).toFixed(2);

        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const platform = os.platform();
        const nodeVersion = process.version;

        const pingText = 
            `🏓 *ᴘᴏɴɢ!*\n\n` +
            `⏱ *ʀᴇsᴘᴏɴsᴇ:* ${responseTime} ᴍs\n` +
            `⏳ *ᴜᴘᴛɪᴍᴇ:* ${hours}ʜ ${minutes}ᴍ ${seconds}s\n` +
            `💾 *ʀᴀᴍ:* ${usedMemory}ᴍʙ / ${totalMemory}ᴍʙ\n` +
            `🖥 *ᴘʟᴀᴛғᴏʀᴍ:* ${platform}\n` +
            `📦 *ɴᴏᴅᴇ:* ${nodeVersion}\n\n` +
            `> ${botConfig.BOT_FOOTER}`;

        // Send CTA buttons (no fallback)
        const ctaMsg = generateWAMessageFromContent(
            sender,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: pingText },
                            footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: {
                                buttons: [
                                    {
                                        name: 'cta_url',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '👑 Join YouTube',
                                            url: 'https://youtube.com/@caseyrhodestech'
                                        })
                                    },
                                    {
                                        name: 'cta_url',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '🍴 fork Repository',
                                            url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                                        })
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            { quoted: fakevCard }
        );
        await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Ping] Error:', error.message);
        const start = performance.now();
        await socket.sendMessage(sender, {
            text: `🏓 *ᴘᴏɴɢ!*\n\n⏱ *ʀᴇsᴘᴏɴsᴇ:* ${(performance.now() - start).toFixed(2)} ᴍs\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: igstalk / instastalk / iginfo / instagramstalk - Instagram profile stalker
case 'igstalk':
case 'instastalk':
case 'iginfo':
case 'instagramstalk': {
    try {
        let username = args[0]?.replace(/^@/, '').trim();
        
        if (!username) {
            await socket.sendMessage(sender, {
                text: `📸 *ɪɴsᴛᴀɢʀᴀᴍ sᴛᴀʟᴋᴇʀ*\n\nɢᴇᴛ ᴅᴇᴛᴀɪʟᴇᴅ ɪɴsᴛᴀɢʀᴀᴍ ᴘʀᴏғɪʟᴇ ɪɴғᴏ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}igstalk <username>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}igstalk cristiano\`\n• \`${prefix}igstalk leomessi\`\n• \`${prefix}igstalk therock\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}igstalk cristiano`, buttonText: { displayText: '👤 ᴄʀɪsᴛɪᴀɴᴏ' }, type: 1 },
                    { buttonId: `${prefix}igstalk leomessi`, buttonText: { displayText: '👤 ᴍᴇssɪ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📸', key: msg.key } });

        // Send fetching message
        const fetchingMsg = await socket.sendMessage(sender, {
            text: `⏳ *ғᴇᴛᴄʜɪɴɢ ɪɴsᴛᴀɢʀᴀᴍ ᴘʀᴏғɪʟᴇ...*\n\n@${username}`,
            quoted: msg
        });

        // Fetch Instagram profile
        const { data } = await axios.get(
            `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
            {
                timeout: 12000,
                headers: {
                    'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 458229258)',
                    'Accept': 'application/json',
                    'x-ig-app-id': '936619743392459',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }
        );

        const u = data?.data?.user;
        if (!u) throw new Error('No user data');

        // Delete fetching message
        try { await socket.sendMessage(sender, { delete: fetchingMsg.key }); } catch {}

        const followers = u.edge_followed_by?.count ?? 0;
        const following = u.edge_follow?.count ?? 0;
        const posts = u.edge_owner_to_timeline_media?.count ?? 0;

        function fmtNum(n) {
            if (n === undefined || n === null) return 'N/A';
            if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return String(n);
        }

        const profileText =
            `📸 *ɪɴsᴛᴀɢʀᴀᴍ ᴘʀᴏғɪʟᴇ*\n\n` +
            `*🆔 ɪᴅᴇɴᴛɪᴛʏ*\n` +
            `• *ᴜsᴇʀɴᴀᴍᴇ:* @${u.username}\n` +
            `${u.full_name ? `• *ɴᴀᴍᴇ:* ${u.full_name}\n` : ''}` +
            `${u.biography ? `\n*📝 ʙɪᴏ:*\n${u.biography.slice(0, 200)}\n` : ''}` +
            `\n*📊 sᴛᴀᴛs*\n` +
            `• *ғᴏʟʟᴏᴡᴇʀs:* ${fmtNum(followers)}\n` +
            `• *ғᴏʟʟᴏᴡɪɴɢ:* ${fmtNum(following)}\n` +
            `• *ᴘᴏsᴛs:* ${fmtNum(posts)}\n` +
            `\n*⚙️ ɪɴғᴏ*\n` +
            `• *ᴘʀɪᴠᴀᴛᴇ:* ${u.is_private ? '🔒 Yes' : '🔓 No'}\n` +
            `• *ᴠᴇʀɪғɪᴇᴅ:* ${u.is_verified ? '✅ Yes' : '❌ No'}\n` +
            `• *ʙᴜsɪɴᴇss:* ${u.is_business_account ? '🏢 Yes' : '👤 No'}\n` +
            `${u.external_url ? `• *ʟɪɴᴋ:* ${u.external_url}\n` : ''}` +
            `\n• *ᴘʀᴏғɪʟᴇ:* https://www.instagram.com/${u.username}/\n\n` +
            `> ${botConfig.BOT_FOOTER}`;

        const picUrl = u.profile_pic_url_hd || u.profile_pic_url || null;

        if (picUrl) {
            await socket.sendMessage(sender, {
                image: { url: picUrl },
                caption: profileText,
                buttons: [
                    { buttonId: `https://www.instagram.com/${u.username}/`, buttonText: { displayText: '📸 ᴠɪᴇᴡ ᴘʀᴏғɪʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}igstalk`, buttonText: { displayText: '🔍 sᴛᴀʟᴋ ᴀɢᴀɪɴ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: profileText,
                buttons: [
                    { buttonId: `https://www.instagram.com/${u.username}/`, buttonText: { displayText: '📸 ᴠɪᴇᴡ ᴘʀᴏғɪʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[IGStalk] Error:', error.message);

        if (error.response?.status === 404) {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜsᴇʀ ɴᴏᴛ ғᴏᴜɴᴅ*\n\nᴛʜᴇ ɪɴsᴛᴀɢʀᴀᴍ ᴜsᴇʀ *@${args[0]}* ᴅᴏᴇs ɴᴏᴛ ᴇxɪsᴛ.`,
                quoted: msg
            });
        } else if (error.response?.status === 429) {
            await socket.sendMessage(sender, {
                text: `⏳ *ʀᴀᴛᴇ ʟɪᴍɪᴛᴇᴅ*\n\nɪɴsᴛᴀɢʀᴀᴍ ɪs ʀᴀᴛᴇ-ʟɪᴍɪᴛɪɴɢ ᴛʜɪs ʀᴇϙᴜᴇsᴛ. ᴡᴀɪᴛ ᴀ ғᴇᴡ ᴍɪɴᴜᴛᴇs ᴀɴᴅ ᴛʀʏ ᴀɢᴀɪɴ.`,
                quoted: msg
            });
        } else {
            await socket.sendMessage(sender, {
                text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
                buttons: [
                    { buttonId: `${prefix}igstalk`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: pair
case 'pair': {
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: `*📌 ᴘᴀɪʀɪɴɢ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}pair 25410XXXXXX\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}pair 254712345678\`\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });
    }

    await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

    try {
        const url = `https://mini-bot-1-awlm.onrender.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            return await socket.sendMessage(sender, {
                text: '❌ ɪɴᴠᴀʟɪᴅ ʀᴇsᴘᴏɴsᴇ ғʀᴏᴍ sᴇʀᴠᴇʀ.',
                quoted: fakevCard
            });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ ғᴀɪʟᴇᴅ ᴛᴏ ʀᴇᴛʀɪᴇᴠᴇ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ.',
                quoted: fakevCard
            });
        }

        const pairingCode = result.code;

        // ONE message with Copy + Follow Channel buttons
        const ctaMsg = generateWAMessageFromContent(
            sender,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: {
                                text: `*ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ - ᴘᴀɪʀɪɴɢ ✅*\n\n` +
                                      `*🔑 ʏᴏᴜʀ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ:* \`\`\`${pairingCode}\`\`\`\n\n` +
                                      `📝 *ɪɴsᴛʀᴜᴄᴛɪᴏɴs:*\n` +
                                      `1. ᴛᴀᴘ ᴄᴏᴘʏ ʙᴜᴛᴛᴏɴ ʙᴇʟᴏᴡ\n` +
                                      `2. ᴘᴀsᴛᴇ ɪɴ ʟɪɴᴋᴇᴅ ᴅᴇᴠɪᴄᴇs\n\n` +
                                      `> ${botConfig.BOT_FOOTER}`
                            },
                            footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: {
                                buttons: [
                                    {
                                        name: 'cta_copy',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: 'Copy Code',
                                            copy_code: pairingCode
                                        })
                                    },
                                    {
                                        name: 'cta_url',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '📢 Follow Channel',
                                            url: botConfig.CHANNEL_LINK
                                        })
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            { quoted: fakevCard }
        );

        await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: `> *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ - ᴘᴀɪʀɪɴɢ ✅*\n\n*🔑 ʏᴏᴜʀ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ:* ${pairingCode || 'N/A'}\n\n📝 ᴄᴏᴘʏ ᴛʜᴇ ᴄᴏᴅᴇ ᴀɴᴅ ᴘᴀsᴛᴇ ɪɴ ʟɪɴᴋᴇᴅ ᴅᴇᴠɪᴄᴇs\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}pair`, buttonText: { displayText: '🔄 New Code' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    
    break;
}
//case tagadmin
case 'tagadmins':
case 'gc_tagadmins': {
    try {
        // Check if it's a group
        const isGroup = sender.endsWith('@g.us');
        if (!isGroup) {
            return await socket.sendMessage(sender, {
                text: '❌ *This command only works in group chats.*'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Get group metadata
        const groupMetadata = await socket.groupMetadata(sender);
        const groupName = groupMetadata.subject || "Unnamed Group";
        
        // Get admins from participants
        const adminParticipants = groupMetadata.participants.filter(participant => participant.admin);
        const admins = adminParticipants.map(admin => getParticipantJid(admin)).filter(Boolean);

        if (!admins || admins.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ *No admins found in this group.*'
            }, { quoted: msg });
        }

        // Extract message text from command
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || '';
        const args = q.split(' ').slice(1);
        const messageText = args.join(' ') || "Attention Admins ⚠️";

        // Admin emojis
        const emojis = ['👑', '⚡', '🌟', '✨', '🎖️', '💎', '🔱', '🛡️', '🚀', '🏆'];
        const chosenEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        // Build message
        let teks = `📢 *Admin Tag Alert*\n`;
        teks += `🏷️ *Group:* ${groupName}\n`;
        teks += `👥 *Admins:* ${admins.length}\n`;
        teks += `💬 *Message:* ${messageText}\n\n`;
        teks += `╭━━〔 *Admin Mentions* 〕━━┈⊷\n`;
        
        for (let i = 0; i < adminParticipants.length; i++) {
            const admin = adminParticipants[i];
            const displayJid = getParticipantPhoneJid(admin) || getParticipantJid(admin);
            teks += `${chosenEmoji} @${(displayJid || admins[i] || 'admin').split('@')[0]}\n`;
        }

        teks += `╰──────────────┈⊷\n\n`;
        teks += `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send message with mentions
        await socket.sendMessage(sender, {
            text: teks,
            mentions: admins,
            contextInfo: {
                mentionedJid: admins,
                externalAdReply: {
                    title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
                    body: `${admins.length} ᴀᴅᴍɪɴs`,
                    mediaType: 1,
                    sourceUrl: 'https://wa.me/254101022551',
                    thumbnailUrl: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg'
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("TagAdmins Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `❌ *Error occurred:*\n${error.message || 'Failed to tag admins'}`
        }, { quoted: msg });
    }
    break;
}

// Case: details (Message Details)
case 'details': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📋", // Clipboard emoji
            key: msg.key
        }
    });

    const context = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;

    if (!quoted) {
        return await socket.sendMessage(sender, {
            text: '📋 *Please reply to a message to view its raw details!*\n\n' +
                  'This command shows the complete message structure.'
        }, { quoted: fakevCard });
    }

    try {
        const json = JSON.stringify(quoted, null, 2);
        const parts = json.match(/[\s\S]{1,3500}/g) || [];

        if (parts.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ *No details available for this message.*'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, {
            text: `📋 *CaseyRhodes Message Details:*\n\n*Part 1/${parts.length}*`
        }, { quoted: fakevCard });

        for (let i = 0; i < parts.length; i++) {
            await socket.sendMessage(sender, {
                text: `\`\`\`json\n${parts[i]}\n\`\`\``
            });
            
            // Add small delay between messages to avoid rate limiting
            if (i < parts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (error) {
        console.error('Details command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Failed to read quoted message details!*'
        }, { quoted: fakevCard });
    }
    break;
}
// Case: horoscope / zodiac / horo - Get daily horoscope
case 'horoscope':
case 'zodiac':
case 'horo': {
    try {
        const SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
        const EMOJIS = { aries:'♈',taurus:'♉',gemini:'♊',cancer:'♋',leo:'♌',virgo:'♍',libra:'♎',scorpio:'♏',sagittarius:'♐',capricorn:'♑',aquarius:'♒',pisces:'♓' };

        const sign = (args[0] || '').toLowerCase();
        
        if (!sign || !SIGNS.includes(sign)) {
            await socket.sendMessage(sender, {
                text: `🔮 *ʜᴏʀᴏsᴄᴏᴘᴇ*\n\nɢᴇᴛ ʏᴏᴜʀ ᴅᴀɪʟʏ ʜᴏʀᴏsᴄᴏᴘᴇ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}horo <sign>\`\n\n*ᴢᴏᴅɪᴀᴄ sɪɢɴs:*\n${SIGNS.map(s => `${EMOJIS[s]} ${s}`).join(', ')}\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}horo leo\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}horo leo`, buttonText: { displayText: '♌ ʟᴇᴏ' }, type: 1 },
                    { buttonId: `${prefix}horo gemini`, buttonText: { displayText: '♊ ɢᴇᴍɪɴɪ' }, type: 1 },
                    { buttonId: `${prefix}horo scorpio`, buttonText: { displayText: '♏ sᴄᴏʀᴘɪᴏ' }, type: 1 },
                    { buttonId: `${prefix}horo pisces`, buttonText: { displayText: '♓ ᴘɪsᴄᴇs' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });

        const { data } = await axios.get(
            `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${sign}&day=TODAY`,
            { timeout: 10000 }
        );
        
        const h = data?.data;
        const date = h?.date || new Date().toDateString();
        const horoscopeText = h?.horoscope_data || 'No horoscope available today.';

        await socket.sendMessage(sender, {
            text: `${EMOJIS[sign]} *${sign.charAt(0).toUpperCase() + sign.slice(1)} ᴅᴀɪʟʏ ʜᴏʀᴏsᴄᴏᴘᴇ*\n📅 ${date}\n\n${horoscopeText}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}horo`, buttonText: { displayText: '🔮 ᴀɴᴏᴛʜᴇʀ sɪɢɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Horoscope] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ʜᴏʀᴏsᴄᴏᴘᴇ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            buttons: [
                { buttonId: `${prefix}horo`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//case pdf 
case 'topdf':
case 'pdf': {
    // React to the command
    await socket.sendMessage(sender, {
        react: {
            text: "📄",
            key: msg.key
        }
    });

    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';
    
    const args = q.trim().split(' ').slice(1);
    const textToConvert = args.join(' ');

    if (!textToConvert) {
        return await socket.sendMessage(sender, {
            text: '📄 *PDF Converter*\n\n' +
                  'Please provide text to convert to PDF.\n' +
                  'Example: *.topdf Hello World*',
            buttons: [
                { buttonId: '.topdf Sample PDF text', buttonText: { displayText: '📄 Example' }, type: 1 },
                { buttonId: '.help topdf', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        });
    }

    try {
        const PDFDocument = require('pdfkit');
        const { Buffer } = require('buffer');
        
        // Create a new PDF document
        const doc = new PDFDocument({
            margin: 50,
            size: 'A4'
        });
        
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            try {
                const pdfData = Buffer.concat(buffers);
                const fileName = `CASEYRHODES_${Date.now()}.pdf`;
                
                await socket.sendMessage(sender, {
                    document: pdfData,
                    mimetype: 'application/pdf',
                    fileName: fileName,
                    caption: `📄 *PDF created successfully!*\n\n` +
                            `*Filename:* ${fileName}\n` +
                            `*Text Length:* ${textToConvert.length} characters\n\n` +
                            `> © Created by CaseyRhodes XMD`,
                    contextInfo: {
                        mentionedJid: [sender]
                    }
                });
            } catch (sendError) {
                console.error('[PDF SEND ERROR]', sendError);
                await socket.sendMessage(sender, {
                    text: '❌ *Error sending PDF file!*\n\n' +
                          'File might be too large or corrupted.',
                    buttons: [
                        { buttonId: '.topdf', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                        { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
                    ]
                });
            }
        });

        // Add styling and content to the PDF
        doc.font('Helvetica-Bold')
           .fontSize(20)
           .text('CaseyRhodes PDF Document', { align: 'center' });
        
        doc.moveDown(0.5)
           .font('Helvetica')
           .fontSize(12)
           .text('Generated: ' + new Date().toLocaleString(), { align: 'center' });
        
        doc.moveDown(1)
           .fontSize(12)
           .text(textToConvert, {
               align: 'left',
               width: 500,
               lineGap: 5
           });
        
        // Add footer
        doc.moveDown(2)
           .fontSize(10)
           .font('Helvetica-Oblique')
           .text('© Created by CaseyRhodes XMD', { align: 'center' });

        // Finalize the PDF
        doc.end();

    } catch (e) {
        console.error('[PDF ERROR]', e);
        await socket.sendMessage(sender, {
            text: `❌ *Error creating PDF!*\n\n` +
                  `Error: ${e.message || 'Unknown error'}\n\n` +
                  'Please try again with different text.',
            buttons: [
                { buttonId: '.topdf', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        });
    }
    break;
}


// Case: fullpp / mypp / dp - Set full profile picture 
//============ WHATSAPP TOOLS COMMANDS ============

// Case: fullpp / mypp / dp - Set full profile picture (owner only)
case 'fullpp':
case 'mypp':
case 'dp': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        
        const quotedMsg2 = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedImage = quotedMsg2?.imageMessage;
        if (!quotedImage) { await socket.sendMessage(sender, { text: '❌ *ʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ*', quoted: fakevCard }); break; }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
        
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        
        const mediaPath = path.join(TEMP_MEDIA_DIR, `fullpp_${Date.now()}.jpg`);
        await writeFile(mediaPath, buffer);
        
        const image = await Jimp.read(mediaPath);
        const resized = await image.resize(720, 720).getBufferAsync(Jimp.MIME_JPEG);
        
        await socket.query({
            tag: 'iq', attrs: { to: S_WHATSAPP_NET, type: 'set', xmlns: 'w:profile:picture' },
            content: [{ tag: 'picture', attrs: { type: 'image' }, content: resized }]
        });
        
        try { fs.unlinkSync(mediaPath); } catch {}
        
        // Success with CTA
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ sᴇᴛ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ sᴇᴛ!*', quoted: fakevCard }); }
        
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ *ғᴀɪʟᴇᴅ*\n\n' + e.message, quoted: fakevCard }); await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } }); }
    break;
}

// Case: pin - Pin chat (owner only)
case 'pin': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        await socket.chatModify({ pin: true }, from);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '📌 *ᴄʜᴀᴛ ᴘɪɴɴᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '📌 *ᴄʜᴀᴛ ᴘɪɴɴᴇᴅ!*', quoted: fakevCard }); }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: unpin - Unpin chat (owner only)
case 'unpin': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        await socket.chatModify({ pin: false }, from);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '📌 *ᴄʜᴀᴛ ᴜɴᴘɪɴɴᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '📌 *ᴄʜᴀᴛ ᴜɴᴘɪɴɴᴇᴅ!*', quoted: fakevCard }); }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: archive - Archive chat (owner only)
case 'archive': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        await socket.chatModify({ archive: true, lastMessages: [msg] }, from);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '📁 *ᴄʜᴀᴛ ᴀʀᴄʜɪᴠᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '📁 *ᴄʜᴀᴛ ᴀʀᴄʜɪᴠᴇᴅ!*', quoted: fakevCard }); }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: onwa / checkid - Check if number is on WhatsApp
case 'onwa':
case 'checkid':
case 'checkno': {
    try {
        const number = (args[0] || '').replace(/[^\d]/g, '');
        if (!number || number.length < 10) { await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}onwa 254712345678\``, quoted: fakevCard }); break; }
        
        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
        const [result] = await socket.onWhatsApp(`${number}@s.whatsapp.net`);
        const responseText = result?.exists ? `✅ *${number}* ɪs ᴏɴ ᴡʜᴀᴛsᴀᴘᴘ!` : `❌ *${number}* ɪs ɴᴏᴛ ᴏɴ ᴡʜᴀᴛsᴀᴘᴘ.`;
        
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `${responseText}\n\n> ${botConfig.BOT_FOOTER}` },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `${responseText}\n\n> ${botConfig.BOT_FOOTER}`, quoted: fakevCard }); }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: location / loc - Get Google Maps link
case 'location':
case 'loc': {
    try {
        const quotedMsg2 = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const locMsg = quotedMsg2?.locationMessage;
        if (!locMsg) { await socket.sendMessage(sender, { text: '❌ *ʀᴇᴘʟʏ ᴛᴏ ᴀ ʟᴏᴄᴀᴛɪᴏɴ ᴍᴇssᴀɢᴇ*', quoted: fakevCard }); break; }
        
        const { degreesLatitude, degreesLongitude } = locMsg;
        const mapUrl = `https://maps.google.com/?q=${degreesLatitude},${degreesLongitude}`;
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `📍 *ʟᴏᴄᴀᴛɪᴏɴ*\n\n${mapUrl}\n\n> ${botConfig.BOT_FOOTER}` },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `📍 *ʟᴏᴄᴀᴛɪᴏɴ*\n\n${mapUrl}\n\n> ${botConfig.BOT_FOOTER}`, quoted: fakevCard }); }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: removedp - Remove profile picture (owner only)
case 'removedp': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        await socket.removeProfilePicture(sender);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ʀᴇᴍᴏᴠᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ʀᴇᴍᴏᴠᴇᴅ!*', quoted: fakevCard }); }
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: vcard / card - Save contact from replied message
case 'vcard':
case 'card': {
    try {
        const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (!quotedSender) { await socket.sendMessage(sender, { text: '❌ *ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ*', quoted: fakevCard }); break; }
        
        const name = args.join(' ').trim() || 'Contact';
        const phone = quotedSender.split('@')[0];
        const vcardString = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${phone}:${phone}\nEND:VCARD`;
        
        await socket.sendMessage(sender, {
            contacts: { displayName: name, contacts: [{ displayName: name, vcard: vcardString }] }
        }, { quoted: fakevCard });
        
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '✅ *ᴄᴏɴᴛᴀᴄᴛ sᴀᴠᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Join Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {}
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

case 'apk':
case 'app':
case 'getapk': {
    try {
        const query = args.join(' ').trim();
        
        if (!query) {
            await socket.sendMessage(sender, {
                text: `📱 *APK Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\nDᴏᴡɴʟᴏᴀᴅ APK ғɪʟᴇs ғʀᴏᴍ Aᴘᴛᴏɪᴅᴇ.\n\n*Usᴀɢᴇ:* \`${prefix}apk <app name>\`\n\n*Exᴀᴍᴘʟᴇs:*\n• \`${prefix}apk whatsapp\`\n• \`${prefix}apk instagram\`\n• \`${prefix}apk spotify\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}apk whatsapp`, buttonText: { displayText: '📱 WhatsApp' }, type: 1 },
                    { buttonId: `${prefix}apk instagram`, buttonText: { displayText: '📷 Instagram' }, type: 1 },
                    { buttonId: `${prefix}apk spotify`, buttonText: { displayText: '🎵 Spotify' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⌛', key: msg.key } });

        // Send searching message
        const searchMsg = await socket.sendMessage(sender, {
            text: `🔍 *Sᴇᴀʀᴄʜɪɴɢ ғᴏʀ "${query}"...*\n\nPʟᴇᴀsᴇ ᴡᴀɪᴛ, ғᴇᴛᴄʜɪɴɢ APK ɪɴғᴏʀᴍᴀᴛɪᴏɴ.`,
            quoted: fakevCard
        });

        try {
            const response = await axios.get(`https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}`, {
                timeout: 15000
            });
            
            const data = response.data;

            if (!data?.datalist?.list?.length) {
                try { await socket.sendMessage(sender, { delete: searchMsg.key }); } catch {}
                await socket.sendMessage(sender, {
                    text: `❌ *Aᴘᴘ Nᴏᴛ Fᴏᴜɴᴅ*\n\nNᴏ ᴀᴘᴘ ғᴏᴜɴᴅ ғᴏʀ "${query}".\n\n*Sᴜɢɢᴇsᴛɪᴏɴs:*\n• Cʜᴇᴄᴋ ᴛʜᴇ sᴘᴇʟʟɪɴɢ\n• Tʀʏ ᴀ ᴅɪғғᴇʀᴇɴᴛ ᴀᴘᴘ ɴᴀᴍᴇ\n• Usᴇ ᴛʜᴇ ғᴜʟʟ ᴀᴘᴘ ɴᴀᴍᴇ\n\n> ${botConfig.BOT_FOOTER}`,
                    buttons: [
                        { buttonId: `${prefix}apk`, buttonText: { displayText: '🔍 Tʀʏ Aɢᴀɪɴ' }, type: 1 },
                        { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Mᴇɴᴜ' }, type: 1 }
                    ],
                    headerType: 1
                }, { quoted: fakevCard });
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                break;
            }

            const app = data.datalist.list[0];
            const apkUrl = app.file?.path;
            
            const appName = app.name || 'Unknown';
            const appSize = app.file?.size ? `${(app.file.size / 1024 / 1024).toFixed(2)} MB` : 'Unknown';
            const appDownloads = app.stats?.downloads || 'Unknown';
            const appRating = app.stats?.rating?.avg || 'N/A';
            const appDeveloper = app.developer?.name || 'Unknown';
            const appVersion = app.file?.versionName || 'Unknown';
            const appIcon = app.icon || null;

            if (!apkUrl) {
                try { await socket.sendMessage(sender, { delete: searchMsg.key }); } catch {}
                await socket.sendMessage(sender, {
                    text: `❌ *Dᴏᴡɴʟᴏᴀᴅ Lɪɴᴋ Nᴏᴛ Aᴠᴀɪʟᴀʙʟᴇ*\n\nTʜᴇ APK ᴅᴏᴡɴʟᴏᴀᴅ ʟɪɴᴋ ғᴏʀ "${appName}" ɪs ɴᴏᴛ ᴀᴠᴀɪʟᴀʙʟᴇ.\n\n> ${botConfig.BOT_FOOTER}`,
                    buttons: [
                        { buttonId: `${prefix}apk`, buttonText: { displayText: '🔍 Sᴇᴀʀᴄʜ Aɢᴀɪɴ' }, type: 1 },
                        { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Mᴇɴᴜ' }, type: 1 }
                    ],
                    headerType: 1
                }, { quoted: fakevCard });
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                break;
            }

            // Delete searching message
            try { await socket.sendMessage(sender, { delete: searchMsg.key }); } catch {}

            const appInfo = 
                `📱 *${appName}*\n\n` +
                `📝 *Dᴇsᴄʀɪᴘᴛɪᴏɴ:* ${app.description?.substring(0, 150) || 'N/A'}${app.description?.length > 150 ? '...' : ''}\n\n` +
                `📊 *Iɴғᴏʀᴍᴀᴛɪᴏɴ:*\n` +
                `• 👨‍💻 Dᴇᴠᴇʟᴏᴘᴇʀ: ${appDeveloper}\n` +
                `• 📦 Vᴇʀsɪᴏɴ: ${appVersion}\n` +
                `• 💾 Sɪᴢᴇ: ${appSize}\n` +
                `• 📥 Dᴏᴡɴʟᴏᴀᴅs: ${appDownloads}\n` +
                `• ⭐ Rᴀᴛɪɴɢ: ${appRating}\n\n` +
                `> ${botConfig.BOT_FOOTER}`;

            // Send APK file
            await socket.sendMessage(sender, {
                document: { url: apkUrl },
                fileName: `${appName.replace(/[^a-zA-Z0-9]/g, '_')}.apk`,
                mimetype: "application/vnd.android.package-archive",
                caption: appInfo
            }, { quoted: fakevCard });

            // Send success message with CTA buttons
            const successText = `✅ *APK Sᴇɴᴛ Sᴜᴄᴄᴇssғᴜʟʟʏ!*\n\n📱 *Aᴘᴘ:* ${appName}\n💾 *Sɪᴢᴇ:* ${appSize}\n\n> ${botConfig.BOT_FOOTER}`;

            const ctaButtons = [
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '📢 Jᴏɪɴ Cʜᴀɴɴᴇʟ',
                        url: botConfig.CHANNEL_LINK
                    })
                },
                {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: '⭐ Sᴛᴀʀ Rᴇᴘᴏ',
                        url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                    })
                }
            ];

            try {
                const ctaMsg = generateWAMessageFromContent(
                    sender,
                    {
                        viewOnceMessage: {
                            message: {
                                interactiveMessage: {
                                    body: { text: successText },
                                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                    nativeFlowMessage: { buttons: ctaButtons }
                                }
                            }
                        }
                    },
                    { quoted: fakevCard }
                );
                await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
            } catch {
                await socket.sendMessage(sender, {
                    text: successText,
                    buttons: [
                        { buttonId: `${prefix}apk`, buttonText: { displayText: '📱 Dᴏᴡɴʟᴏᴀᴅ Mᴏʀᴇ' }, type: 1 }
                    ],
                    headerType: 1
                }, { quoted: fakevCard });
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            try { await socket.sendMessage(sender, { delete: searchMsg.key }); } catch {}
            throw error;
        }

    } catch (error) {
        console.error('[APK] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *APK Dᴏᴡɴʟᴏᴀᴅ Fᴀɪʟᴇᴅ*\n\n${error.message}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}apk`, buttonText: { displayText: '🔄 Rᴇᴛʀʏ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Mᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: lyrics / lyric / songlyrics - Get song lyrics
// Case: lyrics / lyric / songlyrics - Get song lyrics (one message, no image, with copy)
case 'lyrics':
case 'lyric':
case 'songlyrics': {
    try {
        const query = args.join(' ').trim();
        
        if (!query) {
            await socket.sendMessage(sender, {
                text: `🎵 *sᴏɴɢ ʟʏʀɪᴄs*\n\n*ᴜsᴀɢᴇ:* \`${prefix}lyrics <song name>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}lyrics Shape of You\`\n• \`${prefix}lyrics Blinding Lights\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}lyrics Shape of You`, buttonText: { displayText: '🎵 Shape of You' }, type: 1 },
                    { buttonId: `${prefix}lyrics Blinding Lights`, buttonText: { displayText: '🎵 Blinding Lights' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });

        const url = `https://api.popcat.xyz/v2/lyrics?song=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { timeout: 10000 });

        if (data.error || !data.message) {
            await socket.sendMessage(sender, {
                text: `❌ *ɴᴏᴛ ғᴏᴜɴᴅ*\n\nɴᴏ ʟʏʀɪᴄs ғᴏᴜɴᴅ ғᴏʀ "${query}".\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}lyrics`, buttonText: { displayText: '🎵 Try Again' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        const song = data.message;
        const lyrics = song.lyrics ? song.lyrics.slice(0, 3000) : 'No lyrics available';
        const fullLyrics = song.lyrics || '';

        const caption = `🎵 *${song.title}*\n👤 *${song.artist}*\n\n${lyrics}${lyrics.length >= 3000 ? '...' : ''}\n\n🔗 ${song.url || 'N/A'}\n\n> ${botConfig.BOT_FOOTER}`;

        // ONE message with CTA buttons (no image)
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: caption },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: ' Copy Lyrics',
                                                copy_code: fullLyrics
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '⭐ GitHub Repo',
                                                url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: caption,
                buttons: [
                    { buttonId: `${prefix}lyrics`, buttonText: { displayText: '🎵 Search Again' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[Lyrics] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${err.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//case play damn am good
case 'play': {
    try {
        await socket.sendMessage(sender, { react: { text: '🎶', key: msg.key } });

        const yts = require('yt-search');
        const q = msg.message?.conversation ||
                  msg.message?.extendedTextMessage?.text ||
                  msg.message?.imageMessage?.caption ||
                  msg.message?.videoMessage?.caption || '';
        const query = q.split(' ').slice(1).join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: `🎵 *ᴀᴜᴅɪᴏ ᴘʟᴀʏᴇʀ*\n\nᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ sᴏɴɢ ɴᴀᴍᴇ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}play <song name>\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}play Faded\`\n\`${prefix}play Shape of You\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }

        console.log('[PLAY] Searching YouTube for:', query);
        const search = await yts(query);
        const video = search?.videos?.[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: `❌ *ɴᴏ ʀᴇsᴜʟᴛs*\n\nɴᴏ sᴏɴɢs ғᴏᴜɴᴅ. ᴛʀʏ ᴅɪғғᴇʀᴇɴᴛ ᴋᴇʏᴡᴏʀᴅs.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }

        // DavidCyrilTech YTMP33 API
        const apiURL = `https://apis.davidcyriltech.my.id/download/ytmp33?url=${encodeURIComponent(video.url)}`;
        console.log('[PLAY] DavidCyrilTech API:', apiURL);

        const response = await axios.get(apiURL, {
            timeout: 45000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const data = response?.data || {};
        const result = data?.result || data?.data || data;
        const audioUrl = result?.audio || result?.audioUrl || result?.audio_url ||
                         result?.download || result?.downloadUrl || result?.download_url ||
                         result?.link || result?.media || result?.url ||
                         data?.audio || data?.audioUrl || data?.audio_url ||
                         data?.download || data?.downloadUrl || data?.download_url ||
                         data?.link || data?.media || data?.url || null;
        const apiTitle = result?.title || data?.title || video.title;
        const thumbnail = result?.thumbnail || data?.thumbnail || video.thumbnail;

        if (!audioUrl || typeof audioUrl !== 'string') {
            console.error('[PLAY] DavidCyrilTech response:', JSON.stringify(data).slice(0, 1500));
            return await socket.sendMessage(sender, {
                text: `❌ *ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\nᴇʟɪᴛᴇᴘʀᴏᴛᴇᴄʜ ᴅɪᴅ ɴᴏᴛ ʀᴇᴛᴜʀɴ ᴀɴ ᴀᴜᴅɪᴏ ʟɪɴᴋ.\n\nᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }

        const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const cleanTitle = String(apiTitle || video.title || 'audio').replace(/[<>:"/\\|?*]+/g, '').trim() || 'audio';

        const caption = `🎧 *${apiTitle}*\n\n` +
                        `⏱️ *ᴅᴜʀᴀᴛɪᴏɴ:* ${video.timestamp || 'Unknown'}\n` +
                        `👤 *ᴀʀᴛɪsᴛ:* ${video.author?.name || 'Unknown'}\n` +
                        `👀 *ᴠɪᴇᴡs:* ${(video.views || 0).toLocaleString()}\n\n` +
                        `🔗 *ʏᴏᴜᴛᴜʙᴇ:* ${video.url}\n\n` +
                        `📂 *ᴅᴏᴡɴʟᴏᴀᴅ ᴄᴀᴛᴇɢᴏʀʏ*\n` +
                        `sᴇʟᴇᴄᴛ ʜᴏᴡ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ ʀᴇᴄᴇɪᴠᴇ ᴛʜᴇ ᴀᴜᴅɪᴏ.\n\n` +
                        `> ${botConfig.BOT_FOOTER}`;

        // Gifted Buttons category/list. The two formats are rows inside
        // a single_select category instead of old Baileys quick buttons.
        const sentMsg = await socket.sendMessage(sender, {
            image: { url: thumbnail },
            caption,
            footer: '📂 ᴄʜᴏᴏsᴇ ᴅᴏᴡɴʟᴏᴀᴅ ғᴏʀᴍᴀᴛ',
            buttons: [{
                buttonId: `play-category-${sessionId}`,
                buttonText: { displayText: '📂 ᴄʜᴏᴏsᴇ ᴅᴏᴡɴʟᴏᴀᴅ ғᴏʀᴍᴀᴛ' },
                type: 4,
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson: JSON.stringify({
                        title: '📂 ᴅᴏᴡɴʟᴏᴀᴅ ᴄᴀᴛᴇɢᴏʀʏ',
                        sections: [{
                            title: '🎵 ᴀᴜᴅɪᴏ ғᴏʀᴍᴀᴛs',
                            highlight_label: 'ᴘʟᴀʏ / sᴀᴠᴇ',
                            rows: [
                                {
                                    title: '🎵 ᴀᴜᴅɪᴏ (ᴘʟᴀʏ)',
                                    description: 'Play the song directly in WhatsApp',
                                    id: `play-audio-${sessionId}`
                                },
                                {
                                    title: '📁 ᴅᴏᴄᴜᴍᴇɴᴛ (sᴀᴠᴇ)',
                                    description: 'Send the MP3 as a document',
                                    id: `play-document-${sessionId}`
                                }
                            ]
                        }]
                    })
                }
            }],
            headerType: 1,
            viewOnce: true
        }, { quoted: msg });

        // Handle both old button replies and Gifted/native-flow replies.
        const buttonHandler = async (messageUpdate) => {
            try {
                for (const messageData of messageUpdate?.messages || []) {
                    let buttonId = null;
                    let replyStanzaId = null;

                    const legacy = messageData?.message?.buttonsResponseMessage;
                    if (legacy) {
                        buttonId = legacy.selectedButtonId;
                        replyStanzaId = legacy.contextInfo?.stanzaId;
                    }

                    const interactive = messageData?.message?.interactiveResponseMessage;
                    if (interactive?.nativeFlowResponseMessage?.paramsJson) {
                        try {
                            const params = JSON.parse(interactive.nativeFlowResponseMessage.paramsJson);
                            buttonId = params.id || params.selectedId || params.row_id || params.rowId || buttonId;
                        } catch {}
                        replyStanzaId = interactive.contextInfo?.stanzaId || replyStanzaId;
                    }

                    const listReply = messageData?.message?.listResponseMessage;
                    if (listReply) {
                        buttonId = listReply.singleSelectReply?.selectedRowId || buttonId;
                        replyStanzaId = listReply.contextInfo?.stanzaId || replyStanzaId;
                    }

                    if (!buttonId || !String(buttonId).includes(sessionId)) continue;
                    if (replyStanzaId && replyStanzaId !== sentMsg?.key?.id) continue;

                    socket.ev.off('messages.upsert', buttonHandler);
                    await socket.sendMessage(sender, { react: { text: '⏳', key: messageData.key } });

                    try {
                        const type = String(buttonId).startsWith(`play-audio-${sessionId}`) ? 'audio' : 'document';
                        const audioResponse = await axios.get(audioUrl, {
                            responseType: 'arraybuffer',
                            timeout: 60000,
                            maxContentLength: 50 * 1024 * 1024,
                            maxBodyLength: 50 * 1024 * 1024,
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        });
                        const audioBuffer = Buffer.from(audioResponse.data);

                        if (!audioBuffer.length) throw new Error('Empty audio response');

                        const fileName = `${cleanTitle}.mp3`;
                        if (type === 'audio') {
                            await socket.sendMessage(sender, {
                                audio: audioBuffer,
                                mimetype: 'audio/mpeg',
                                fileName,
                                ptt: false
                            }, { quoted: messageData });
                        } else {
                            await socket.sendMessage(sender, {
                                document: audioBuffer,
                                mimetype: 'audio/mpeg',
                                fileName
                            }, { quoted: messageData });
                        }

                        await socket.sendMessage(sender, { react: { text: '✅', key: messageData.key } });
                    } catch (error) {
                        console.error('[PLAY] Download Error:', error.message);
                        await socket.sendMessage(sender, { react: { text: '❌', key: messageData.key } });
                        await socket.sendMessage(sender, {
                            text: `❌ *ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\n${error.message || 'Download failed'}`
                        }, { quoted: messageData });
                    }
                    return;
                }
            } catch (error) {
                console.error('[PLAY] Button/category handler error:', error.message);
            }
        };

        socket.ev.on('messages.upsert', buttonHandler);
        setTimeout(() => socket.ev.off('messages.upsert', buttonHandler), 120000);

    } catch (err) {
        console.error('[PLAY] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴇʀʀᴏʀ*\n\nᴜɴᴀʙʟᴇ ᴛᴏ ᴘʀᴏᴄᴇss ʏᴏᴜʀ ʀᴇǫᴜᴇsᴛ.\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
  

// Case: tiktok / tt / ttdl / tiktokdl - Download TikTok videos
case 'tiktok':
case 'tt':
case 'ttdl':
case 'tiktokdl': {
    try {
        // React to command
        await socket.sendMessage(sender, { 
            react: { text: '📱', key: msg.key } 
        });

        // Check if URL is provided
        if (!args[0]) {
            await socket.sendMessage(sender, {
                text: `📱 *ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ*\n\nᴅᴏᴡɴʟᴏᴀᴅ ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏs ᴡɪᴛʜᴏᴜᴛ ᴡᴀᴛᴇʀᴍᴀʀᴋ.\n\n*ᴜsᴀɢᴇ:*\n\`${prefix}tiktok <ᴛɪᴋᴛᴏᴋ ʟɪɴᴋ>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}tiktok https://www.tiktok.com/@user/video/xxx\`\n• \`${prefix}tt https://vm.tiktok.com/xxx\`\n• \`${prefix}ttdl https://vt.tiktok.com/xxx\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { 
                        buttonId: `${prefix}tiktok https://www.tiktok.com/@tiktok/video/123456789`, 
                        buttonText: { displayText: '📱 ᴇxᴀᴍᴘʟᴇ ᴠɪᴅᴇᴏ' }, 
                        type: 1 
                    },
                    { 
                        buttonId: `${prefix}menu`, 
                        buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, 
                        type: 1 
                    }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        // Extract URL from args
        const url = args[0];
        
        // Validate TikTok URL
        const tiktokRegex = /(?:https?:\/\/)?(?:www\.)?(?:vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com)\/(?:@[\w.-]+\/video\/\d+|[\w]+)/;
        if (!tiktokRegex.test(url)) {
            await socket.sendMessage(sender, {
                text: `❌ *ɪɴᴠᴀʟɪᴅ ᴛɪᴋᴛᴏᴋ ʟɪɴᴋ*\n\nᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴛɪᴋᴛᴏᴋ ᴜʀʟ.\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}tiktok https://www.tiktok.com/@user/video/xxx\`\n• \`${prefix}tt https://vm.tiktok.com/xxx\`\n• \`${prefix}ttdl https://vt.tiktok.com/xxx\``,
                quoted: msg
            });
            await socket.sendMessage(sender, { 
                react: { text: '❌', key: msg.key } 
            });
            break;
        }

        // Send processing message
        const processingMsg = await socket.sendMessage(sender, {
            text: `⏳ *ᴘʀᴏᴄᴇssɪɴɢ...*\n\n📱 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏ\n📥 ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ, ᴛʜɪs ᴍᴀʏ ᴛᴀᴋᴇ ᴀ ᴍᴏᴍᴇɴᴛ.`,
            quoted: msg
        });

        // Encode URL for API
        const encodedUrl = encodeURIComponent(url);
        const apiUrl = `https://api.cod3uchiha.com/downloaders/tiktokdl?url=${encodedUrl}`;

        console.log(`[TikTok] 📥 Downloading: ${url}`);

        // Fetch video info and download link
        const response = await axios.get(apiUrl, { 
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const data = response.data;

        // Delete processing message
        try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch (e) {}

        // Check if response contains error
        if (data.error || data.status === 'error' || !data) {
            throw new Error(data.message || 'Failed to download video');
        }

        // Extract video info from response (supports multiple response formats)
        const videoData = data.result || data.data || data;
        
        const videoTitle = videoData.title || videoData.desc || 'TikTok Video';
        const videoUrl = videoData.play || videoData.videoUrl || videoData.download || videoData.url || videoData.link;
        const thumbnail = videoData.cover || videoData.thumbnail || videoData.pic || 'https://via.placeholder.com/150';
        const duration = videoData.duration || 'N/A';
        const views = videoData.play_count || videoData.views || 'N/A';
        const likes = videoData.digg_count || videoData.likes || 'N/A';
        const shares = videoData.share_count || videoData.shares || 'N/A';
        const comments = videoData.comment_count || videoData.comments || 'N/A';
        const uploader = videoData.author?.nickname || videoData.author || videoData.nickname || 'Unknown';
        const uploaderUsername = videoData.author?.unique_id || videoData.username || 'unknown';
        const music = videoData.music || videoData.sound || 'Unknown';
        const isWatermarked = videoData.watermarked || false;

        if (!videoUrl) {
            throw new Error('No download URL found in response');
        }

        // Determine if video has audio
        const hasAudio = videoData.has_audio !== undefined ? videoData.has_audio : true;

        // Create video info caption
        const caption = `📱 *${videoTitle.substring(0, 60)}${videoTitle.length > 60 ? '...' : ''}*\n\n` +
                       `👤 *ᴜᴘʟᴏᴀᴅᴇʀ:* ${uploader} (@${uploaderUsername})\n` +
                       `⏱️ *ᴅᴜʀᴀᴛɪᴏɴ:* ${duration}s\n` +
                       `👁️ *ᴠɪᴇᴡs:* ${formatNumber(views)}\n` +
                       `❤️ *ʟɪᴋᴇs:* ${formatNumber(likes)}\n` +
                       `💬 *ᴄᴏᴍᴍᴇɴᴛs:* ${formatNumber(comments)}\n` +
                       `🔄 *sʜᴀʀᴇs:* ${formatNumber(shares)}\n` +
                       `🎵 *sᴏᴜɴᴅ:* ${music.substring(0, 40)}${music.length > 40 ? '...' : ''}\n` +
                       `💧 *ᴡᴀᴛᴇʀᴍᴀʀᴋ:* ${isWatermarked ? '✅ ʏᴇs' : '❌ ɴᴏ'}\n\n` +
                       `📥 *ᴅᴏᴡɴʟᴏᴀᴅᴇᴅ ʙʏ* ${botConfig.OWNER_NAME}\n\n` +
                       `> ${botConfig.BOT_FOOTER}`;

        // Helper function to format numbers
        function formatNumber(num) {
            if (!num) return '0';
            const n = parseInt(num);
            if (isNaN(n)) return num;
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return n.toString();
        }

        // Try to send video with audio
        try {
            await socket.sendMessage(sender, {
                video: { url: videoUrl },
                caption: caption,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    externalAdReply: {
                        title: uploader,
                        body: `❤️ ${formatNumber(likes)} likes | 👁️ ${formatNumber(views)} views`,
                        mediaType: 2,
                        thumbnailUrl: thumbnail,
                        sourceUrl: url,
                        renderLargerThumbnail: true
                    },
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363420261263259@newsletter',
                        newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                        serverMessageId: -1
                    }
                },
                buttons: [
                    { 
                        buttonId: `${prefix}tiktok`, 
                        buttonText: { displayText: '📱 ᴅᴏᴡɴʟᴏᴀᴅ ᴀɴᴏᴛʜᴇʀ' }, 
                        type: 1 
                    },
                    { 
                        buttonId: `${prefix}menu`, 
                        buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, 
                        type: 1 
                    }
                ],
                headerType: 1
            }, { quoted: msg });
        } catch (sendError) {
            // If video send fails, try sending as document
            console.log('[TikTok] Video send failed, trying as document...');
            
            const fileName = `${uploaderUsername}_${Date.now()}.mp4`;
            
            await socket.sendMessage(sender, {
                document: { url: videoUrl },
                fileName: fileName,
                mimetype: 'video/mp4',
                caption: caption,
                contextInfo: {
                    externalAdReply: {
                        title: uploader,
                        body: `❤️ ${formatNumber(likes)} likes | 👁️ ${formatNumber(views)} views`,
                        mediaType: 2,
                        thumbnailUrl: thumbnail,
                        sourceUrl: url
                    },
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363420261263259@newsletter',
                        newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                        serverMessageId: -1
                    }
                }
            }, { quoted: msg });
        }

        // Success reaction
        await socket.sendMessage(sender, { 
            react: { text: '✅', key: msg.key } 
        });

        console.log(`[TikTok] ✅ Sent: ${videoTitle}`);

    } catch (error) {
        console.error('[TikTok] Error:', error.message);

        // Delete processing message if exists
        try { 
            await socket.sendMessage(sender, { delete: processingMsg.key }); 
        } catch (e) {}

        // Send error message
        await socket.sendMessage(sender, {
            text: `❌ *ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\n${error.message || 'Unknown error occurred'}\n\n*ᴛʀʏ ᴀɢᴀɪɴ ᴏʀ ᴜsᴇ ᴀ ᴅɪғғᴇʀᴇɴᴛ ʟɪɴᴋ.*\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { 
                    buttonId: `${prefix}tiktok`, 
                    buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, 
                    type: 1 
                },
                { 
                    buttonId: `${prefix}menu`, 
                    buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, 
                    type: 1 
                }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { 
            react: { text: '❌', key: msg.key } 
        });
    }
    break;
}
// Case: newsletter / cjid / id - Channel info with copy & follow buttons (no image)
case 'newsletter':
case 'cjid':
case 'id': {
    try {
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const channelLink = args.join(' ');

        if (!channelLink) {
            return await socket.sendMessage(sender, {
                text: `📡 *ᴄʜᴀɴɴᴇʟ ɪɴғᴏ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}newsletter <channel link>\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}newsletter https://whatsapp.com/channel/xxxxxxxxxx\`\n\n> ${botConfig.BOT_FOOTER}`
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
        if (!match) {
            return await socket.sendMessage(sender, {
                text: `⚠️ *ɪɴᴠᴀʟɪᴅ ᴄʜᴀɴɴᴇʟ ʟɪɴᴋ!*\n\nᴍᴀᴋᴇ sᴜʀᴇ ɪᴛ ʟᴏᴏᴋs ʟɪᴋᴇ:\nhttps://whatsapp.com/channel/xxxxxxxxx\n\n> ${botConfig.BOT_FOOTER}`
            }, { quoted: fakevCard });
        }

        const inviteId = match[1];
        let metadata;

        try {
            metadata = await socket.newsletterMetadata("invite", inviteId);
        } catch (error) {
            console.error('Newsletter metadata error:', error);
            return await socket.sendMessage(sender, {
                text: `🚫 *ғᴀɪʟᴇᴅ ᴛᴏ ғᴇᴛᴄʜ ᴄʜᴀɴɴᴇʟ ɪɴғᴏ.*\n\nᴅᴏᴜʙʟᴇ-ᴄʜᴇᴄᴋ ᴛʜᴇ ʟɪɴᴋ ᴀɴᴅ ᴛʀʏ ᴀɢᴀɪɴ.\n\n> ${botConfig.BOT_FOOTER}`
            }, { quoted: fakevCard });
        }

        if (!metadata?.id) {
            return await socket.sendMessage(sender, {
                text: `❌ *ᴄʜᴀɴɴᴇʟ ɴᴏᴛ ғᴏᴜɴᴅ ᴏʀ ɪɴᴀᴄᴄᴇssɪʙʟᴇ.*\n\n> ${botConfig.BOT_FOOTER}`
            }, { quoted: fakevCard });
        }

        const infoText = `📡 *ᴄʜᴀɴɴᴇʟ ɪɴғᴏ*\n\n` +
                        `🆔 *ID:* ${metadata.id}\n` +
                        `📛 *Name:* ${metadata.name || 'N/A'}\n` +
                        `👥 *Followers:* ${metadata.subscribers?.toLocaleString() || "N/A"}\n` +
                        `📅 *Created:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString() : "Unknown"}\n\n` +
                        `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // ONE message with CTA buttons (no image)
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: infoText },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📋 Copy Newsletter ID',
                                                copy_code: metadata.id
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '🔔 Follow Channel',
                                                url: channelLink
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Our Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: infoText,
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error("Newsletter Error:", error);
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        await socket.sendMessage(sender, {
            text: `⚠️ *ᴀɴ ᴜɴᴇxᴘᴇᴄᴛᴇᴅ ᴇʀʀᴏʀ ᴏᴄᴄᴜʀʀᴇᴅ.*\n\n> ${botConfig.BOT_FOOTER}`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: star - Star a quoted message (owner only)
case 'star': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        if (!quotedId) { await socket.sendMessage(sender, { text: '❌ *ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ sᴛᴀʀ*', quoted: fakevCard }); break; }
        const fromMe = msg.message?.extendedTextMessage?.contextInfo?.participant === socket.user.id;
        await socket.chatModify({ star: { messages: [{ id: quotedId, fromMe }], star: true } }, from);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '⭐ *ᴍᴇssᴀɢᴇ sᴛᴀʀʀᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '⭐ *ᴍᴇssᴀɢᴇ sᴛᴀʀʀᴇᴅ!*', quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: unstar - Unstar a quoted message (owner only)
case 'unstar': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        if (!quotedId) { await socket.sendMessage(sender, { text: '❌ *ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ ᴜɴsᴛᴀʀ*', quoted: fakevCard }); break; }
        const fromMe = msg.message?.extendedTextMessage?.contextInfo?.participant === socket.user.id;
        await socket.chatModify({ star: { messages: [{ id: quotedId, fromMe }], star: false } }, from);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: '⭐ *ᴍᴇssᴀɢᴇ ᴜɴsᴛᴀʀʀᴇᴅ!*\n\n> ' + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: '⭐ *ᴍᴇssᴀɢᴇ ᴜɴsᴛᴀʀʀᴇᴅ!*', quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: mydp - Profile picture privacy (owner only)
case 'mydp': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const choice = (args[0] || '').toLowerCase();
        const options = ['all', 'contacts', 'contact_blacklist', 'none'];
        if (!options.includes(choice)) {
            await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}mydp all/contacts/contact_blacklist/none\``, quoted: fakevCard }); break;
        }
        await socket.updateProfilePicturePrivacy(choice);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*\n\n> ` + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*`, quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: mystatus - Status privacy (owner only)
case 'mystatus': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const choice = (args[0] || '').toLowerCase();
        const options = ['all', 'contacts', 'contact_blacklist', 'none'];
        if (!options.includes(choice)) {
            await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}mystatus all/contacts/contact_blacklist/none\``, quoted: fakevCard }); break;
        }
        await socket.updateStatusPrivacy(choice);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `✅ *sᴛᴀᴛᴜs ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*\n\n> ` + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `✅ *sᴛᴀᴛᴜs ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*`, quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: groupadd - Group add privacy (owner only)
case 'groupadd': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const choice = (args[0] || '').toLowerCase();
        const options = ['all', 'contacts', 'contact_blacklist', 'none'];
        if (!options.includes(choice)) {
            await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}groupadd all/contacts/contact_blacklist/none\``, quoted: fakevCard }); break;
        }
        await socket.updateGroupsAddPrivacy(choice);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `✅ *ɢʀᴏᴜᴘ ᴀᴅᴅ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*\n\n> ` + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `✅ *ɢʀᴏᴜᴘ ᴀᴅᴅ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*`, quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: lastseen - Last seen privacy (owner only)
case 'lastseen': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const choice = (args[0] || '').toLowerCase();
        const options = ['all', 'contacts', 'contact_blacklist', 'none'];
        if (!options.includes(choice)) {
            await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}lastseen all/contacts/contact_blacklist/none\``, quoted: fakevCard }); break;
        }
        await socket.updateLastSeenPrivacy(choice);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `✅ *ʟᴀsᴛ sᴇᴇɴ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*\n\n> ` + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `✅ *ʟᴀsᴛ sᴇᴇɴ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*`, quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}

// Case: myonline - Online privacy (owner only)
case 'myonline': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: fakevCard }); break; }
        const choice = (args[0] || '').toLowerCase();
        const options = ['all', 'match_last_seen'];
        if (!options.includes(choice)) {
            await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}myonline all/match_last_seen\``, quoted: fakevCard }); break;
        }
        await socket.updateOnlinePrivacy(choice);
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `✅ *ᴏɴʟɪɴᴇ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*\n\n> ` + botConfig.BOT_FOOTER },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text: `✅ *ᴏɴʟɪɴᴇ ᴘʀɪᴠᴀᴄʏ sᴇᴛ ᴛᴏ:* ${choice}*`, quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}


// Case: bizprofile / bizp - Business profile info
case 'bizprofile':
case 'bizp': {
    try {
        const targetJid = args[0] ? `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net` : sender;
        const profile = await socket.getBusinessProfile(targetJid);
        const text = `🏢 *ʙᴜsɪɴᴇss ᴘʀᴏғɪʟᴇ*\n\n📝 *ᴅᴇsᴄ:* ${profile.description || 'N/A'}\n📂 *ᴄᴀᴛᴇɢᴏʀʏ:* ${profile.category || 'N/A'}`;
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: { message: { interactiveMessage: {
                    body: { text: `${text}\n\n> ${botConfig.BOT_FOOTER}` },
                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                    nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: '📢 Follow Channel', url: botConfig.CHANNEL_LINK }) }] }
                } } }
            }, { quoted: fakevCard });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch { await socket.sendMessage(sender, { text, quoted: fakevCard }); }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: fakevCard }); }
    break;
}
//view once test
//view once test
case 'viewonce':
case 'vv':
case 'reveal':
case 'unviewonce': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "👀",
            key: msg.key
        }
    });

    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

    try {
        // Extract quoted message from your structure
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedImage = quoted?.imageMessage;
        const quotedVideo = quoted?.videoMessage;

        if (quotedImage && quotedImage.viewOnce) {
            // Download and send the image
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await socket.sendMessage(
                sender, 
                { 
                    image: buffer, 
                    caption: quotedImage.caption || '📸 *View Once Image Revealed*',
                    fileName: 'revealed-image.jpg',
                    buttons: [
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 },
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴍᴇɴᴜ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
            
        } else if (quotedVideo && quotedVideo.viewOnce) {
            // Download and send the video
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await socket.sendMessage(
                sender, 
                { 
                    video: buffer, 
                    caption: quotedVideo.caption || '🎥 *View Once Video Revealed*',
                    fileName: 'revealed-video.mp4',
                    buttons: [
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 },
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴍᴇɴᴜ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
            
        } else {
            await socket.sendMessage(
                sender, 
                { 
                    text: '❌ *Please reply to a view-once image or video.*\n\n💡 *How to use:* Reply to a view-once message with `.viewonce`',
                    buttons: [
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                        { buttonId: `${prefix}owner`, buttonText: { displayText: 'ℹ️ ʜᴇʟᴘ' }, type: 1 },
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
        }

    } catch (error) {
        console.error('View Once Error:', error);
        
        await socket.sendMessage(
            sender, 
            { 
                text: `❌ *Failed to reveal view-once media*\n⚠️ *Error:* ${error.message || 'Unknown error'}`,
                buttons: [
                    { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: `${prefix}viewonce`, buttonText: { displayText: '🔄 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 },
                    { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 }
                ]
            }, 
            { quoted: msg }
        );
    }
    break;
}

//yts case 
case 'yts':
case 'ytsearch':
case 'search': {
  try {
    // Add reaction to indicate processing
    await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
    
    // Get search query from message
    const args = body.slice(botConfig.PREFIX.length).trim().split(' ');
    args.shift(); // Remove the command itself
    const query = args.join(' ');
    
    if (!query) {
      await socket.sendMessage(from, {
        text: "❌ *What should I search?*\n\nExample:\n.yts Adele Hello"
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
      break;
    }
    
    // Send searching message
    await socket.sendMessage(from, {
      text: "🔍 *Searching YouTube…*\nHold tight, summoning the algorithm gods."
    }, { quoted: msg });
    
    try {
      const result = await yts(query);
      const videos = result.videos.slice(0, 5);
      
      if (!videos.length) {
        await socket.sendMessage(from, {
          text: "😵 *No results found.*\nYouTube shrugged."
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        break;
      }
      
      let text = `🎬 *YouTube Search Results*\n\n`;
      
      videos.forEach((v, i) => {
        text +=
          `*${i + 1}. ${v.title}*\n` +
          `⏱ ${v.timestamp} | 👁 ${v.views.toLocaleString()}\n` +
          `📺 ${v.author.name}\n` +
          `🔗 ${v.url}\n\n`;
      });
      
      text += `> ✨ Powered by *caseyrhodes YouTube Engine*`;
      
      await socket.sendMessage(from, {
        image: { url: videos[0].thumbnail },
        caption: text
      }, { quoted: msg });
      
      await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
      
    } catch (err) {
      await socket.sendMessage(from, {
        text: `❌ *Search Error:*\n${err.message}`
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
  } catch (error) {
    console.error('YouTube search error:', error);
    await socket.sendMessage(from, {
      text: "❌ *Failed to process YouTube search*"
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
//image case 
// Pinterest Image Search Command
case 'img':
case 'image':
case 'pinterest':
case 'pin': {
    try {
        const query = args.join(" ");
        
        if (!query) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: `🖼️ *Please provide search keywords*\n\n*Example:* ${botConfig.PREFIX}img hacker setup`
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
        
        // Send searching message
        await socket.sendMessage(from, {
            text: `🔍 *Searching images for:* "${query}"\n⏳ Please wait...`
        }, { quoted: fakevCard });

        const apiUrl = `https://christus-api.vercel.app/image/Pinterest?query=${encodeURIComponent(query)}&limit=20`;
        
        const response = await axios.get(apiUrl, { timeout: 15000 });

        if (!response.data || !response.data.status || !Array.isArray(response.data.results) || response.data.results.length === 0) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '❌ *No images found* for your search query.'
            }, { quoted: fakevCard });
        }

        // Filter valid image URLs
        const images = response.data.results
            .filter(item => 
                item.imageUrl && 
                /\.(jpg|jpeg|png|webp)$/i.test(item.imageUrl)
            );

        if (images.length === 0) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '❌ *No valid images found* for your search query.'
            }, { quoted: fakevCard });
        }

        // Store images in session for navigation
        if (!botState.imageSessions) botState.imageSessions = {};
        const sessionId = `${sender}_${Date.now()}`;
        botState.imageSessions[sessionId] = {
            images: images,
            query: query,
            currentIndex: 0,
            total: images.length
        };

        // Send ONLY ONE image with buttons
        const currentImage = images[0];
        const title = currentImage.title && currentImage.title !== "No title" ? currentImage.title : query;
        
        // Create buttons for navigation
        const navigationButtons = [];
        
        // Add Previous button (disabled for first image)
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}img_nav ${sessionId} prev`,
            buttonText: { displayText: '⬅️ PREV' },
            type: 1
        });
        
        // Add Next button if there are more images
        if (images.length > 1) {
            navigationButtons.push({
                buttonId: `${botConfig.PREFIX}img_nav ${sessionId} next`,
                buttonText: { displayText: 'NEXT ➡️' },
                type: 1
            });
        }
        
        // Add Search Again button
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}img ${query}`,
            buttonText: { displayText: '🔍 SEARCH AGAIN' },
            type: 1
        });
        
        // Add Menu button
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}menu`,
            buttonText: { displayText: '📋 MAIN MENU' },
            type: 1
        });

        await socket.sendMessage(from, {
            image: { url: currentImage.imageUrl },
            caption: `🖼️ *Pinterest Image* ${1}/${images.length}\n\n` +
                    `📌 *Search:* ${query}\n` +
                    `📝 *Title:* ${title}\n\n` +
                    `> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 🎀`,
            buttons: navigationButtons,
            headerType: 1,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error("❌ Pinterest Image Error:", error.message);
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        await socket.sendMessage(from, {
            text: `❌ *Failed to fetch images*\n\n` +
                  `• Error: ${error.message || 'API connection failed'}\n` +
                  `• Try again with different keywords\n` +
                  `• Or try: ${botConfig.PREFIX}img wallpaper`
        }, { quoted: fakevCard });
    }
    break;
}

// Add navigation handler for image browsing
case 'img_nav': {
    try {
        const args2 = args;
        const sessionId = args2[0];
        const direction = args2[1];
        
        if (!sessionId || !direction || !botState.imageSessions || !botState.imageSessions[sessionId]) {
            return socket.sendMessage(from, {
                text: '❌ *Session expired*\nPlease search again using: ' + botConfig.PREFIX + 'img [query]'
            }, { quoted: fakevCard });
        }
        
        const session = botState.imageSessions[sessionId];
        let newIndex = session.currentIndex;
        
        if (direction === 'next') {
            newIndex = session.currentIndex + 1;
        } else if (direction === 'prev') {
            newIndex = session.currentIndex - 1;
        }
        
        if (newIndex < 0 || newIndex >= session.total) {
            return socket.sendMessage(from, {
                text: `❌ *No more images*\nYou are at the ${direction === 'next' ? 'last' : 'first'} image.`
            }, { quoted: fakevCard });
        }
        
        // Update current index
        session.currentIndex = newIndex;
        
        const currentImage = session.images[newIndex];
        const title = currentImage.title && currentImage.title !== "No title" ? currentImage.title : session.query;
        
        // Create updated navigation buttons
        const navigationButtons = [];
        
        // Add Previous button (disabled if at first)
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}img_nav ${sessionId} prev`,
            buttonText: { displayText: '⬅️ PREV' },
            type: 1
        });
        
        // Add Next button (disabled if at last)
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}img_nav ${sessionId} next`,
            buttonText: { displayText: 'NEXT ➡️' },
            type: 1
        });
        
        // Add Search Again button
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}img ${session.query}`,
            buttonText: { displayText: '🔍 SEARCH AGAIN' },
            type: 1
        });
        
        // Add Menu button
        navigationButtons.push({
            buttonId: `${botConfig.PREFIX}menu`,
            buttonText: { displayText: '📋 MAIN MENU' },
            type: 1
        });
        
        await socket.sendMessage(from, {
            image: { url: currentImage.imageUrl },
            caption: `🖼️ *Pinterest Image* ${newIndex + 1}/${session.total}\n\n` +
                    `📌 *Search:* ${session.query}\n` +
                    `📝 *Title:* ${title}\n\n` +
                    `> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 🎀`,
            buttons: navigationButtons,
            headerType: 1,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error("❌ Navigation Error:", error.message);
        await socket.sendMessage(from, {
            text: '❌ *Error navigating images*\nPlease search again.'
        }, { quoted: fakevCard });
    }
    break;
}
/// CASEYRHODESTECH ANIME CASE 
// Anime image commands
case 'garl':
case 'imgloli':
case 'loli': {
    await socket.sendMessage(sender, {
        react: {
            text: "😎",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.lolicon.app/setu/v2?num=1&r18=0&tag=lolicon');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.data[0].urls.original },
            caption: '😎 *Random Garl Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[LOLI ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch loli image. Please try again.'
        });
    }
    break;
}

case 'waifu':
case 'imgwaifu': {
    await socket.sendMessage(sender, {
        react: {
            text: "💫",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/waifu');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '💫 *Random Waifu Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[WAIFU ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch waifu image. Please try again.'
        });
    }
    break;
}

case 'neko':
case 'imgneko': {
    await socket.sendMessage(sender, {
        react: {
            text: "💫",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/neko');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '💫 *Random Neko Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[NEKO ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch neko image. Please try again.'
        });
    }
    break;
}

case 'megumin':
case 'imgmegumin': {
    await socket.sendMessage(sender, {
        react: {
            text: "💕",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/megumin');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '💕 *Random Megumin Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[MEGUMIN ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch megumin image. Please try again.'
        });
    }
    break;
}

case 'maid':
case 'imgmaid': {
    await socket.sendMessage(sender, {
        react: {
            text: "💫",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.im/search/?included_tags=maid');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.images[0].url },
            caption: '💫 *Random Maid Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[MAID ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch maid image. Please try again.'
        });
    }
    break;
}

case 'awoo':
case 'imgawoo': {
    await socket.sendMessage(sender, {
        react: {
            text: "😎",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/awoo');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '😎 *Random Awoo Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[AWOO ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch awoo image. Please try again.'
        });
    }
    break;
}

case 'animegirl':
case 'animegirl1':
case 'animegirl2':
case 'animegirl3':
case 'animegirl4':
case 'animegirl5': {
    await socket.sendMessage(sender, {
        react: {
            text: "🧚🏻",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/waifu');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '🧚🏻 *Random Anime Girl Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[ANIME GIRL ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch anime girl image. Please try again.'
        });
    }
    break;
}

case 'anime':
case 'anime1':
case 'anime2':
case 'anime3':
case 'anime4':
case 'anime5': {
    await socket.sendMessage(sender, {
        react: {
            text: "⛱️",
            key: msg.key
        }
    });
    
    try {
        // Different image sets based on command
        let images = [];
        
        switch(command) {
            case 'anime':
                images = [
                    'https://telegra.ph/file/b26f27aa5daaada031b90.jpg',
                    'https://telegra.ph/file/51b44e4b086667361061b.jpg',
                    'https://telegra.ph/file/7d165d73f914985542537.jpg',
                    'https://telegra.ph/file/3d9732d2657d2d72dc102.jpg',
                    'https://telegra.ph/file/8daf7e432a646f3ebe7eb.jpg',
                    'https://telegra.ph/file/7514b18ea89da924e7496.jpg',
                    'https://telegra.ph/file/ce9cb5acd2cec7693d76b.jpg'
                ];
                break;
            case 'anime1':
                images = [
                    'https://i.waifu.pics/aD7t0Bc.jpg',
                    'https://i.waifu.pics/PQO5wPN.jpg',
                    'https://i.waifu.pics/5At1P4A.jpg',
                    'https://i.waifu.pics/MjtH3Ha.jpg',
                    'https://i.waifu.pics/QQW7VKy.jpg'
                ];
                break;
            case 'anime2':
                images = [
                    'https://i.waifu.pics/0r1Bn88.jpg',
                    'https://i.waifu.pics/2Xdpuov.png',
                    'https://i.waifu.pics/0hx-3AP.png',
                    'https://i.waifu.pics/q054x0_.png',
                    'https://i.waifu.pics/4lyqRvd.jpg'
                ];
                break;
            case 'anime3':
                images = [
                    'https://i.waifu.pics/gnpc_Lr.jpeg',
                    'https://i.waifu.pics/P6X-ph6.jpg',
                    'https://i.waifu.pics/~p5W9~k.png',
                    'https://i.waifu.pics/7Apu5C9.jpg',
                    'https://i.waifu.pics/OTRfON6.jpg'
                ];
                break;
            case 'anime4':
                images = [
                    'https://i.waifu.pics/aGgUm80.jpg',
                    'https://i.waifu.pics/i~RQhRD.png',
                    'https://i.waifu.pics/94LH-aU.jpg',
                    'https://i.waifu.pics/V8hvqfK.jpg',
                    'https://i.waifu.pics/lMiXE7j.png'
                ];
                break;
            case 'anime5':
                images = [
                    'https://i.waifu.pics/-ABlAvr.jpg',
                    'https://i.waifu.pics/HNEg0-Q.png',
                    'https://i.waifu.pics/3x~ovC6.jpg',
                    'https://i.waifu.pics/brv-GJu.jpg',
                    'https://i.waifu.pics/FWE8ggD.png'
                ];
                break;
            default:
                images = [
                    'https://telegra.ph/file/b26f27aa5daaada031b90.jpg',
                    'https://telegra.ph/file/51b44e4b086667361061b.jpg'
                ];
        }
        
        // Send images one by one
        for (let i = 0; i < Math.min(images.length, 3); i++) { // Limit to 3 images
            await socket.sendMessage(sender, {
                image: { url: images[i] },
                caption: i === 0 ? '⛱️ *Anime Images*\n\n© CaseyRhodes XMD' : ''
            });
            if (i < images.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between images
            }
        }
        
    } catch (e) {
        console.error('[ANIME IMAGES ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch anime images. Please try again.'
        });
    }
    break;
}
//caseyrhodes logo Caseyrhodes 
// 🎌 ANIME & GAME LOGOS
case 'dragonball': {
    await socket.sendMessage(sender, { react: { text: "🐉", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🐉 DRAGON BALL LOGO*\n\nPlease provide text\nExample: *${prefix}dragonball YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*🐉 Generating Dragon Ball Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-dragon-ball-style-text-effects-online-809.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🐉 DRAGON BALL LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}dragonball ${query}`, buttonText: { displayText: '✨ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Dragonball logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Dragon Ball logo`
        }, { quoted: msg });
    }
    break;
}

case 'naruto': {
    await socket.sendMessage(sender, { react: { text: "🌀", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🌀 NARUTO LOGO*\n\nPlease provide text\nExample: *${prefix}naruto YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*🌀 Generating Naruto Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/naruto-shippuden-logo-style-text-effect-online-808.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🌀 NARUTO LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}naruto ${query}`, buttonText: { displayText: '🌀 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Naruto logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Naruto logo`
        }, { quoted: msg });
    }
    break;
}

case 'arena': {
    await socket.sendMessage(sender, { react: { text: "⚔️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*⚔️ ARENA LOGO*\n\nPlease provide text\nExample: *${prefix}arena YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*⚔️ Generating Arena Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*⚔️ ARENA LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}arena ${query}`, buttonText: { displayText: '⚔️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Arena logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Arena logo`
        }, { quoted: msg });
    }
    break;
}

// 💻 MODERN & TECH LOGOS
case 'hacker': {
    await socket.sendMessage(sender, { react: { text: "💻", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💻 HACKER LOGO*\n\nPlease provide text\nExample: *${prefix}hacker YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*💻 Generating Hacker Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💻 HACKER LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}hacker ${query}`, buttonText: { displayText: '💻 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Hacker logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Hacker logo`
        }, { quoted: msg });
    }
    break;
}

case 'mechanical': {
    await socket.sendMessage(sender, { react: { text: "⚙️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*⚙️ MECHANICAL LOGO*\n\nPlease provide text\nExample: *${prefix}mechanical YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*⚙️ Generating Mechanical Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-your-name-in-a-mechanical-style-306.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*⚙️ MECHANICAL LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}mechanical ${query}`, buttonText: { displayText: '⚙️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Mechanical logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Mechanical logo`
        }, { quoted: msg });
    }
    break;
}

case 'incandescent': {
    await socket.sendMessage(sender, { react: { text: "💡", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💡 INCANDESCENT LOGO*\n\nPlease provide text\nExample: *${prefix}incandescent YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*💡 Generating Incandescent Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/text-effects-incandescent-bulbs-219.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💡 INCANDESCENT LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}incandescent ${query}`, buttonText: { displayText: '💡 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Incandescent logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Incandescent logo`
        }, { quoted: msg });
    }
    break;
}

case 'gold': {
    await socket.sendMessage(sender, { react: { text: "🏆", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🏆 GOLD LOGO*\n\nPlease provide text\nExample: *${prefix}gold YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*🏆 Generating Gold Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/modern-gold-4-213.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🏆 GOLD LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}gold ${query}`, buttonText: { displayText: '🏆 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Gold logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Gold logo`
        }, { quoted: msg });
    }
    break;
}

// 🌈 NATURE & EFFECT LOGOS
case 'sand': {
    await socket.sendMessage(sender, { react: { text: "🏖️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🏖️ SAND LOGO*\n\nPlease provide text\nExample: *${prefix}sand YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🏖️ SAND LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}sand ${query}`, buttonText: { displayText: '🏖️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Sand logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Sand logo`
        }, { quoted: msg });
    }
    break;
}

case 'sunset': {
    await socket.sendMessage(sender, { react: { text: "🌅", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🌅 SUNSET LOGO*\n\nPlease provide text\nExample: *${prefix}sunset YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-sunset-light-text-effects-online-807.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🌅 SUNSET LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}sunset ${query}`, buttonText: { displayText: '🌅 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Sunset logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Sunset logo`
        }, { quoted: msg });
    }
    break;
}

case 'water': {
    await socket.sendMessage(sender, { react: { text: "💧", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💧 WATER LOGO*\n\nPlease provide text\nExample: *${prefix}water YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-water-effect-text-online-295.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💧 WATER LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}water ${query}`, buttonText: { displayText: '💧 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Water logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Water logo`
        }, { quoted: msg });
    }
    break;
}

case 'rain': {
    await socket.sendMessage(sender, { react: { text: "🌧️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🌧️ RAIN LOGO*\n\nPlease provide text\nExample: *${prefix}rain YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/foggy-rainy-text-effect-75.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🌧️ RAIN LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}rain ${query}`, buttonText: { displayText: '🌧️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Rain logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Rain logo`
        }, { quoted: msg });
    }
    break;
}

// 🎨 ART & CREATIVE LOGOS
case 'chocolate': {
    await socket.sendMessage(sender, { react: { text: "🍫", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🍫 CHOCOLATE LOGO*\n\nPlease provide text\nExample: *${prefix}chocolate YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/chocolate-text-effect-353.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🍫 CHOCOLATE LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}chocolate ${query}`, buttonText: { displayText: '🍫 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Chocolate logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Chocolate logo`
        }, { quoted: msg });
    }
    break;
}

case 'graffiti': {
    await socket.sendMessage(sender, { react: { text: "🎨", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🎨 GRAFFITI LOGO*\n\nPlease provide text\nExample: *${prefix}graffiti YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-a-cartoon-style-graffiti-text-effect-online-668.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🎨 GRAFFITI LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}graffiti ${query}`, buttonText: { displayText: '🎨 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Graffiti logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Graffiti logo`
        }, { quoted: msg });
    }
    break;
}

case 'boom': {
    await socket.sendMessage(sender, { react: { text: "💥", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💥 BOOM LOGO*\n\nPlease provide text\nExample: *${prefix}boom YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/boom-text-comic-style-text-effect-675.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💥 BOOM LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}boom ${query}`, buttonText: { displayText: '💥 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Boom logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Boom logo`
        }, { quoted: msg });
    }
    break;
}

case 'purple': {
    await socket.sendMessage(sender, { react: { text: "🟣", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🟣 PURPLE LOGO*\n\nPlease provide text\nExample: *${prefix}purple YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/purple-text-effect-online-100.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🟣 PURPLE LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}purple ${query}`, buttonText: { displayText: '🟣 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Purple logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Purple logo`
        }, { quoted: msg });
    }
    break;
}

// 📝 TEXT & TYPOGRAPHY LOGOS
case 'cloth': {
    await socket.sendMessage(sender, { react: { text: "👕", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*👕 CLOTH LOGO*\n\nPlease provide text\nExample: *${prefix}cloth YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/text-on-cloth-effect-62.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*👕 CLOTH LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}cloth ${query}`, buttonText: { displayText: '👕 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Cloth logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Cloth logo`
        }, { quoted: msg });
    }
    break;
}

case '1917': {
    await socket.sendMessage(sender, { react: { text: "🎬", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🎬 1917 LOGO*\n\nPlease provide text\nExample: *${prefix}1917 YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/1917-style-text-effect-523.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🎬 1917 LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}1917 ${query}`, buttonText: { displayText: '🎬 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('1917 logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate 1917 logo`
        }, { quoted: msg });
    }
    break;
}

case 'child': {
    await socket.sendMessage(sender, { react: { text: "👶", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*👶 CHILD LOGO*\n\nPlease provide text\nExample: *${prefix}child YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/write-text-on-wet-glass-online-589.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*👶 CHILD LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}child ${query}`, buttonText: { displayText: '👶 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Child logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Child logo`
        }, { quoted: msg });
    }
    break;
}

case 'cat': {
    await socket.sendMessage(sender, { react: { text: "🐱", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🐱 CAT LOGO*\n\nPlease provide text\nExample: *${prefix}cat YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/handwritten-text-on-foggy-glass-online-680.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🐱 CAT LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}cat ${query}`, buttonText: { displayText: '🐱 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Cat logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Cat logo`
        }, { quoted: msg });
    }
    break;
}

case 'typo': {
    await socket.sendMessage(sender, { react: { text: "📝", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*📝 TYPO LOGO*\n\nPlease provide text\nExample: *${prefix}typo YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/typography-text-effect-on-pavement-online-774.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*📝 TYPO LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}typo ${query}`, buttonText: { displayText: '📝 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Typo logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Typo logo`
        }, { quoted: msg });
    }
    break;
}

//screenshot case
case 'screenshot':
case 'ss':
case 'ssweb': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const url = args[0];

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid URL.*\nExample: `.screenshot https://github.com`'
            }, { quoted: msg });
        }

        // Validate the URL
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid URL.* Please include "http://" or "https://".'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Generate the screenshot URL using Thum.io API
        const screenshotUrl = `https://image.thum.io/get/fullpage/${url}`;

        // Send the screenshot as an image message
        await socket.sendMessage(sender, {
            image: { url: screenshotUrl },
            caption: `🌐 *Website Screenshot*\n\n🔗 *URL:* ${url}\n\n> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: 'Website Screenshot',
                    body: 'Powered by Thum.io API',
                    mediaType: 1,
                    sourceUrl: url,
                    thumbnailUrl: screenshotUrl
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("Screenshot Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        
        await socket.sendMessage(sender, {
            text: '❌ *Failed to capture the screenshot.*\nThe website may be blocking screenshots or the URL might be invalid.'
        }, { quoted: msg });
    }
    break;
}
//tts case
case 'tts': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🔊",
            key: msg.key
        }
    });

    const googleTTS = require('google-tts-api');

    try {
        // Extract text from message
        const q = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
        
        const args = q.split(' ').slice(1);
        const text = args.join(' ').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text: "❌ *Please provide some text to convert to speech.*\n\n*Example:* .tts Hello world"
            }, { quoted: msg });
        }

        const url = googleTTS.getAudioUrl(text, {
            lang: 'en-US',
            slow: false,
            host: 'https://translate.google.com',
        });

        // Send the audio
        await socket.sendMessage(sender, { 
            audio: { url: url }, 
            mimetype: 'audio/mpeg', 
            ptt: false,
            caption: `🔊 *Text to Speech*\n📝 *Text:* ${text}\n\n✨ *Powered by CASEYRHODES-TECH*`
        }, { quoted: msg });

    } catch (e) {
        console.error('TTS Error:', e);
        await socket.sendMessage(sender, {
            text: `❌ *Error:* ${e.message || e}`
        }, { quoted: msg });
    }
    break;
}
//fetch case
//fetch case
case 'fetch':
case 'get':
case 'api': {
    try {
        await socket.sendMessage(sender, { react: { text: '🌐', key: msg.key } });

        // Use the already parsed command arguments when available; this avoids
        // breaking when the command arrives as an extendedTextMessage.
        const rawUrl = (args || []).join(' ').trim() ||
            String(msg.message?.conversation || msg.message?.extendedTextMessage?.text || '')
                .replace(/^\s*[.!#/]?(fetch|get|api)\s*/i, '').trim();

        if (!rawUrl) {
            await socket.sendMessage(sender, {
                text: `🌐 *FETCH COMMAND*\n\nUsage: *${prefix}fetch <url>*\n\nExample:\n${prefix}fetch https://api.github.com/users/octocat\n\nThe URL must start with http:// or https://`,
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        let target;
        try {
            target = new URL(rawUrl);
        } catch {
            await socket.sendMessage(sender, {
                text: `❌ *Invalid URL*\n\nPlease provide a complete URL beginning with *https://* or *http://*.`,
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        if (!/^https?:$/.test(target.protocol)) {
            await socket.sendMessage(sender, {
                text: '❌ Only HTTP and HTTPS URLs are supported.',
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        const loading = await socket.sendMessage(sender, {
            text: `🌐 *Fetching URL...*\n\n🔗 ${target.toString()}`
        }, { quoted: fakevCard });

        try {
            const axios = require('axios');
            const response = await axios.get(target.toString(), {
                timeout: 20000,
                maxRedirects: 5,
                responseType: 'arraybuffer',
                validateStatus: () => true,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
                    'Accept': 'application/json,text/plain,text/html,application/xml,*/*'
                }
            });

            const contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
            const buffer = Buffer.from(response.data || '');
            const status = Number(response.status || 0);

            if (status >= 400) {
                throw new Error(`HTTP ${status}${response.statusText ? ` ${response.statusText}` : ''}`);
            }

            const isText = /^(application\/json|application\/javascript|text\/|application\/xml|application\/rss\+xml|application\/atom\+xml)/i.test(contentType);
            const maxText = 12000;

            // Send non-text responses as a file instead of corrupting binary data.
            if (!isText) {
                const ext = contentType.includes('pdf') ? 'pdf'
                    : contentType.includes('zip') ? 'zip'
                    : contentType.includes('image') ? 'bin'
                    : contentType.includes('audio') ? 'bin'
                    : contentType.includes('video') ? 'bin'
                    : 'bin';

                await socket.sendMessage(sender, {
                    document: buffer,
                    fileName: `fetched_${Date.now()}.${ext}`,
                    mimetype: contentType || 'application/octet-stream',
                    caption: `🌐 *FETCH COMPLETE*\n\n🔗 *URL:* ${target.toString()}\n📡 *Status:* ${status}\n📦 *Type:* ${contentType || 'unknown'}\n📏 *Size:* ${buffer.length} bytes\n\n> ${botConfig.BOT_FOOTER}`
                }, { quoted: fakevCard });
            } else {
                let text = buffer.toString('utf8');
                if (contentType === 'application/json') {
                    try {
                        text = JSON.stringify(JSON.parse(text), null, 2);
                    } catch {}
                }

                const truncated = text.length > maxText;
                const shown = truncated ? text.slice(0, maxText) : text;
                const caption = `🌐 *FETCH COMPLETE*\n\n🔗 *URL:* ${target.toString()}\n📡 *Status:* ${status}\n📄 *Type:* ${contentType || 'text/plain'}\n📏 *Size:* ${buffer.length} bytes${truncated ? '\n⚠️ Output shortened; full response attached.' : ''}\n\n[1;1H[0J`;

                if (truncated) {
                    await socket.sendMessage(sender, {
                        document: Buffer.from(text, 'utf8'),
                        fileName: `fetched_${Date.now()}.${contentType === 'application/json' ? 'json' : 'txt'}`,
                        mimetype: contentType === 'application/json' ? 'application/json' : 'text/plain',
                        caption: `${caption}\n> ${botConfig.BOT_FOOTER}`
                    }, { quoted: fakevCard });
                } else {
                    await socket.sendMessage(sender, {
                        text: `${caption}\n\n\`\`\`\n${shown}\n\`\`\`\n\n> ${botConfig.BOT_FOOTER}`,
                        buttons: [
                            { buttonId: `${prefix}fetch ${target.toString()}`, buttonText: { displayText: '🔄 FETCH AGAIN' }, type: 1 },
                            { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                        ],
                        headerType: 1
                    }, { quoted: fakevCard });
                }
            }

            try { await socket.sendMessage(sender, { delete: loading.key }); } catch {}
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        } catch (error) {
            try { await socket.sendMessage(sender, { delete: loading.key }); } catch {}
            throw error;
        }
    } catch (error) {
        console.error('[Fetch] Error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *FETCH FAILED*\n\n${error.message || 'Unable to fetch the URL.'}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}fetch`, buttonText: { displayText: '🔄 TRY AGAIN' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });
        try { await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch {}
    }
    break;
}
//case wallpaper 
case 'rw':
case 'randomwall':
case 'wallpaper': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ') || 'random';

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Send fetching message
        await socket.sendMessage(sender, {
            text: `🔍 *Fetching wallpaper for* \"${query}\"...`
        }, { quoted: msg });

        const apiUrl = `https://pikabotzapi.vercel.app/random/randomwall/?apikey=anya-md&query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { timeout: 15000 });

        if (!data?.status || !data?.imgUrl) {
            await socket.sendMessage(sender, {
                text: `❌ *No wallpaper found for* \"${query}\" 😔\nTry a different keyword.`
            }, { quoted: msg });
            
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return;
        }

        const caption = `
╭━━〔*🌌 ᴡᴀʟʟᴘᴀᴘᴇʀ* 〕━━┈⊷
├ *ᴋᴇʏᴡᴏʀᴅ*: ${query}
╰──────────────┈⊷
> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send wallpaper with buttons
        const wallpaperMessage = {
            image: { url: data.imgUrl },
            caption: caption,
            footer: 'Choose an option below',
            buttons: [
                {
                    buttonId: `.rw ${query}`,
                    buttonText: { displayText: '🔄 Another' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '❓ Help' },
                    type: 1
                }
            ],
            headerType: 4,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                externalAdReply: {
                    title: 'Random Wallpaper',
                    body: `Keyword: ${query}`,
                    mediaType: 1,
                    sourceUrl: data.imgUrl,
                    thumbnailUrl: data.imgUrl
                }
            }
        };

        await socket.sendMessage(sender, wallpaperMessage, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Wallpaper error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        let errorMsg = '❌ *Failed to fetch wallpaper* 😞';
        
        if (error.message.includes('timeout')) {
            errorMsg = '❌ *Request timed out* ⏰\nPlease try again.';
        } else if (error.code === 'ENOTFOUND') {
            errorMsg = '❌ *API service unavailable* 🔧\nTry again later.';
        } else if (error.response?.status === 404) {
            errorMsg = '❌ *Wallpaper API not found* 🚫';
        }

        await socket.sendMessage(sender, {
            text: errorMsg
        }, { quoted: msg });
    }
    break;
}
//case URL 
case 'tourl':
case 'upload':
case 'tourl2': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mediaMsg = (quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) ||
                        msg.message?.imageMessage ||
                        msg.message?.videoMessage ||
                        msg.message?.audioMessage;

        if (!mediaMsg) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: `⚠️ Reply to image/video/audio with *${botConfig.PREFIX}tourl*`
            }, { quoted: fakevCard });
        }

        const mime = mediaMsg.mimetype || '';
        if (!/image|video|audio/.test(mime)) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '⚠️ Only images, videos & audio allowed'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        // Download media
        const stream = await downloadContentFromMessage(mediaMsg, mime.split('/')[0]);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Create temp file
        const ext = mime.split('/')[1] || 'bin';
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFile = path.join(tempDir, `catbox_${Date.now()}.${ext}`);
        fs.writeFileSync(tempFile, buffer);

        // Upload to Catbox
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(tempFile));

        const response = await axios.post('https://catbox.moe/user/api.php', form, { 
            headers: form.getHeaders(),
            timeout: 30000 
        });
        
        const url = response.data?.trim();
        fs.unlinkSync(tempFile);

        if (!url || !url.startsWith('https')) {
            throw new Error("Upload failed");
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        // Send success message with ONE button
        await socket.sendMessage(from, {
            text: `✅ *Upload Successful!*\n🔗 ${url}`,
            buttons: [
                {
                    urlButton: {
                        displayText: "🔗 Open URL",
                        url: url
                    }
                }
            ]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('❌ Tourl Error:', error);
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        await socket.sendMessage(from, {
            text: `❌ Upload failed: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: quran
// Case: quran
case 'quran': {
    try {
        const query = args.join(' ');

        if (!query) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: `☪️ *Example:* ${botConfig.PREFIX}quran 2:255\n\n👉 *Format:* Surah:Ayah (e.g., 2:255 for Ayatul Kursi)`
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '📿', key: msg.key } });

        const [surah, ayah] = query.split(':');

        if (!surah || !ayah) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '❌ *Please use format:* Surah:Ayah\n*Example:* 2:255'
            }, { quoted: fakevCard });
        }

        const response = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/en.asad`);
        
        if (!response.data || !response.data.data) {
            throw new Error('Invalid response from Quran API');
        }

        const verse = response.data.data;

        const verseText = `🕋 *QURAN VERSE* 🕋\n\n` +
                  `━━━━━━━━━━━━━━━━\n\n` +
                  `📖 *Surah:* ${verse.surah.englishName}\n` +
                  `📝 *Translation:* ${verse.surah.englishNameTranslation}\n` +
                  `🔢 *Ayah Number:* ${verse.numberInSurah}\n` +
                  `📍 *Juz:* ${verse.juz}\n\n` +
                  `✨ *Verse:*\n"${verse.text}"\n\n` +
                  `━━━━━━━━━━━━━━━━\n` +
                  `> ${botConfig.BOT_FOOTER}`;

        // ONE message with verse + CTA buttons
        try {
            const ctaMsg = generateWAMessageFromContent(
                from,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: verseText },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📋 Copy Verse',
                                                copy_code: `${verse.text}\n\n— Surah ${verse.surah.englishName} (${surah}:${ayah})`
                                            })
                                        },
                                        {
                                            name: 'cta_crl',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(from, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            // Fallback if interactive message fails
            await socket.sendMessage(from, {
                text: verseText,
                buttons: [
                    { buttonId: `${prefix}quran ${surah}:${ayah}`, buttonText: { displayText: '📋 Copy Verse' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('❌ Quran Command Error:', error);
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        await socket.sendMessage(from, {
            text: `⚠️ *Unable to fetch Quran verse*\n\n` +
                  `• Please check Surah and Ayah numbers\n` +
                  `• Make sure format is correct (e.g., 2:255)\n` +
                  `• Try again with a valid verse\n\n` +
                  `*Example:* ${botConfig.PREFIX}quran 1:1`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: bible
case 'bible': {
    await socket.sendMessage(sender, { react: { text: '📖', key: msg.key } });

    const reference = args.join(' ').trim();

    if (!reference) {
        return await socket.sendMessage(sender, {
            text: `⚠️ *Please provide a Bible reference.*\n\n📝 *Example:*\n.bible John 1:1`
        }, { quoted: fakevCard });
    }

    try {
        const apiUrl = `https://bible-api.com/${encodeURIComponent(reference)}`;
        const response = await axios.get(apiUrl, { timeout: 10000 });

        if (response.status === 200 && response.data.text) {
            const ref = response.data.reference;
            const text = response.data.text;
            const translation_name = response.data.translation_name;
            const verseText = `📜 *Bible Verse Found!*\n\n` +
                         `📖 *Reference:* ${ref}\n` +
                         `📚 *Text:* ${text}\n\n` +
                         `🗂️ *Translation:* ${translation_name}\n\n` +
                         `> © CASEYRHODES XMD BIBLE`;

            // ONE message with CTA buttons (no image)
            try {
                const ctaMsg = generateWAMessageFromContent(
                    sender,
                    {
                        viewOnceMessage: {
                            message: {
                                interactiveMessage: {
                                    body: { text: verseText },
                                    footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                    nativeFlowMessage: {
                                        buttons: [
                                            {
                                                name: 'cta_copy',
                                                buttonParamsJson: JSON.stringify({
                                                    display_text: '📋 Copy Verse',
                                                    copy_code: `${text}\n\n— ${ref} (${translation_name})`
                                                })
                                            },
                                            {
                                                name: 'cta_url',
                                                buttonParamsJson: JSON.stringify({
                                                    display_text: '📢 Join Channel',
                                                    url: botConfig.CHANNEL_LINK
                                                })
                                            },
                                            {
                                                name: 'cta_url',
                                                buttonParamsJson: JSON.stringify({
                                                    display_text: '⭐ GitHub Repo',
                                                    url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                                                })
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    },
                    { quoted: fakevCard }
                );
                await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
            } catch {
                await socket.sendMessage(sender, {
                    image: { url: 'https://files.catbox.moe/y3j3kl.jpg' },
                    caption: verseText,
                    buttons: [
                        { buttonId: `${prefix}bible`, buttonText: { displayText: '🔍 Search Another' }, type: 1 }
                    ],
                    headerType: 1
                }, { quoted: fakevCard });
            }

        } else {
            await socket.sendMessage(sender, {
                text: "❌ *Verse not found.* Please check the reference and try again."
            }, { quoted: fakevCard });
        }
    } catch (error) {
        console.error('Bible Error:', error);
        if (error.response && error.response.status === 404) {
            await socket.sendMessage(sender, {
                text: "❌ *Verse not found.* Please check the reference and try again."
            }, { quoted: fakevCard });
        } else {
            await socket.sendMessage(sender, {
                text: "⚠️ *An error occurred.* Please try again."
            }, { quoted: fakevCard });
        }
    }
    break;
}
// Case: compliment / comp / praise - Send a random compliment
case 'compliment':
case 'comp':
case 'praise': {
    try {
        const COMPLIMENTS = [
            "ʏᴏᴜ ᴍᴀᴋᴇ ᴛʜᴇ ᴡᴏʀʟᴅ ᴀ ʙᴇᴛᴛᴇʀ ᴘʟᴀᴄᴇ ᴊᴜsᴛ ʙʏ ʙᴇɪɴɢ ɪɴ ɪᴛ. 🌟",
            "ʏᴏᴜʀ sᴍɪʟᴇ ᴄᴏᴜʟᴅ ʟɪɢʜᴛ ᴜᴘ ᴛʜᴇ ᴅᴀʀᴋᴇsᴛ ʀᴏᴏᴍ. ✨",
            "ʏᴏᴜ ʜᴀᴠᴇ ᴀɴ ɪɴᴄʀᴇᴅɪʙʟᴇ ᴀʙɪʟɪᴛʏ ᴛᴏ ᴍᴀᴋᴇ ᴇᴠᴇʀʏᴏɴᴇ ғᴇᴇʟ ᴡᴇʟᴄᴏᴍᴇ.",
            "ʏᴏᴜʀ ᴋɪɴᴅɴᴇss ɪs ᴀ ʀᴀʀᴇ ᴀɴᴅ ʙᴇᴀᴜᴛɪғᴜʟ ɢɪғᴛ ᴛᴏ ᴛʜᴇ ᴡᴏʀʟᴅ. 🎁",
            "ʏᴏᴜ ᴀʀᴇ ᴍᴏʀᴇ ʀᴇsɪʟɪᴇɴᴛ ᴛʜᴀɴ ʏᴏᴜ ɢɪᴠᴇ ʏᴏᴜʀsᴇʟғ ᴄʀᴇᴅɪᴛ ғᴏʀ. 💪",
            "ᴛʜᴇ ᴡᴀʏ ʏᴏᴜ ᴄᴀʀʀʏ ʏᴏᴜʀsᴇʟғ ɪɴsᴘɪʀᴇs ᴘᴇᴏᴘʟᴇ ᴀʀᴏᴜɴᴅ ʏᴏᴜ.",
            "ʏᴏᴜʀ ᴄʀᴇᴀᴛɪᴠɪᴛʏ ɪs ɢᴇɴᴜɪɴᴇʟʏ ɪᴍᴘʀᴇssɪᴠᴇ. 🎨",
            "ʏᴏᴜ ʜᴀɴᴅʟᴇ ᴄʜᴀʟʟᴇɴɢᴇs ᴡɪᴛʜ sᴜᴄʜ ɢʀᴀᴄᴇ ᴀɴᴅ sᴛʀᴇɴɢᴛʜ.",
            "ᴘᴇᴏᴘʟᴇ ᴀʀᴇ ʟᴜᴄᴋʏ ᴛᴏ ʜᴀᴠᴇ ʏᴏᴜ ɪɴ ᴛʜᴇɪʀ ʟɪᴠᴇs. 🍀",
            "ʏᴏᴜʀ sᴇɴsᴇ ᴏғ ʜᴜᴍᴏʀ ʙʀɪɴɢs sᴏ ᴍᴜᴄʜ ᴊᴏʏ ᴛᴏ ᴏᴛʜᴇʀs. 😄",
            "ʏᴏᴜ ʜᴀᴠᴇ ᴀ ʜᴇᴀʀᴛ ᴏғ ɢᴏʟᴅ. 💛",
            "ʏᴏᴜ'ʀᴇ ᴅᴏɪɴɢ ʙᴇᴛᴛᴇʀ ᴛʜᴀɴ ʏᴏᴜ ᴛʜɪɴᴋ. ᴋᴇᴇᴘ ɢᴏɪɴɢ!",
            "ʏᴏᴜʀ ɪɴᴛᴇʟʟɪɢᴇɴᴄᴇ ᴀɴᴅ ᴛʜᴏᴜɢʜᴛғᴜʟɴᴇss ᴀʀᴇ ᴛʀᴜʟʏ ʀᴇᴍᴀʀᴋᴀʙʟᴇ.",
            "ʏᴏᴜ ᴍᴀᴋᴇ ʜᴀʀᴅ ᴛʜɪɴɢs ʟᴏᴏᴋ ᴇᴀsʏ — ᴛʜᴀᴛ's ᴀ ʀᴇᴀʟ ᴛᴀʟᴇɴᴛ.",
            "ʙᴇɪɴɢ ᴀʀᴏᴜɴᴅ ʏᴏᴜ ғᴇᴇʟs ʟɪᴋᴇ ᴀ ʙʀᴇᴀᴛʜ ᴏғ ғʀᴇsʜ ᴀɪʀ. 🌬️",
            "ʏᴏᴜ ʙʀɪɴɢ ᴏᴜᴛ ᴛʜᴇ ʙᴇsᴛ ɪɴ ᴛʜᴇ ᴘᴇᴏᴘʟᴇ ᴀʀᴏᴜɴᴅ ʏᴏᴜ. 🌸",
            "ʏᴏᴜʀ ᴅᴇᴅɪᴄᴀᴛɪᴏɴ ᴀɴᴅ ᴡᴏʀᴋ ᴇᴛʜɪᴄ ᴀʀᴇ ᴛʀᴜʟʏ ᴀᴅᴍɪʀᴀʙʟᴇ. 🏆",
            "ʏᴏᴜ ʜᴀᴠᴇ ᴀ ʙᴇᴀᴜᴛɪғᴜʟ ᴍɪɴᴅ ᴀɴᴅ ᴀɴ ᴇᴠᴇɴ ᴍᴏʀᴇ ʙᴇᴀᴜᴛɪғᴜʟ sᴏᴜʟ.",
            "ᴛʜᴇ ᴡᴏʀʟᴅ ɪs ɢᴇɴᴜɪɴᴇʟʏ ʙᴇᴛᴛᴇʀ ᴡɪᴛʜ ʏᴏᴜ ɪɴ ɪᴛ. 🌍",
            "ʏᴏᴜ ᴀʀᴇ ᴇxᴀᴄᴛʟʏ ᴡʜᴏ ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ʙᴇ. 🔥",
        ];

        await socket.sendMessage(sender, { react: { text: '💐', key: msg.key } });

        const pick = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)];
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        
        const target = mentioned.length
            ? `@${mentioned[0].split('@')[0]}, ${pick.charAt(0).toLowerCase() + pick.slice(1)}`
            : pick;

        await socket.sendMessage(sender, {
            text: `💐 *ᴄᴏᴍᴘʟɪᴍᴇɴᴛ*\n\n${target}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}comp`, buttonText: { displayText: '💐 ᴀɴᴏᴛʜᴇʀ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Compliment] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//delete case 
case 'delete':
case 'del':
case 'd': {
    try {
        // Check if the message is a reply
        if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please reply to a message to delete it!*'
            }, { quoted: msg });
        }

        const quoted = msg.message.extendedTextMessage.contextInfo;
        const isGroup = sender.endsWith('@g.us');
        
        // For groups - check if user is admin
        if (isGroup) {
            try {
                const groupMetadata = await socket.groupMetadata(sender);
                const participant = msg.key.participant || msg.key.remoteJid;
                const isAdmins = groupMetadata.participants.find(p => p.id === participant)?.admin;
                const isOwner = groupMetadata.owner === participant;
                
                if (!isAdmins && !isOwner) {
                    return await socket.sendMessage(sender, {
                        text: '❌ *You need admin rights to delete messages in groups!*'
                    }, { quoted: msg });
                }
            } catch (groupError) {
                console.error('Group metadata error:', groupError);
            }
        }

        // Delete the quoted message
        const deleteParams = {
            remoteJid: sender,
            id: quoted.stanzaId,
            participant: quoted.participant,
            fromMe: quoted.participant === (msg.key.participant || msg.key.remoteJid)
        };

        await socket.sendMessage(sender, { delete: deleteParams });

        // Send success message with button instead of deleting command
        const successMessage = {
            text: '✅ *Message deleted successfully!*',
            buttons: [
                {
                    buttonId: '.delete',
                    buttonText: { displayText: '🗑️ Delete Another' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '🎌Help' },
                    type: 1
                }
            ],
            footer: 'Powered by CASEYRHODES XTECH',
            headerType: 1
        };

        await socket.sendMessage(sender, successMessage, { quoted: msg });

    } catch (error) {
        console.error('Delete error:', error);
        
        // Send error message with button
        const errorMessage = {
            text: `❌ *Failed to delete message!*\n${error.message || 'Unknown error'}`,
            buttons: [
                {
                    buttonId: '.allmenu',
                    buttonText: { displayText: '❓ Get Help' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '🆘 Support' },
                    type: 1
                }
            ],
            footer: 'Powered by caseyrhodes 🌸',
            headerType: 1
        };
        
        await socket.sendMessage(sender, errorMessage, { quoted: msg });
    }
    break;
}
//jid case
// Case: time / clock / timezone - Get current time in any city
case 'time':
case 'clock':
case 'timezone': {
    try {
        const ZONES = {
            nairobi:'Africa/Nairobi', kenya:'Africa/Nairobi', lagos:'Africa/Lagos',
            cairo:'Africa/Cairo', london:'Europe/London', paris:'Europe/Paris',
            berlin:'Europe/Berlin', dubai:'Asia/Dubai', india:'Asia/Kolkata',
            delhi:'Asia/Kolkata', tokyo:'Asia/Tokyo', japan:'Asia/Tokyo',
            beijing:'Asia/Shanghai', china:'Asia/Shanghai', 'new york':'America/New_York',
            newyork:'America/New_York', losangeles:'America/Los_Angeles',
            sydney:'Australia/Sydney', australia:'Australia/Sydney',
            brazil:'America/Sao_Paulo', moscow:'Europe/Moscow'
        };

        const input = args.join(' ').toLowerCase().trim();
        
        if (!input) {
            await socket.sendMessage(sender, {
                text: `🕐 *ᴡᴏʀʟᴅ ᴄʟᴏᴄᴋ*\n\nɢᴇᴛ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴛɪᴍᴇ ɪɴ ᴀɴʏ ᴄɪᴛʏ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}time <city>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}time Nairobi\`\n• \`${prefix}time London\`\n• \`${prefix}time Tokyo\`\n• \`${prefix}time New York\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}time Nairobi`, buttonText: { displayText: '🇰🇪 ɴᴀɪʀᴏʙɪ' }, type: 1 },
                    { buttonId: `${prefix}time London`, buttonText: { displayText: '🇬🇧 ʟᴏɴᴅᴏɴ' }, type: 1 },
                    { buttonId: `${prefix}time Tokyo`, buttonText: { displayText: '🇯🇵 ᴛᴏᴋʏᴏ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🕐', key: msg.key } });

        const tz = ZONES[input] || ZONES[input.replace(/\s+/g, '')] || args.join('/');
        const place = args.join(' ');

        const now = new Date().toLocaleString('en-US', {
            timeZone: tz,
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });

        await socket.sendMessage(sender, {
            text: `🕐 *ᴛɪᴍᴇ ɪɴ ${place.toUpperCase()}*\n\n${now}\n🌍 ᴛɪᴍᴇᴢᴏɴᴇ: \`${tz}\`\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}time`, buttonText: { displayText: '🕐 ᴄʜᴇᴄᴋ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch {
        await socket.sendMessage(sender, {
            text: `❌ *ᴜɴᴋɴᴏᴡɴ ᴛɪᴍᴇᴢᴏɴᴇ*\n\n"${args.join(' ')}" ɴᴏᴛ ғᴏᴜɴᴅ.\n\n*ᴛʀʏ:* Nairobi, London, Tokyo, New York, Dubai, Sydney, Paris, Berlin`,
            buttons: [
                { buttonId: `${prefix}time Nairobi`, buttonText: { displayText: '🇰🇪 ɴᴀɪʀᴏʙɪ' }, type: 1 },
                { buttonId: `${prefix}time London`, buttonText: { displayText: '🇬🇧 ʟᴏɴᴅᴏɴ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: calc / calculate / math - Evaluate a math expression
case 'calc':
case 'calculate':
case 'math': {
    try {
        if (!args.length) {
            await socket.sendMessage(sender, {
                text: `🧮 *ᴄᴀʟᴄᴜʟᴀᴛᴏʀ*\n\nᴇᴠᴀʟᴜᴀᴛᴇ ᴀ ᴍᴀᴛʜ ᴇxᴘʀᴇssɪᴏɴ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}calc <expression>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}calc 25 * 4\`\n• \`${prefix}calc (100 + 50) / 3\`\n• \`${prefix}calc 2 ** 10\`\n• \`${prefix}calc Math.sqrt(144)\`\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}calc 25 * 4`, buttonText: { displayText: '25 × 4' }, type: 1 },
                    { buttonId: `${prefix}calc Math.sqrt(144)`, buttonText: { displayText: '√144' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🧮', key: msg.key } });

        // Sanitize input: allow digits, operators, parentheses, dot, common Math functions, spaces
        const expr = args.join(' ')
            .replace(/[^0-9+\-*/().%, \tMathsqrtpowabsceilflooroundrndmlogIE]/g, '')
            .trim();

        if (!expr) {
            await socket.sendMessage(sender, {
                text: `❌ *ɪɴᴠᴀʟɪᴅ ᴇxᴘʀᴇssɪᴏɴ*\n\nᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴍᴀᴛʜ ᴇxᴘʀᴇssɪᴏɴ.`,
                quoted: msg
            });
            break;
        }

        const result = Function('"use strict"; return (' + expr + ')')();

        if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Invalid result');
        }

        await socket.sendMessage(sender, {
            text: `🧮 *ᴄᴀʟᴄᴜʟᴀᴛᴏʀ*\n\n📥 *ɪɴᴘᴜᴛ:* \`${args.join(' ')}\`\n📤 *ʀᴇsᴜʟᴛ:* \`${result.toLocaleString()}\`\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}calc`, buttonText: { displayText: '🧮 ᴄᴀʟᴄᴜʟᴀᴛᴇ ᴀɢᴀɪɴ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Calc] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ɪɴᴠᴀʟɪᴅ ᴇxᴘʀᴇssɪᴏɴ*\n\n\`${args.join(' ')}\`\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: jid - Get JID with copy button (ONE message)
case 'jid': {
    await socket.sendMessage(sender, { react: { text: '📍', key: msg.key } });

    try {
        const isGroup = msg.key.remoteJid.endsWith('@g.us');

        let jidToCopy;
        if (isGroup) {
            jidToCopy = msg.key.remoteJid;
        } else {
            jidToCopy = sender;
        }

        // ONE message with CTA buttons
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: `📍 *JID*\n\n\`\`\`${jidToCopy}\`\`\`\n\n> ${botConfig.BOT_FOOTER}` },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📋 Copy JID',
                                                copy_code: jidToCopy
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '⭐ GitHub Repo',
                                                url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: `📍 *JID*\n\n\`\`\`${jidToCopy}\`\`\``,
                buttons: [
                    { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 Contact Owner' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        }

    } catch (e) {
        console.error("JID Error:", e);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred: ${e.message || e}`
        }, { quoted: fakevCard });
    }
    break;
}
//vcf case
//===============================
// 12
                case 'bomb': {
                    await socket.sendMessage(sender, { react: { text: '🔥', key: msg.key } });
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

                    const count = parseInt(countRaw) || 5;

                    if (!target || !text || !count) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 254XXXXXXX,Hello 👋,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Easy, tiger! Max 20 messages per bomb, okay? 😘*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ Bomb sent to ${target} — ${count}x, love! 💣😉`
                    }, { quoted: fakevCard });
                    break;
                }
//===============================
// 13
                
// ┏━━━━━━━━━━━━━━━❖
// ┃ FUN & ENTERTAINMENT COMMANDS
// ┗━━━━━━━━━━━━━━━❖
case 'joke': {
    try {
        const axios = require('axios');
        
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const { data } = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 15000 });
        if (!data?.setup || !data?.punchline) {
            throw new Error('Failed to fetch joke');
        }

        const caption = `
╭━━〔 *ʀᴀɴᴅᴏᴍ ᴊᴏᴋᴇ* 〕━━┈⊷
├ *sᴇᴛᴜᴘ*: ${data.setup} 🤡
├ *ᴘᴜɴᴄʜʟɪɴᴇ*: ${data.punchline} 😂
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Joke error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch joke* 😞'
        }, { quoted: msg });
    }
    break;
}


case "waifu": {
    try {
        await socket.sendMessage(sender, { react: { text: '🥲', key: msg.key } });
        const res = await fetch('https://api.waifu.pics/sfw/waifu');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch waifu image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: '✨ Here\'s your random waifu!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to get waifu.' }, { quoted: fakevCard });
    }
    break;
}

case "meme": {
    try {
        await socket.sendMessage(sender, { react: { text: '😂', key: msg.key } });
        const res = await fetch('https://meme-api.com/gimme');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch meme.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: `🤣 *${data.title}*`
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch meme.' }, { quoted: fakevCard });
    }
    break;
}
case 'readmore':
case 'rm':
case 'rmore':
case 'readm': {
    try {
        // Extract text from message
        const q = msg.message?.conversation || '';
        const args = q.split(' ').slice(1);
        const inputText = args.join(' ') || 'No text provided';

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const readMore = String.fromCharCode(8206).repeat(4000);
        const message = `${inputText}${readMore} *Continue Reading...*`;

        const caption = `
╭───[ *ʀᴇᴀᴅ ᴍᴏʀᴇ* ]───
├ *ᴛᴇxᴛ*: ${message} 📝
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Readmore error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: `❌ *Error creating read more:* ${error.message || 'unknown error'}`
        }, { quoted: msg });
    }
    break;
}


case 'fact': {
    try {
        const axios = require('axios');
        
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const { data } = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 15000 });
        if (!data?.text) throw new Error('Failed to fetch fact');

        const caption = `
╭───[ *ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ* ]───
├ *ғᴀᴄᴛ*: ${data.text} 🧠
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Fact error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch fun fact* 😞'
        }, { quoted: msg });
    }
    break;
}
case 'flirt':
case 'masom':
case 'line': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/flirt?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ғʟɪʀᴛ ʟɪɴᴇ* ]───
├ *ʟɪɴᴇ*: ${result} 💘
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Flirt error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch flirt line* 😞'
        }, { quoted: msg });
    }
    break;
}

case "darkjoke": case "darkhumor": {
    try {
        await socket.sendMessage(sender, { react: { text: '😬', key: msg.key } });
        const res = await fetch('https://v2.jokeapi.dev/joke/Dark?type=single');
        const data = await res.json();
        if (!data || !data.joke) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a dark joke.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🌚 *Dark Humor:*\n\n${data.joke}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch dark joke.' }, { quoted: fakevCard });
    }
    break;
}

case 'truth':
case 'truthquestion': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/truth?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴛʀᴜᴛʜ ǫᴜᴇsᴛɪᴏɴ* ]───
├ *ǫᴜᴇsᴛɪᴏɴ*: ${result} ❓
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Truth error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch truth question* 😞'
        }, { quoted: msg });
    }
    break;
}
// ┏━━━━━━━━━━━━━━━❖
// ┃ INSULT
// ┗━━━━━━━━━━━━━━━❖
case 'insult': {
    try {
        const insults = [
            "You're like a cloud. When you disappear, it's a beautiful day!",
            "You bring everyone so much joy when you leave the room!",
            "I'd agree with you, but then we'd both be wrong.",
            "You're not stupid; you just have bad luck thinking.",
            "Your secrets are always safe with me. I never even listen to them.",
            "You're proof that even evolution takes a break sometimes.",
            "You have something on your chin... no, the third one down.",
            "You're like a software update. Whenever I see you, I think, 'Do I really need this right now?'",
            "You bring everyone happiness... you know, when you leave.",
            "You're like a penny—two-faced and not worth much.",
            "You have something on your mind... oh wait, never mind.",
            "You're the reason they put directions on shampoo bottles.",
            "You're like a cloud. Always floating around with no real purpose.",
            "Your jokes are like expired milk—sour and hard to digest.",
            "You're like a candle in the wind... useless when things get tough.",
            "You have something unique—your ability to annoy everyone equally.",
            "You're like a Wi-Fi signal—always weak when needed most.",
            "You're proof that not everyone needs a filter to be unappealing.",
            "Your energy is like a black hole—it just sucks the life out of the room.",
            "You have the perfect face for radio.",
            "You're like a traffic jam—nobody wants you, but here you are.",
            "You're like a broken pencil—pointless.",
            "Your ideas are so original, I'm sure I've heard them all before.",
            "You're living proof that even mistakes can be productive.",
            "You're not lazy; you're just highly motivated to do nothing.",
            "Your brain's running Windows 95—slow and outdated.",
            "You're like a speed bump—nobody likes you, but everyone has to deal with you.",
            "You're like a cloud of mosquitoes—just irritating.",
            "You bring people together... to talk about how annoying you are."
        ];

        // React to the command first
        await socket.sendMessage(sender, {
            react: {
                text: "💀",
                key: msg.key
            }
        });

        let userToInsult;
        
        // Check for mentioned users
        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            userToInsult = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        }
        // Check for replied message
        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            userToInsult = msg.message.extendedTextMessage.contextInfo.participant;
        }
        
        if (!userToInsult) {
            return await socket.sendMessage(sender, { 
                text: '*💀 Insult Command*\nPlease mention someone or reply to their message to insult them!\n\nExample: .insult @user*'
            }, { quoted: msg });
        }

        // Don't let users insult themselves
        if (userToInsult === sender) {
            return await socket.sendMessage(sender, { 
                text: "*🤨 Self-Insult Blocked*\nYou can't insult yourself! That's just sad...*"
            }, { quoted: msg });
        }

        // Don't let users insult the bot
        if (userToInsult.includes('bot') || userToInsult.includes('Bot')) {
            return await socket.sendMessage(sender, { 
                text: "*🤖 Nice Try*\nYou can't insult me! I'm just a bunch of code.*"
            }, { quoted: msg });
        }

        const insult = insults[Math.floor(Math.random() * insults.length)];
        const username = userToInsult.split('@')[0];

        console.log(`[INSULT] ${sender} insulting ${userToInsult}`);

        // Add small delay for dramatic effect
        await new Promise(resolve => setTimeout(resolve, 1500));

        await socket.sendMessage(sender, { 
            text: `🎯 *Target:* @${username}\n💀 *Insult:* ${insult}\n\n*Disclaimer: This is all in good fun! 😄*`,
            mentions: [userToInsult]
        }, { quoted: msg });

        // React with success
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('[INSULT] Error:', error.message);
        
        if (error.message.includes('429') || error.data === 429) {
            await socket.sendMessage(sender, { 
                text: '*⏰ Rate Limited*\nPlease try again in a few seconds.*'
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { 
                text: '*❌ Insult Failed*\nAn error occurred while sending the insult. Please try again later.*'
            }, { quoted: msg });
        }
    }
    break;
}
// ┏━━━━━━━━━━━━━━━❖
// ┃ ROMANTIC, SAVAGE & THINKY COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case 'pickupline':
case 'pickup': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://api.popcat.xyz/pickuplines', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { pickupline } = await res.json();
        if (!pickupline) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ* ]───
├ *ʟɪɴᴇ*: ${pickupline} 💬
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Pickupline error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch pickup line* 😞'
        }, { quoted: msg });
    }
    break;
}

case "roast": {
    try {
        await socket.sendMessage(sender, { react: { text: '🤬', key: msg.key } });
        const res = await fetch('https://vinuxd.vercel.app/api/roast');
        const data = await res.json();
        if (!data || !data.data) {
            await socket.sendMessage(sender, { text: '❌ No roast available at the moment.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🔥 *Roast:* ${data.data}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch roast.' }, { quoted: fakevCard });
    }
    break;
}

case "lovequote": {
    try {
        await socket.sendMessage(sender, { react: { text: '🙈', key: msg.key } });
        const res = await fetch('https://api.popcat.xyz/lovequote');
        const data = await res.json();
        if (!data || !data.quote) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch love quote.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `❤️ *Love Quote:*\n\n"${data.quote}"` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch love quote.' }, { quoted: fakevCard });
    }
    break;
}
case 'dare':
case 'truthordare': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/dare?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴅᴀʀᴇ ᴄʜᴀʟʟᴇɴɢᴇ* ]───
├ *ᴅᴀʀᴇ*: ${result} 🎯
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Dare error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch dare* 😞'
        }, { quoted: msg });
    }
    break;
}

//===============================
// Case: facebook / fb / fbdl - Download Facebook video
case 'facebook':
case 'fb':
case 'fbdl': {
    try {
        const url = args[0];
        
        if (!url) {
            await socket.sendMessage(sender, {
                text: `📘 *ғᴀᴄᴇʙᴏᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ*\n\nᴅᴏᴡɴʟᴏᴀᴅ ғᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏs.\n\n*ᴜsᴀɢᴇ:* \`${prefix}fb <url>\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}fb https://www.facebook.com/...\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        const urlRegex = /^(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.watch|m\.facebook\.com)\b/i;
        if (!urlRegex.test(url)) {
            await socket.sendMessage(sender, {
                text: `⚠️ *ɪɴᴠᴀʟɪᴅ ᴜʀʟ*\n\nᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ғᴀᴄᴇʙᴏᴏᴋ ᴜʀʟ.\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}fb https://www.facebook.com/...\``,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📘', key: msg.key } });

        const downloadingMsg = await socket.sendMessage(sender, {
            text: '📥 *ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ғᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ...*',
            quoted: msg
        });

        const apiUrl = `https://api.nexoracle.com/downloaders/fbdl?url=${encodeURIComponent(url)}&apikey=free_for_use`;
        const { data } = await axios.get(apiUrl, {
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const videoUrl = data?.result?.hd || data?.result?.sd || data?.link;
        if (!videoUrl) throw new Error('Could not extract video URL. The link may be private or unsupported.');

        const title = data?.result?.title || 'Facebook Video';

        // Delete downloading message
        try { await socket.sendMessage(sender, { delete: downloadingMsg.key }); } catch {}

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: `📘 *ғᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ*\n\n📌 *ᴛɪᴛʟᴇ:* ${title}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}fb`, buttonText: { displayText: '📘 ᴅᴏᴡɴʟᴏᴀᴅ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1,
            contextInfo: {
                externalAdReply: {
                    title: 'ғᴀᴄᴇʙᴏᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ',
                    body: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ' + botConfig.OWNER_NAME,
                    thumbnailUrl: botConfig.RCD_IMAGE_PATH,
                    sourceUrl: url,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[Facebook] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀᴄᴇʙᴏᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\n${err.message}\n\n*ᴛɪᴘs:*\n• ᴇɴsᴜʀᴇ ᴛʜᴇ ᴠɪᴅᴇᴏ ɪs ᴘᴜʙʟɪᴄ\n• ᴛʀʏ ᴀ ᴅɪғғᴇʀᴇɴᴛ ʟɪɴᴋ`,
            buttons: [
                { buttonId: `${prefix}fb`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//===============================
                case 'nasa': {
                    try {
                    await socket.sendMessage(sender, { react: { text: '✔️', key: msg.key } });
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
                            throw new Error('Invalid APOD data received or media type is not an image');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '🌌 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ ɴᴀsᴀ ɴᴇᴡs',
                                `🌠 *${title}*\n\n${explanation.substring(0, 200)}...\n\n📆 *Date*: ${date}\n${copyright ? `📝 *Credit*: ${copyright}` : ''}\n🔗 *Link*: https://apod.nasa.gov/apod/astropix.html`,
                                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, love, the stars didn’t align this time! 🌌 Try again? 😘'
                        });
                    }
                    break;
                }
//===============================
                case 'news': {
                await socket.sendMessage(sender, { react: { text: '😒', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date}\n🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, sweetie, the news got lost in the wind! 😢 Try again?'
                        });
                    }
                    break;
                }
//===============================                
// 17
                case 'cricket': {
                await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
                    try {
                        console.log('Fetching cricket news from API...');
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        console.log(`API Response Status: ${response.status}`);

                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response Data:', JSON.stringify(data, null, 2));

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure: Missing status or result');
                        }

                        const { title, score, to_win, crr, link } = data.result;
                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error('Missing required fields in API response: ' + JSON.stringify(data.result));
                        }

                        console.log('Sending message to user...');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🏏 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  CRICKET NEWS🏏',
                                `📢 *${title}*\n\n` +
                                `🏆 *Mark*: ${score}\n` +
                                `🎯 *To Win*: ${to_win}\n` +
                                `📈 *Current Rate*: ${crr}\n\n` +
                                `🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                        console.log('Message sent successfully.');
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, darling, the cricket ball flew away! 🏏 Try again? 😘'
                        });
                    }
                    break;
                }

//===============================
                case 'ig': {
                await socket.sendMessage(sender, { react: { text: '✅️', key: msg.key } });
                    const axios = require('axios');
                    const { igdl } = require('ruhend-scraper'); 
                        

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const igUrl = q?.trim(); 
                    
                    if (!/instagram\.com/.test(igUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Give me a real Instagram video link, darling 😘*' });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        const res = await igdl(igUrl);
                        const data = res.data; 

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url; 

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '> mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs'
                            }, { quoted: fakevCard });

                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await socket.sendMessage(sender, { text: '*❌ No video found in that link, love! Try another? 💔*' });
                        }
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ Oh, sweetie, that Instagram video got away! 😢*' });
                    }
                    break;
                }
//===============================     
               case 'active': {
    await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
    
    try {
        const activeCount = activeSockets.size;
        const activeNumbers = Array.from(activeSockets.keys()).join('\n') || 'No active members';

        // Using URL directly (if your library supports it)
        await socket.sendMessage(from, {
            text: `👥 Active Members: *${activeCount}*\n\nNumbers:\n${activeNumbers}`,
            contextInfo: {
                externalAdReply: {
                    title: 'Powered by CaseyRhodes Tech 👻',
                    body: 'Active Members Report',
                    mediaType: 1,
                    sourceUrl: 'https://wa.me/1234567890',
                    thumbnailUrl: 'https://files.catbox.moe/k3wgqy.jpg'
                }
            }
        }, { quoted: msg });

    } catch (error) {
        console.error('Error in .active command:', error);
        await socket.sendMessage(from, { text: '❌ Oh, darling, I couldn\'t count the active souls! 💔 Try again?' }, { quoted: fakevCard });
    }
    break;
}
                //===============================
// 22
case 'ai':
case 'ask':
case 'gpt':
case 'casey': {
    try {
        const axios = require("axios");
        
        // Send processing reaction
        await socket.sendMessage(sender, { 
            react: { 
                text: '🤖', 
                key: msg.key 
            } 
        });

        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';

        if (!q || q.trim() === '') {
            return await socket.sendMessage(from, {
                text: `❓ *Please ask me something*\n\n*Example:* ${botConfig.PREFIX}ai Who are you?`,
                buttons: [
                    {
                        buttonId: `${botConfig.PREFIX}ai Who are you?`,
                        buttonText: { displayText: '👋 WHO ARE YOU' },
                        type: 1
                    },
                    {
                        buttonId: `${botConfig.PREFIX}ai What can you do?`,
                        buttonText: { displayText: '🤖 WHAT CAN YOU DO' },
                        type: 1
                    },
                    {
                        buttonId: `${botConfig.PREFIX}menu`,
                        buttonText: { displayText: '📋 MAIN MENU' },
                        type: 1
                    }
                ]
            }, { quoted: msg });
        }

        // Function to handle custom responses
        const getCustomResponse = (text) => {
            const lowerText = text.toLowerCase();
            
            // Check for owner/developer related queries
            if (lowerText.includes('owner') || lowerText.includes('developer') || lowerText.includes('creator') || 
                lowerText.includes('who owns you') || lowerText.includes('who created you') || 
                lowerText.includes('who developed you') || lowerText.includes('who built you')) {
                
                return {
                    text: `*👨‍💻 MEET THE DEVELOPER*\n\n🇰🇪 *Primary Developer:* CaseyRhodes Tech\n• Location: Kenya\n• Specialization: AI Integration & Bot Development\n• Role: Lead Developer & Project Owner\n\n🤖 *Technical Partner:* Caseyrhodes\n• Specialization: Backend Systems & API Management\n• Role: Technical Support & Infrastructure\n\n*About Our Team:*\nCasey AI is the result of a CaseyRhodes Tech  Together, we bring you cutting-edge AI technology with reliable bot functionality, ensuring you get the best AI experience possible.\n\n*Proudly Made in Kenya* 🇰🇪`,
                    buttons: [
                        {
                            buttonId: `${botConfig.PREFIX}owner`,
                            buttonText: { displayText: '👑 CONTACT OWNER' },
                            type: 1
                        },
                        {
                            buttonId: `${botConfig.PREFIX}repo`,
                            buttonText: { displayText: '🔮 REPOSITORY' },
                            type: 1
                        }
                    ]
                };
            }

            // Check for creation date/when made queries
            if (lowerText.includes('when were you made') || lowerText.includes('when were you created') || 
                lowerText.includes('when were you developed') || lowerText.includes('creation date') || 
                lowerText.includes('when did you start') || lowerText.includes('how old are you') ||
                lowerText.includes('when were you built') || lowerText.includes('release date')) {
                
                return {
                    text: `*📅 CASEY AI TIMELINE*\n\n🚀 *Development Started:* December 2025\n🎯 *First Release:* January 2025\n🔄 *Current Version:* 2.0 (February 2025)\n\n*Development Journey:*\n• *Phase 1:* Core AI integration and basic functionality\n• *Phase 2:* Enhanced response system and multi-API support\n• *Phase 3:* Advanced customization and user experience improvements\n\n*What's Next:*\nWe're constantly working on updates to make Casey AI smarter, faster, and more helpful. Stay tuned for exciting new features!\n\n*Age:* Just a few months old, but getting smarter every day! 🧠✨`,
                    buttons: [
                        {
                            buttonId: `${botConfig.PREFIX}ai What are your features?`,
                            buttonText: { displayText: '✨ FEATURES' },
                            type: 1
                        },
                        {
                            buttonId: `${botConfig.PREFIX}menu`,
                            buttonText: { displayText: '📋 MAIN MENU' },
                            type: 1
                        }
                    ]
                };
            }

            // Check for AI name queries
            if (lowerText.includes('what is your name') || lowerText.includes('what\'s your name') || 
                lowerText.includes('tell me your name') || lowerText.includes('your name') || 
                lowerText.includes('name?') || lowerText.includes('called?')) {
                
                return {
                    text: `*🏷️ MY NAME*\n\n👋 Hello! My name is *CASEY AI*\n\n*About My Name:*\n• Full Name: Casey AI\n• Short Name: Casey\n• You can call me: Casey, Casey AI, or just AI\n\n*Name Origin:*\nI'm named after my primary developer *CaseyRhodes Tech*, combining the personal touch of my creator with the intelligence of artificial intelligence technology.\n\n*What Casey Stands For:*\n🔹 *C* - Creative Problem Solving\n🔹 *A* - Advanced AI Technology\n🔹 *S* - Smart Assistance\n🔹 *E* - Efficient Responses\n🔹 *Y* - Your Reliable Companion\n\n*Made in Kenya* 🇰🇪 *by CaseyRhodes Tech*`,
                    buttons: [
                        {
                            buttonId: `${botConfig.PREFIX}ai Who created you?`,
                            buttonText: { displayText: '👨‍💻 CREATOR' },
                            type: 1
                        },
                        {
                            buttonId: `${botConfig.PREFIX}ai Tell me about yourself`,
                            buttonText: { displayText: '🤖 ABOUT ME' },
                            type: 1
                        }
                    ]
                };
            }

            // Check for general info about Casey AI
            if (lowerText.includes('what are you') || lowerText.includes('tell me about yourself') || 
                lowerText.includes('who are you') || lowerText.includes('about casey')) {
                
                return {
                    text: `👋 Hi! I'm *Casey AI*, your intelligent WhatsApp assistant developed by CaseyRhodes Tech.\n\n*What I Can Do:*\n• Answer questions on any topic\n• Help with problem-solving\n• Provide information and explanations\n• Assist with creative tasks\n• Engage in meaningful conversations\n\n*My Features:*\n✅ Advanced AI technology\n✅ Multi-language support\n✅ Fast response times\n✅ Reliable dual-API system\n✅ User-friendly interface\n\n*My Identity:*\n• Name: Casey AI\n• Origin: Kenya 🇰🇪\n• Purpose: Making AI accessible and helpful\n\n*Proudly Kenyan:* 🇰🇪\nBuilt with passion in Kenya, serving users worldwide with cutting-edge AI technology.\n\nHow can I assist you today?`,
                    buttons: [
                        {
                            buttonId: `${botConfig.PREFIX}ai What can you help me with?`,
                            buttonText: { displayText: '💡 ʜᴇʟᴘ ᴛᴏᴘɪᴄ' },
                            type: 1
                        },
                        {
                            buttonId: `${botConfig.PREFIX}menu`,
                            buttonText: { displayText: '📋 ᴍᴀɪɴ ᴍᴇɴᴜ' },
                            type: 1
                        },
                        {
                            buttonId: `${botConfig.PREFIX}owner`,
                            buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' },
                            type: 1
                        }
                    ]
                };
            }

            // Return null if no custom response matches
            return null;
        };

        // Check for custom responses first
        const customResponse = getCustomResponse(q);
        if (customResponse) {
            return await socket.sendMessage(from, {
                image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
                caption: customResponse.text,
                buttons: customResponse.buttons,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363420261263259@newsletter',
                        newsletterName: 'CASEYRHODES XMD🌟',
                        serverMessageId: -1
                    }
                }
            }, { quoted: msg });
        }

        const apis = [
            `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(q)}`,
            `https://iamtkm.vercel.app/ai/gpt5?apikey=tkm&text=${encodeURIComponent(q)}`
        ];

        let response = null;
        for (const apiUrl of apis) {
            try {
                const res = await axios.get(apiUrl, { timeout: 10000 });
                response = res.data?.result || res.data?.response || res.data?.answer || res.data;
                if (response && typeof response === 'string' && response.trim() !== '') {
                    break;
                }
            } catch (err) {
                console.error(`AI Error (${apiUrl}):`, err.message);
                continue;
            }
        }

        if (!response) {
            return await socket.sendMessage(from, {
                text: `❌ *I'm experiencing technical difficulties*\nAll AI APIs are currently unavailable. Please try again later.`,
                buttons: [
                    {
                        buttonId: `${botConfig.PREFIX}owner`,
                        buttonText: { displayText: '👑 REPORT ISSUE' },
                        type: 1
                    },
                    {
                        buttonId: `${botConfig.PREFIX}menu`,
                        buttonText: { displayText: '📋 MAIN MENU' },
                        type: 1
                    }
                ]
            }, { quoted: msg });
        }

        // Send AI response with image and buttons
        await socket.sendMessage(from, {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: `🤖 *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ:*\n\n${response}\n\n👨‍💻 *ᴅᴇᴠᴇʟᴏᴘᴇʀ:* Caseyrhodes Tech`,
            buttons: [
                {
                    buttonId: `${botConfig.PREFIX}ai`,
                    buttonText: { displayText: '🤖 ᴀsᴋ ᴀɢᴀɪɴ' },
                    type: 1
                },
                {
                    buttonId: `${botConfig.PREFIX}menu`,
                    buttonText: { displayText: '📋ᴍᴀɪɴ ᴍᴇɴᴜ' },
                    type: 1
                },
                {
                    buttonId: `${botConfig.PREFIX}owner`,
                    buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' },
                    type: 1
                }
            ],
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'CASEYRHODES XMD🌟',
                    serverMessageId: -1
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('AI Command Error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(from, {
            text: `❌ *AI Error:* ${error.message}\nPlease try again later.`,
            buttons: [
                {
                    buttonId: `${botConfig.PREFIX}owner`,
                    buttonText: { displayText: '👑 REPORT ISSUE' },
                    type: 1
                },
                {
                    buttonId: `${botConfig.PREFIX}menu`,
                    buttonText: { displayText: '📋 MAIN MENU' },
                    type: 1
                }
            ]
        }, { quoted: msg });
    }
    break;
}
//===============================
case 'getpp':
case 'pp':
case 'profilepic': {
    await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
    try {
        let targetUser = sender;
        
        // Check if user mentioned someone or replied to a message
        if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.quoted) {
            targetUser = msg.quoted.sender;
        }
        
        const ppUrl = await socket.profilePictureUrl(targetUser, 'image').catch(() => null);
        
        if (ppUrl) {
            await socket.sendMessage(msg.key.remoteJid, {
                image: { url: ppUrl },
                caption: `Profile picture of @${targetUser.split('@')[0]}`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: '.menu', buttonText: { displayText: '🌸 Menu' }, type: 1 },
                    { buttonId: '.alive', buttonText: { displayText: '♻️ Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        } else {
            await socket.sendMessage(msg.key.remoteJid, {
                text: `@${targetUser.split('@')[0]} doesn't have a profile picture.`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: '.menu', buttonText: { displayText: '🌸 Menu' }, type: 1 },
                    { buttonId: '.alive', buttonText: { displayText: '♻️ Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        }
    } catch (error) {
        await socket.sendMessage(msg.key.remoteJid, {
            text: "Error fetching profile picture.",
            buttons: [
                { buttonId: 'menu', buttonText: { displayText: '📋 Menu' }, type: 1 }
            ]
        });
    }
    break;
}

//===============================
                case 'gossip': {
                await socket.sendMessage(sender, { react: { text: '😅', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API From news Couldnt get it 😩');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('API Received from news data a Problem with');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage; 
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape Couldn't from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ   GOSSIP Latest News් 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date || 'Not yet given'}\n🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, darling, the gossip slipped away! 😢 Try again?'
                        });
                    }
                    break;
                }
                
                
 // New Commands: Group Management
 // Case: add - Add a member to the group
    case 'add': {
    await socket.sendMessage(sender, { react: { text: '➕️', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, love!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    // REMOVED: Admin/Owner restriction check
    // Now anyone can use this command in groups
    
    if (args.length === 0) {
        await socket.sendMessage(sender, {
            text: `📌 *Usage:* ${botConfig.PREFIX}add +254740007567\n\nExample: ${botConfig.PREFIX}add +254740007567`
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        const numberToAdd = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await socket.groupParticipantsUpdate(from, [numberToAdd], 'add');
        await socket.sendMessage(sender, {
            text: formatMessage(
                '✅ MEMBER ADDED',
                `Successfully added ${args[0]} to the group! 🎉`,
                botConfig.BOT_FOOTER
            )
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Add command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to add member, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}

case 'leave': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴍᴀᴋᴇ ᴛʜᴇ ʙᴏᴛ ʟᴇᴀᴠᴇ.',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '👋', key: msg.key } });

        // Send goodbye message
        await socket.sendMessage(from, {
            text: `👋 *ɢᴏᴏᴅʙʏᴇ!*\n\nʙᴏᴛ ɪs ɴᴏᴡ ʟᴇᴀᴠɪɴɢ ᴛʜɪs ɢʀᴏᴜᴘ.\n\n> ${botConfig.BOT_FOOTER}`
        });

        // Leave the group
        await socket.groupLeave(from);
        console.log(`Bot left group: ${from}`);

    } catch (error) {
        console.error('Leave group error:', error);

        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ʟᴇᴀᴠᴇ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                // Case: kick - Remove a member from the group
         case 'kick': {
    await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, sweetie!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    // REMOVED: Admin/Owner restriction check
    // Now anyone can use this command in groups
    
    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, {
            text: `📌 *Usage:* ${botConfig.PREFIX}kick +254740007567 or reply to a message with ${botConfig.PREFIX}kick`
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        let numberToKick;
        if (msg.quoted) {
            numberToKick = msg.quoted.sender;
        } else {
            numberToKick = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🗑️ MEMBER KICKED',
                `Successfully removed ${numberToKick.split('@')[0]} from the group! 🚪`,
                botConfig.BOT_FOOTER
            )
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Kick command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to kick member, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
                
         //get github username details 
case 'github':
case 'gh': {
    try {
        const username = args[0];

        if (!username) {
            await socket.sendMessage(sender, {
                text: '📦 *GitHub User Info*\n\nGet detailed information about any GitHub user.\n\n*Usage:* `.github <username>`\n\n*Examples:*\n• `.github caseyrhodes`\n• `.github microsoft`\n• `.github google`\n\n> ' + botConfig.BOT_FOOTER,
                buttons: [
                    { buttonId: `${prefix}github caseyrhodes`, buttonText: { displayText: '👤 CASEYRHODES' }, type: 1 },
                    { buttonId: `${prefix}github microsoft`, buttonText: { displayText: '🪟 MICROSOFT' }, type: 1 },
                    { buttonId: `${prefix}github google`, buttonText: { displayText: '🔴 GOOGLE' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        try {
            const response = await axios.get(`https://api.github.com/users/${username}`, { timeout: 10000 });
            const data = response.data;

            if (data.message === 'Not Found') {
                await socket.sendMessage(sender, {
                    text: `❌ *GitHub User Not Found*\n\n"${username}" does not exist on GitHub.\n\n*Suggestions:*\n• Check the spelling\n• Try a different username\n• Make sure the user exists\n\n> ${botConfig.BOT_FOOTER}`,
                    buttons: [
                        { buttonId: `${prefix}github`, buttonText: { displayText: '🔍 TRY AGAIN' }, type: 1 },
                        { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                    ],
                    headerType: 1
                }, { quoted: fakevCard });
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                break;
            }

            // Format dates
            const created = new Date(data.created_at).toLocaleDateString();
            const updated = new Date(data.updated_at).toLocaleDateString();

            const userInfo = 
                `👤 *${data.name || data.login}*\n` +
                `🔖 *Username:* ${data.login}\n` +
                `📝 *Bio:* ${data.bio || 'N/A'}\n` +
                `🏢 *Company:* ${data.company || 'N/A'}\n` +
                `📍 *Location:* ${data.location || 'N/A'}\n` +
                `📧 *Email:* ${data.email || 'N/A'}\n` +
                `🔗 *Blog:* ${data.blog || 'N/A'}\n\n` +
                `📊 *Statistics:*\n` +
                `📂 *Public Repos:* ${data.public_repos}\n` +
                `👥 *Followers:* ${data.followers}\n` +
                `🤝 *Following:* ${data.following}\n` +
                `⭐ *Public Gists:* ${data.public_gists || 0}\n\n` +
                `📅 *Created:* ${created}\n` +
                `🔄 *Updated:* ${updated}\n\n` +
                `> ${botConfig.BOT_FOOTER}`;

            // Build CTA buttons
            const ctaButtons = [];
            
            // Profile link
            ctaButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '🔗 VIEW PROFILE',
                    url: data.html_url
                })
            });
            
            // Repos link
            ctaButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '📂 VIEW REPOS',
                    url: `${data.html_url}?tab=repositories`
                })
            });
            
            // Follow Channel button
            ctaButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '📢 JOIN CHANNEL',
                    url: botConfig.CHANNEL_LINK
                })
            });

            // Send ONE message with text and CTA buttons (no image, no processing message)
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: userInfo },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: { buttons: ctaButtons }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('GitHub API error:', err);
            await socket.sendMessage(sender, {
                text: `⚠️ *Error fetching GitHub user*\n\n${err.message || 'Please try again later.'}\n\n> ${botConfig.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}github ${username}`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        }
    } catch (error) {
        console.error('GitHub command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *An unexpected error occurred*\n\nPlease try again later.\n\n> ' + botConfig.BOT_FOOTER,
            buttons: [
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: admins / listadmins / adminlist - List all group admins
case 'admins':
case 'listadmins':
case 'adminlist': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🛡️', key: msg.key } });

        const meta = await socket.groupMetadata(from);
        const admins = meta.participants.filter(m => m.admin);
        
        if (!admins.length) {
            await socket.sendMessage(sender, {
                text: '❌ ɴᴏ ᴀᴅᴍɪɴs ғᴏᴜɴᴅ.',
                quoted: msg
            });
            break;
        }

        const list = admins.map((m, i) => {
            const displayJid = getParticipantPhoneJid(m) || getParticipantJid(m);
            const num = displayJid ? displayJid.split('@')[0] : 'admin';
            const role = m.admin === 'superadmin' ? '👑 sᴜᴘᴇʀ ᴀᴅᴍɪɴ' : '🛡️ ᴀᴅᴍɪɴ';
            return `${i + 1}. @${num} — ${role}`;
        }).join('\n');

        const mentions = admins.map(m => getParticipantJid(m)).filter(Boolean);

        await socket.sendMessage(sender, {
            text: `🛡️ *${meta.subject} — ᴀᴅᴍɪɴs*\n\n${list}\n\n📊 ᴛᴏᴛᴀʟ ᴀᴅᴍɪɴs: ${admins.length}\n\n> ${botConfig.BOT_FOOTER}`,
            mentions: mentions,
            buttons: [
                { buttonId: `${prefix}tagadmins`, buttonText: { displayText: '🎌 ᴛᴀɢ ᴀᴅᴍɪɴs' }, type: 1 },
                { buttonId: `${prefix}members`, buttonText: { displayText: '👥 ᴍᴇᴍʙᴇʀs' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[Admins]', e.message);
        await socket.sendMessage(sender, {
            text: `❌ ғᴀɪʟᴇᴅ: ${e.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Helper case for members list
// Case: members / listmembers / memberlist - List all group members
case 'members':
case 'listmembers':
case 'memberlist': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '👥', key: msg.key } });

        const meta = await socket.groupMetadata(from);
        const members = meta.participants || [];
        const total = members.length;
        const admins = members.filter(m => m.admin).length;
        
        const list = members.map((m, i) => {
            const displayJid = getParticipantPhoneJid(m) || getParticipantJid(m);
            const num = displayJid ? displayJid.split('@')[0] : 'member';
            const role = m.admin === 'superadmin' ? '👑' : m.admin ? '🛡️' : '👤';
            return `${role} ${i + 1}. @${num}`;
        }).join('\n');

        const mentions = members.map(m => getParticipantJid(m)).filter(Boolean);

        await socket.sendMessage(sender, {
            text: `👥 *${meta.subject} — ᴍᴇᴍʙᴇʀs*\n\n${list}\n\n📊 ᴛᴏᴛᴀʟ: ${total} | 🛡️ ᴀᴅᴍɪɴs: ${admins} | 👤 ᴍᴇᴍʙᴇʀs: ${total - admins}\n\n> ${botConfig.BOT_FOOTER}`,
            mentions: mentions,
            buttons: [
                { buttonId: `${prefix}tagall`, buttonText: { displayText: '👥 ᴛᴀɢ ᴀʟʟ' }, type: 1 },
                { buttonId: `${prefix}ginfo`, buttonText: { displayText: '📊 ɢʀᴏᴜᴘ ɪɴғᴏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[Members]', e.message);
        await socket.sendMessage(sender, {
            text: `❌ ғᴀɪʟᴇᴅ: ${e.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
 // Case: promote - Promote a member to group admin
                case 'promote': {
    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    // REMOVED: Admin/Owner restriction check
    // Now anyone can use this command in groups
    
    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, {
            text: `📌 *Usage:* ${botConfig.PREFIX}promote +254740007567 or reply to a message with ${botConfig.PREFIX}promote`
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        let numberToPromote;
        if (msg.quoted) {
            numberToPromote = msg.quoted.sender;
        } else {
            numberToPromote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');
        await socket.sendMessage(sender, {
            text: formatMessage(
                '⬆️ MEMBER PROMOTED',
                `Successfully promoted ${numberToPromote.split('@')[0]} to group admin! 🌟`,
                botConfig.BOT_FOOTER
            )
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Promote command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to promote member, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}

                // Case: demote - Demote a group admin to member
               case 'demote': {
    await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, sweetie!* 😘',
            buttons: [
                {buttonId: 'groups', buttonText: {displayText: 'My Groups'}, type: 1}
            ]
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can demote admins, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, {
            text: `📌 *Usage:* ${botConfig.PREFIX}demote +254740007567 or reply to a message with ${botConfig.PREFIX}demote`,
            buttons: [
                {buttonId: 'demote-help', buttonText: {displayText: 'Usage Examples'}, type: 1}
            ]
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        let numberToDemote;
        if (msg.quoted) {
            numberToDemote = msg.quoted.sender;
        } else {
            numberToDemote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');
        
        await socket.sendMessage(sender, {
            text: formatMessage(
                '⬇️ ADMIN DEMOTED',
                `Successfully demoted ${numberToDemote.split('@')[0]} 📉`,
                botConfig.BOT_FOOTER
            ),
            buttons: [
                {buttonId: 'adminlist', buttonText: {displayText: 'View Admins'}, type: 1}
            ]
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error('Demote command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to demote admin, love!* 😢\nError: ${error.message || 'Unknown error'}`,
            buttons: [
                {buttonId: 'tryagain', buttonText: {displayText: 'Try Again'}, type: 1}
            ]
        }, { quoted: fakevCard });
    }
    break;
}

// Case: livescore - Live football scores
case 'livescore': {
    try {
        await socket.sendMessage(sender, { react: { text: '⚽', key: msg.key } });
        
        const res = await axios.get('https://api.sofascore.com/api/v1/sport/football/events/live', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            timeout: 12000
        });
        const events = res.data?.events?.slice(0, 10) || [];
        if (!events.length) {
            await socket.sendMessage(sender, {
                text: `⚽ *ʟɪᴠᴇ sᴄᴏʀᴇs*\n\nɴᴏ ʟɪᴠᴇ ᴍᴀᴛᴄʜᴇs ʀɪɢʜᴛ ɴᴏᴡ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }
        const list = events.map(e => {
            const h = e.homeTeam?.name || '?';
            const a = e.awayTeam?.name || '?';
            const hs = e.homeScore?.current ?? '-';
            const as = e.awayScore?.current ?? '-';
            return `⚽ *${h}* ${hs} - ${as} *${a}*`;
        }).join('\n');
        await socket.sendMessage(sender, {
            text: `⚽ *ʟɪᴠᴇ sᴄᴏʀᴇs*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `⚽ *ʟɪᴠᴇ sᴄᴏʀᴇs*\n\nᴄᴏᴜʟᴅ ɴᴏᴛ ғᴇᴛᴄʜ ᴅᴀᴛᴀ.\n🔗 https://www.sofascore.com\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: sportnews - Sports news
case 'sportnews': {
    try {
        const q = args.join(' ') || 'football';
        await socket.sendMessage(sender, { react: { text: '🏆', key: msg.key } });
        
        const res = await axios.get(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=demo`, { timeout: 10000 });
        const articles = res.data?.articles || [];
        if (!articles.length) throw new Error('no articles');
        const list = articles.slice(0, 5).map((a, i) =>
            `*${i + 1}.* ${a.title}\n   📰 ${a.source?.name}`
        ).join('\n\n');
        await socket.sendMessage(sender, {
            text: `🏆 *sᴘᴏʀᴛs ɴᴇᴡs:* ${q}\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `🏆 *sᴘᴏʀᴛs ɴᴇᴡs*\n\n📰 ᴄʜᴇᴄᴋ:\n• https://www.bbc.com/sport\n• https://www.espn.com\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: standings - League standings
case 'standings': {
    try {
        const league = args.join(' ') || 'premier league';
        await socket.sendMessage(sender, { react: { text: '🏆', key: msg.key } });
        
        const res = await axios.get(`https://api.siputzx.my.id/api/sports/standings?league=${encodeURIComponent(league)}`, { timeout: 12000 });
        const teams = res.data?.data?.slice(0, 10) || [];
        if (!teams.length) throw new Error('no data');
        const list = teams.map(t =>
            `${t.rank || '?'}. ${t.name || t.team} | Pts: ${t.points}`
        ).join('\n');
        await socket.sendMessage(sender, {
            text: `🏆 *sᴛᴀɴᴅɪɴɢs: ${league}*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `🏆 *${args.join(' ') || 'premier league'} sᴛᴀɴᴅɪɴɢs*\n\n🔗 https://www.flashscore.com\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: topscorers - Top goal scorers
case 'topscorers': {
    try {
        const league = args.join(' ') || 'premier league';
        await socket.sendMessage(sender, { react: { text: '⚽', key: msg.key } });
        
        const res = await axios.get(`https://api.siputzx.my.id/api/sports/topscorers?league=${encodeURIComponent(league)}`, { timeout: 12000 });
        const players = res.data?.data?.slice(0, 10) || [];
        if (!players.length) throw new Error('no data');
        const list = players.map((p, i) =>
            `*${i + 1}.* ${p.name || p.player} (${p.team}) — ⚽ ${p.goals}`
        ).join('\n');
        await socket.sendMessage(sender, {
            text: `⚽ *ᴛᴏᴘ sᴄᴏʀᴇʀs: ${league}*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `⚽ *ᴛᴏᴘ sᴄᴏʀᴇʀs:s ${args.join(' ') || 'premier league'}*\n\n🔗 https://www.whoscored.com\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: upcomingmatches - Team upcoming matches
case 'upcomingmatches': {
    try {
        const team = args.join(' ') || 'chelsea';
        await socket.sendMessage(sender, { react: { text: '📅', key: msg.key } });
        
        const res = await axios.get(`https://api.sofascore.com/api/v1/team/search/${encodeURIComponent(team)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
        });
        const teamId = res.data?.teams?.[0]?.id;
        if (teamId) {
            const matches = await axios.get(`https://api.sofascore.com/api/v1/team/${teamId}/events/next/0`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
            });
            const events = matches.data?.events?.slice(0, 5) || [];
            if (events.length) {
                const list = events.map(e => {
                    const d = new Date(e.startTimestamp * 1000);
                    return `📅 ${d.toDateString()} | ${e.homeTeam?.name} vs ${e.awayTeam?.name}`;
                }).join('\n');
                await socket.sendMessage(sender, {
                    text: `📅 *ᴜᴘᴄᴏᴍɪɴɢ: ${team.toUpperCase()}*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }
        }
        throw new Error('no matches');
    } catch {
        await socket.sendMessage(sender, {
            text: `📅 *ᴜᴘᴄᴏᴍɪɴɢ: ${args.join(' ') || 'chelsea'}*\n\n🔗 https://www.sofascore.com\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: gamehistory - Team match history
case 'gamehistory': {
    try {
        const team = args.join(' ') || 'chelsea';
        await socket.sendMessage(sender, { react: { text: '📋', key: msg.key } });
        
        const res = await axios.get(`https://api.sofascore.com/api/v1/team/search/${encodeURIComponent(team)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
        });
        const teamId = res.data?.teams?.[0]?.id;
        if (teamId) {
            const hist = await axios.get(`https://api.sofascore.com/api/v1/team/${teamId}/events/last/0`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
            });
            const events = hist.data?.events?.slice(-5).reverse() || [];
            if (events.length) {
                const list = events.map(e => {
                    const d = new Date(e.startTimestamp * 1000);
                    const hs = e.homeScore?.current ?? '-';
                    const as = e.awayScore?.current ?? '-';
                    return `📅 ${d.toDateString()}\n   ${e.homeTeam?.name} ${hs}-${as} ${e.awayTeam?.name}`;
                }).join('\n\n');
                await socket.sendMessage(sender, {
                    text: `📋 *ʜɪsᴛᴏʀʏ: ${team.toUpperCase()}*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }
        }
        throw new Error('no history');
    } catch {
        await socket.sendMessage(sender, {
            text: `📋 *ʜɪsᴛᴏʀʏ: ${args.join(' ') || 'chelsea'}*\n\n🔗 https://www.sofascore.com\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}
//============ GROUP COMMANDS (NO ADMIN RESTRICTIONS) ============
// Case: gjid / groupjid / grouplist - List group JIDs with copy
case 'gjid':
case 'groupjid':
case 'grouplist': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }
        
        await socket.sendMessage(sender, { react: { text: '📝', key: msg.key } });

        const groups = await socket.groupFetchAllParticipating();
        const groupIds = Object.keys(groups);
        
        if (!groupIds.length) {
            await socket.sendMessage(sender, {
                text: '❌ *ɴᴏ ɢʀᴏᴜᴘs*\n\nʙᴏᴛ ɪs ɴᴏᴛ ɪɴ ᴀɴʏ ɢʀᴏᴜᴘs.\n\n> ' + botConfig.BOT_FOOTER,
                quoted: msg
            });
            break;
        }
        
        const groupJids = groupIds.map((jid, i) => `${i + 1}. ${jid}`).join('\n');
        const allJids = groupIds.join('\n');
        const caption = `📝 *ɢʀᴏᴜᴘ ᴊɪᴅs ʟɪsᴛ*\n\n${groupJids}\n\n📊 *ᴛᴏᴛᴀʟ:* ${groupIds.length} ɢʀᴏᴜᴘs\n\n> ${botConfig.BOT_FOOTER}`;

        // Try CTA copy button with all JIDs
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: caption },
                                footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Copy All JIDs',
                                                copy_code: allJids
                                            })
                                        },
                                        {
                                            name: 'quick_reply',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Refresh',
                                                id: `${prefix}gjid`
                                            })
                                        },
                                        {
                                            name: 'quick_reply',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Broadcast',
                                                id: `${prefix}bc`
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: msg }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            // Fallback
            await socket.sendMessage(sender, {
                text: caption,
                buttons: [
                    { buttonId: `${prefix}gjid`, buttonText: { displayText: 'Refresh' }, type: 1 },
                    { buttonId: `${prefix}bc`, buttonText: { displayText: 'Broadcast' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: 'Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        
    } catch (error) {
        console.error('[GJID] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ғᴇᴛᴄʜ*\n\n${error.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: fullgpp / fullgp / gpp - Set group profile picture with channel CTA
case 'setgpp':
case 'setgp':
case 'gpp': {
    try {
        const quotedMsg2 = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedImage = quotedMsg2?.imageMessage;
        
        if (!quotedImage) {
            await socket.sendMessage(sender, {
                text: `🖼️ *sᴇᴛ ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ ᴛᴏ sᴇᴛ ᴀs ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ.\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        // Download the image
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // Save temp file
        const mediaPath = path.join(TEMP_MEDIA_DIR, `gpp_${Date.now()}.jpg`);
        await writeFile(mediaPath, buffer);

        // Process image with Jimp
        const image = await Jimp.read(mediaPath);
        const resized = await image.cover(720, 720).getBufferAsync(Jimp.MIME_JPEG);

        // Set profile picture
        await socket.query({
            tag: 'iq',
            attrs: { to: S_WHATSAPP_NET, type: 'set', xmlns: 'w:profile:picture' },
            content: [{ tag: 'picture', attrs: { type: 'image' }, content: resized }]
        });

        // Clean up
        try { fs.unlinkSync(mediaPath); } catch {}

        // Send success with CTA button
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: `✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ᴜᴘᴅᴀᴛᴇᴅ!*\n\n> ${botConfig.BOT_FOOTER}` },
                                footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: msg }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: `✅ *ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ᴜᴘᴅᴀᴛᴇᴅ!*\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[FullGPP] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${err.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: online / listonline / active - List online members
case 'online':
case 'listonline':
case 'active': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg });
            break;
        }
        await socket.sendMessage(sender, { react: { text: '🟢', key: msg.key } });
        const meta = await socket.groupMetadata(from);
        const participants = meta.participants.map(p => p.id);
        const list = participants.slice(0, 15).map((jid, i) => `${i + 1}. 🟢 @${jid.split('@')[0]}`).join('\n');
        await socket.sendMessage(sender, {
            text: `🟢 *ᴏɴʟɪɴᴇ ᴍᴇᴍʙᴇʀs*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
            mentions: participants.slice(0, 15),
            buttons: [
                { buttonId: `${prefix}members`, buttonText: { displayText: '👥 ᴍᴇᴍʙᴇʀs' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: kickall - Remove all non-admin members (owner only)
case 'kickall': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg }); break; }
        const meta = await socket.groupMetadata(from);
        const toKick = meta.participants.filter(p => !p.admin).map(p => p.id);
        await socket.sendMessage(sender, { text: `⚠️ *ᴋɪᴄᴋɪɴɢ ${toKick.length} ᴍᴇᴍʙᴇʀs...*`, quoted: msg });
        for (const id of toKick) {
            await socket.groupParticipantsUpdate(from, [id], 'remove');
            await new Promise(r => setTimeout(r, 500));
        }
        await socket.sendMessage(sender, { text: '✅ *ᴋɪᴄᴋᴇᴅ ᴀʟʟ ɴᴏɴ-ᴀᴅᴍɪɴs*', quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: req / requests - List join requests
case 'req':
case 'requests': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        const requests = await socket.groupRequestParticipantsList(from);
        if (!requests.length) {
            await socket.sendMessage(sender, { text: '📋 *ᴊᴏɪɴ ʀᴇǫᴜᴇsᴛs*\n\nɴᴏ ᴘᴇɴᴅɪɴɢ ʀᴇǫᴜᴇsᴛs.\n\n> ' + botConfig.BOT_FOOTER, quoted: msg });
            break;
        }
        const list = requests.map(p => '+ ' + p.jid.split('@')[0]).join('\n');
        await socket.sendMessage(sender, {
            text: `📋 *ᴊᴏɪɴ ʀᴇǫᴜᴇsᴛs (${requests.length})*\n\n${list}\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}accept`, buttonText: { displayText: '✅ ᴀᴄᴄᴇᴘᴛ ᴀʟʟ' }, type: 1 },
                { buttonId: `${prefix}reject`, buttonText: { displayText: '❌ ʀᴇᴊᴇᴄᴛ ᴀʟʟ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: approve / accept - Accept all join requests
case 'approve':
case 'accept': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        const requests = await socket.groupRequestParticipantsList(from);
        if (!requests.length) { await socket.sendMessage(sender, { text: '📋 ɴᴏ ᴘᴇɴᴅɪɴɢ ʀᴇǫᴜᴇsᴛs.', quoted: msg }); break; }
        for (const p of requests) {
            await socket.groupRequestParticipantsUpdate(from, [p.jid], 'approve');
        }
        await socket.sendMessage(sender, { text: `✅ *ᴀᴘᴘʀᴏᴠᴇᴅ ${requests.length} ʀᴇǫᴜᴇsᴛs*`, quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: reject / rejectall - Reject all join requests
case 'reject':
case 'rejectall': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        const requests = await socket.groupRequestParticipantsList(from);
        if (!requests.length) { await socket.sendMessage(sender, { text: '📋 ɴᴏ ᴘᴇɴᴅɪɴɢ ʀᴇǫᴜᴇsᴛs.', quoted: msg }); break; }
        for (const p of requests) {
            await socket.groupRequestParticipantsUpdate(from, [p.jid], 'reject');
        }
        await socket.sendMessage(sender, { text: `❌ *ʀᴇᴊᴇᴄᴛᴇᴅ ${requests.length} ʀᴇǫᴜᴇsᴛs*`, quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: create / newgroup / newgc - Create new group
case 'create':
case 'newgroup':
case 'newgc': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg }); break; }
        const groupName = args.join(' ').trim();
        if (!groupName) { await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}create <group name>\``, quoted: msg }); break; }
        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const group = await socket.groupCreate(groupName, mentions);
        await socket.sendMessage(group.id, { text: `🎉 *ᴡᴇʟᴄᴏᴍᴇ!*\n\nɢʀᴏᴜᴘ "${groupName}" ʜᴀs ʙᴇᴇɴ ᴄʀᴇᴀᴛᴇᴅ.\n\n> ${botConfig.BOT_FOOTER}` });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: rename / gname - Rename group
case 'rename':
case 'gname': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        const newName = args.join(' ').trim();
        if (!newName) { await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}rename <new name>\``, quoted: msg }); break; }
        await socket.groupUpdateSubject(from, newName);
        await socket.sendMessage(sender, { text: `✅ *ɢʀᴏᴜᴘ ʀᴇɴᴀᴍᴇᴅ ᴛᴏ:* ${newName}`, quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

// Case: desc / gdesc - Set group description
case 'desc':
case 'gdesc': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        const newDesc = args.join(' ').trim();
        if (!newDesc) { await socket.sendMessage(sender, { text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}desc <description>\``, quoted: msg }); break; }
        await socket.groupUpdateDescription(from, newDesc);
        await socket.sendMessage(sender, { text: `✅ *ᴅᴇsᴄʀɪᴘᴛɪᴏɴ ᴜᴘᴅᴀᴛᴇᴅ!*`, quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}


// ==============================================
// 👥 TAGALL COMMAND - Mention all group members
// ==============================================

// Case: tagall / everyone / all - Tag all group members
case 'tagall':
case 'everyone':
case 'all':
case 'mentions': {
    try {
        // Check if it's a group
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.',
                quoted: fakevCard
            });
            break;
        }

        // Send typing indicator
        await socket.sendPresenceUpdate('composing', from);

        // Get group metadata
        const groupMetadata = await socket.groupMetadata(from);
        const participants = groupMetadata.participants;
        const groupName = groupMetadata.subject || 'Group';
        const participantCount = participants.length;

        // Check if user has permission (admin or owner)
        const isAdmin = isSenderGroupAdmin || isOwner;
        if (!isAdmin) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴄᴀɴ ᴛᴀɢ ᴀʟʟ ᴍᴇᴍʙᴇʀs.',
                quoted: fakevCard
            });
            break;
        }

        // Extract custom message
        const customMessage = args.join(' ').trim() || '📢 Attention everyone!';

        // Get sender info
        const senderName = nowsender.split('@')[0];
        
        // Build mentions list
        const mentions = participants.map(p => getParticipantJid(p)).filter(Boolean);
        
        // Get admin list for special badge
        const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
        const adminIds = admins.map(p => getParticipantJid(p)).filter(Boolean);

        // Build the tag message
        let tagText = `╭━━〔 *👥 ᴛᴀɢ ᴀʟʟ* 〕━━┈⊷\n`;
        tagText += `┃\n`;
        tagText += `┃ 📢 *${customMessage}*\n`;
        tagText += `┃\n`;
        tagText += `┃ 👥 *ᴛᴏᴛᴀʟ ᴍᴇᴍʙᴇʀs:* ${participantCount}\n`;
        tagText += `┃ 🛡️ *ᴀᴅᴍɪɴs:* ${admins.length}\n`;
        tagText += `┃ 📌 *ɢʀᴏᴜᴘ:* ${groupName}\n`;
        tagText += `┃ 👤 *ʙʏ:* @${senderName}\n`;
        tagText += `┃\n`;
        tagText += `╰━━━━━━━━━━━━━━━━━━━━⊷\n\n`;

        // Add all members with numbers
        let memberList = '';
        participants.forEach((p, index) => {
            const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
            const emoji = isAdmin ? '🛡️' : '👤';
            const displayJid = getParticipantPhoneJid(p) || getParticipantJid(p);
            const name = displayJid ? displayJid.split('@')[0] : 'member';
            memberList += `${emoji} ${index + 1}. @${name}\n`;
        });

        // Truncate if too long (WhatsApp has message limits)
        const maxLength = 4000;
        if (memberList.length > maxLength) {
            memberList = memberList.substring(0, maxLength) + '\n... ᴀɴᴅ ᴍᴏʀᴇ ᴍᴇᴍʙᴇʀs';
        }

        tagText += memberList;
        tagText += `\n> ${botConfig.BOT_FOOTER}`;

        // Send the tag message with all mentions
        await socket.sendMessage(from, {
            text: tagText,
            mentions: mentions,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                externalAdReply: {
                    title: `👥 Tag All - ${participantCount} members`,
                    body: customMessage,
                    mediaType: 1,
                    thumbnailUrl: botConfig.RCD_IMAGE_PATH,
                    sourceUrl: botConfig.CHANNEL_LINK,
                    renderLargerThumbnail: true
                },
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                    serverMessageId: -1
                }
            },
            buttons: [
                { buttonId: `${prefix}tagadmins`, buttonText: { displayText: '🛡️ ᴛᴀɢ ᴀᴅᴍɪɴs' }, type: 1 },
                { buttonId: `${prefix}members`, buttonText: { displayText: '👥 ᴍᴇᴍʙᴇʀs' }, type: 1 },
                { buttonId: `${prefix}groupinfo`, buttonText: { displayText: '📊 ɢʀᴏᴜᴘ ɪɴғᴏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });

        // React with success
        await socket.sendMessage(sender, { 
            react: { text: '✅', key: msg.key } 
        });

        console.log(`[TagAll] ✅ Tagged ${participantCount} members in ${groupName}`);

    } catch (error) {
        console.error('[TagAll] Error:', error.message);
        
        // Send error message
        await socket.sendMessage(sender, {
            text: `❌ *ᴛᴀɢ ᴀʟʟ ғᴀɪʟᴇᴅ*\n\n${error.message || 'Unknown error occurred'}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });
        
        await socket.sendMessage(sender, { 
            react: { text: '❌', key: msg.key } 
        });
    }
    break;
}
// Case: lock / close - Lock group (Admin/Owner only)
case 'lock':
case 'close': {
    try {
        // Check if it's a group
        if (!isGroup) {
            await socket.sendMessage(sender, { 
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.', 
                quoted: msg 
            });
            break;
        }

        // Check if user is admin or owner
        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ʟᴏᴄᴋ ᴛʜɪs ɢʀᴏᴜᴘ.',
                quoted: msg
            });
            break;
        }

        // Lock the group
        await socket.groupSettingUpdate(from, 'announcement');
        
        // Send success message with unlock button
        await socket.sendMessage(sender, {
            text: `🔒 *ɢʀᴏᴜᴘ ʟᴏᴄᴋᴇᴅ!*\n\n✅ ᴏɴʟʏ ᴀᴅᴍɪɴs ᴄᴀɴ sᴇɴᴅ ᴍᴇssᴀɢᴇs ɴᴏᴡ.\n👤 *ʟᴏᴄᴋᴇᴅ ʙʏ:* @${senderNumber}`,
            mentions: [sender],
            buttons: [
                { 
                    buttonId: `${prefix}unlock`, 
                    buttonText: { displayText: '🔓 ᴜɴʟᴏᴄᴋ' }, 
                    type: 1 
                }
            ],
            headerType: 1
        }, { quoted: msg });

        // React with success
        await socket.sendMessage(sender, { 
            react: { text: '🔒', key: msg.key } 
        });

        console.log(`[Lock] 🔒 Group ${from} locked by ${senderNumber}`);

    } catch (e) { 
        console.error('[Lock] Error:', e.message);
        await socket.sendMessage(sender, { 
            text: '❌ *ғᴀɪʟᴇᴅ ᴛᴏ ʟᴏᴄᴋ ɢʀᴏᴜᴘ*\n\n' + e.message, 
            quoted: msg 
        });
    }
    break;
}

// Case: unlock / open - Unlock group (Admin/Owner only)
case 'unlock':
case 'open': {
    try {
        // Check if it's a group
        if (!isGroup) {
            await socket.sendMessage(sender, { 
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.', 
                quoted: msg 
            });
            break;
        }

        // Check if user is admin or owner
        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜɴʟᴏᴄᴋ ᴛʜɪs ɢʀᴏᴜᴘ.',
                quoted: msg
            });
            break;
        }

        // Unlock the group
        await socket.groupSettingUpdate(from, 'not_announcement');
        
        // Send success message with lock button
        await socket.sendMessage(sender, {
            text: `🔓 *ɢʀᴏᴜᴘ ᴜɴʟᴏᴄᴋᴇᴅ!*\n\n✅ ᴇᴠᴇʀʏᴏɴᴇ ᴄᴀɴ sᴇɴᴅ ᴍᴇssᴀɢᴇs ɴᴏᴡ.\n👤 *ᴜɴʟᴏᴄᴋᴇᴅ ʙʏ:* @${senderNumber}`,
            mentions: [sender],
            buttons: [
                { 
                    buttonId: `${prefix}lock`, 
                    buttonText: { displayText: '🔒 ʟᴏᴄᴋ' }, 
                    type: 1 
                }
            ],
            headerType: 1
        }, { quoted: msg });

        // React with success
        await socket.sendMessage(sender, { 
            react: { text: '🔓', key: msg.key } 
        });

        console.log(`[Unlock] 🔓 Group ${from} unlocked by ${senderNumber}`);

    } catch (e) { 
        console.error('[Unlock] Error:', e.message);
        await socket.sendMessage(sender, { 
            text: '❌ *ғᴀɪʟᴇᴅ ᴛᴏ ᴜɴʟᴏᴄᴋ ɢʀᴏᴜᴘ*\n\n' + e.message, 
            quoted: msg 
        });
    }
    break;
}

// Case: invite / link - Get group invite link
case 'invite':
case 'link': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        
        const code = await socket.groupInviteCode(from);
        const inviteLink = `https://chat.whatsapp.com/${code}`;
        const caption = `🔗 *ɢʀᴏᴜᴘ ɪɴᴠɪᴛᴇ ʟɪɴᴋ*\n\n${inviteLink}\n\n> ${botConfig.BOT_FOOTER}`;

        // One message with CTA copy button
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: caption },
                                footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Copy Link',
                                                copy_code: inviteLink
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: msg }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            // Fallback
            await socket.sendMessage(sender, {
                text: caption,
                buttons: [{ buttonId: `${prefix}revoke`, buttonText: { displayText: 'Revoke' }, type: 1 }],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}
// ============ BROADCAST COMMAND ============
case 'broadcast':
case 'bc': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const message = args.join(' ');
        if (!message) {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}bc <message>\``,
                quoted: msg
            });
            break;
        }

        // Get all contacts
        const contacts = await socket.contacts;
        let sent = 0;
        
        await socket.sendMessage(sender, {
            text: `📢 *Bʀᴏᴀᴅᴄᴀsᴛɪɴɢ...*\n\nTᴏᴛᴀʟ ᴄᴏɴᴛᴀᴄᴛs: ${Object.keys(contacts).length}`,
            quoted: msg
        });

        for (const [jid, contact] of Object.entries(contacts)) {
            if (jid.includes('@s.whatsapp.net')) {
                try {
                    await socket.sendMessage(jid, { 
                        text: `📢 *Bʀᴏᴀᴅᴄᴀsᴛ*\n\n${message}\n\n> ${botConfig.BOT_FOOTER}`
                    });
                    sent++;
                    await delay(500);
                } catch (e) {
                    console.error(`Failed to send to ${jid}:`, e.message);
                }
            }
        }

        await socket.sendMessage(sender, {
            text: `✅ *Bʀᴏᴀᴅᴄᴀsᴛ Cᴏᴍᴘʟᴇᴛᴇ!*\n\nSᴇɴᴛ ᴛᴏ: ${sent} ᴄᴏɴᴛᴀᴄᴛs`,
            quoted: msg
        });

    } catch (error) {
        console.error('Broadcast error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*\n\n' + error.message,
            quoted: msg
        });
    }
    break;
}
// Case: revoke / reset - Revoke group invite link
case 'revoke':
case 'reset': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        const newCode = await socket.groupRevokeInvite(from);
        await socket.sendMessage(sender, {
            text: `🔄 *ʟɪɴᴋ ʀᴇᴠᴏᴋᴇᴅ!*\n\nɴᴇᴡ: https://chat.whatsapp.com/${newCode}`,
            buttons: [{ buttonId: `${prefix}invite`, buttonText: { displayText: '🔗 ɢᴇᴛ ʟɪɴᴋ' }, type: 1 }],
            headerType: 1
        }, { quoted: msg });
    } catch (e) { await socket.sendMessage(sender, { text: '❌ ' + e.message, quoted: msg }); }
    break;
}

    case 'quote': {
    await socket.sendMessage(sender, { react: { text: '🤔', key: msg.key } });
        try {
            
            const response = await fetch('https://api.quotable.io/random');
            const data = await response.json();
            if (!data.content) {
                throw new Error('No quote found');
            }
            await socket.sendMessage(sender, {
                text: formatMessage(
                    '💭 SPICY QUOTE',
                    `📜 "${data.content}"\n— ${data.author}`,
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            }, { quoted: fakevCard });
        } catch (error) {
            console.error('Quote command error:', error);
            await socket.sendMessage(sender, { text: '❌ Oh, sweetie, the quotes got shy! 😢 Try again?' }, { quoted: fakevCard });
        }
        break;
    }
    
//    case 37


case 'tiny':
case 'short':
case 'shorturl': {
    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `*🏷️ sʜᴏʀᴛᴇɴ ᴜʀʟ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}short <url>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}short https://example.com\`\n\n> ${botConfig.BOT_FOOTER}`
        }, { quoted: msg });
    }

    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

    try {
        const link = args[0];
        const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`);
        const shortenedUrl = response.data;

        const caption = `*🧑‍💻 sʜᴏʀᴛᴇɴᴇᴅ ᴜʀʟ*\n\n${shortenedUrl}\n\n🔗 ᴏʀɪɢɪɴᴀʟ: ${link}\n\n> ${botConfig.BOT_FOOTER}`;

        // One message with one CTA copy button
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: caption },
                                footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: 'Copy Link',
                                                copy_code: shortenedUrl
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: msg }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, { text: caption }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[ShortURL] Error:', e.message);
        await socket.sendMessage(sender, {
            text: '❌ ᴀɴ ᴇʀʀᴏʀ ᴏᴄᴄᴜʀʀᴇᴅ.',
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: owner / creator / developer - Owner details
// Case: owner / creator / developer - Owner details
case 'owner':
case 'creator':
case 'developer': {
    try {
        await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });

        const botOwner = 'ᴄᴀsᴇʏʀʜᴏᴅᴇs';
        const ownerNumber = '254117312277';

        const caption = `*👑 ʙᴏᴛ ᴏᴡɴᴇʀ ᴅᴇᴛᴀɪʟs*\n\n` +
                       `*ɴᴀᴍᴇ:* ${botOwner}\n` +
                       `*ᴄᴏɴᴛᴀᴄᴛ:* ${ownerNumber}\n\n` +
                       `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ`;

        // Send ONE message with copy button + DM button (no vCard)
        const ctaMsg = generateWAMessageFromContent(
            sender,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: caption },
                            footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: {
                                buttons: [
                                    {
                                        name: 'cta_copy',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: ' Copy Number',
                                            copy_code: ownerNumber
                                        })
                                    },
                                    {
                                        name: 'cta_url',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '💬 DM Owner',
                                            url: `https://wa.me/${ownerNumber}`
                                        })
                                    },
                                    {
                                        name: 'cta_url',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '📢 Join Channel',
                                            url: botConfig.CHANNEL_LINK
                                        })
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            { quoted: fakevCard }
        );
        await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Owner] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n${error.message}\n\n> ${botConfig.BOT_FOOTER}`,
            quoted: fakevCard
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}


// Case: weather / climate - Weather forecast
case 'weather':
case 'climate': {
    try {
        const location = args.join(' ').trim();
        if (!location) {
            await socket.sendMessage(sender, {
                text: `🌦️ *ᴡᴇᴀᴛʜᴇʀ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}weather <city>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}weather Nairobi\`\n\`${prefix}weather London\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🌦️', key: msg.key } });

        const res = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
            params: { q: location, units: 'metric', appid: '060a6bcfa19809c2cd4d97a212b19273', language: 'en' }
        });
        const data = res.data;

        const weatherText = `🌦️ *ᴡᴇᴀᴛʜᴇʀ: ${data.name}, ${data.sys.country}*\n\n` +
            `🌡️ *ᴛᴇᴍᴘ:* ${data.main.temp}°C (ғᴇᴇʟs ʟɪᴋᴇ ${data.main.feels_like}°C)\n` +
            `📊 *ᴍɪɴ/ᴍᴀx:* ${data.main.temp_min}°C / ${data.main.temp_max}°C\n` +
            `☁️ *ᴅᴇsᴄ:* ${data.weather[0].description}\n` +
            `💧 *ʜᴜᴍɪᴅɪᴛʏ:* ${data.main.humidity}%\n` +
            `💨 *ᴡɪɴᴅ:* ${data.wind.speed} m/s\n` +
            `☁️ *ᴄʟᴏᴜᴅs:* ${data.clouds.all}%\n\n` +
            `> ${botConfig.BOT_FOOTER}`;

        // CTA buttons
        try {
            const ctaMsg = generateWAMessageFromContent(sender, {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: weatherText },
                            footer: { text: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                            nativeFlowMessage: {
                                buttons: [
                                    {
                                        name: 'cta_url',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '📢 Join Channel',
                                            url: botConfig.CHANNEL_LINK
                                        })
                                    },
                                    {
                                        name: 'quick_reply',
                                        buttonParamsJson: JSON.stringify({
                                            display_text: '🌦️ Check Again',
                                            id: `${prefix}weather`
                                        })
                                    }
                                ]
                            }
                        }
                    }
                }
            }, { quoted: msg });
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, { text: weatherText }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch {
        await socket.sendMessage(sender, { text: `❌ *ɴᴏᴛ ғᴏᴜɴᴅ*\n\n> ${botConfig.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: ytmp3 / mp3 - YouTube to MP3
case 'tmp3':
case 'ymp3': {
    try {
        const text = args.join(' ').trim();
        if (!text) {
            await socket.sendMessage(sender, {
                text: `🎵 *ʏᴏᴜᴛᴜʙᴇ ᴍᴘ3*\n\n*ᴜsᴀɢᴇ:* \`${prefix}ytmp3 <song>\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        const search = await yts(text);
        const video = search.videos[0];
        if (!video) { await socket.sendMessage(sender, { text: '❌ *ɴᴏ ʀᴇsᴜʟᴛs*', quoted: msg }); break; }

        const apiURL = `https://noobs-api.top/dipto/ytDl3?link=${encodeURIComponent(video.videoId)}&format=mp3`;
        const response = await axios.get(apiURL);
        if (!response.data?.downloadLink) { await socket.sendMessage(sender, { text: '❌ *ғᴀɪʟᴇᴅ*', quoted: msg }); break; }

        await socket.sendMessage(sender, {
            audio: { url: response.data.downloadLink },
            mimetype: 'audio/mpeg',
            fileName: `${video.title.replace(/[\\/:*?"<>|]/g, '')}.mp3`
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ *ᴇʀʀᴏʀ*', quoted: msg }); }
    break;
}

// Case: ytmp4 / ytv - YouTube video download
case 'ytmp4':
case 'ytv':
case 'ytvideo': {
    try {
        const text = args.join(' ').trim();
        if (!text) {
            await socket.sendMessage(sender, {
                text: `🎬 *ʏᴏᴜᴛᴜʙᴇ ᴠɪᴅᴇᴏ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}ytmp4 <query>\`\n\n> ${botConfig.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎬', key: msg.key } });
        const search = await yts(text);
        const video = search.videos[0];
        if (!video) { await socket.sendMessage(sender, { text: '❌ *ɴᴏ ʀᴇsᴜʟᴛs*', quoted: msg }); break; }

        const apiURL = `https://noobs-api.top/dipto/ytDl3?link=${encodeURIComponent(video.videoId)}&format=mp4`;
        const response = await axios.get(apiURL);
        if (!response.data?.downloadLink) { await socket.sendMessage(sender, { text: '❌ *ғᴀɪʟᴇᴅ*', quoted: msg }); break; }

        await socket.sendMessage(sender, {
            video: { url: response.data.downloadLink },
            caption: `🎬 *${video.title}*\n\n> ${botConfig.BOT_FOOTER}`
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ *ᴇʀʀᴏʀ*', quoted: msg }); }
    break;
}
// Case: repo / sc / script - Repository info with CTA buttons
case 'repo':
case 'sc':
case 'script': {
    try {
        await socket.sendMessage(sender, { react: { text: '📦', key: msg.key } });

        const repoApiUrl = 'https://api.github.com/repos/caseyweb/CASEYRHODES-XMD';
        const repoUrl = 'https://github.com/caseyweb/CASEYRHODES-XMD';
        let caption = '';

        try {
            const { data } = await axios.get(repoApiUrl, {
                headers: { 'User-Agent': 'CaseyRhodes-Bot' },
                timeout: 5000
            });

            const stars = data.stargazers_count.toLocaleString();
            const forks = data.forks_count.toLocaleString();
            const watchers = data.watchers_count.toLocaleString();
            const createdAt = new Date(data.created_at).toLocaleDateString('en-GB');
            const lastUpdated = new Date(data.pushed_at).toLocaleDateString('en-GB');

            caption = `*📦 ɢɪᴛʜᴜʙ ʀᴇᴘᴏsɪᴛᴏʀʏ*\n\n` +
                      `🤖 *ʙᴏᴛ:* ${botConfig.OWNER_NAME}\n` +
                      `📁 *ʀᴇᴘᴏ:* CASEYRHODES-XMD\n` +
                      `👤 *ᴏᴡɴᴇʀ:* caseyweb\n\n` +
                      `📊 *sᴛᴀᴛs:*\n` +
                      `⭐ *sᴛᴀʀs:* ${stars}\n` +
                      `🍴 *ғᴏʀᴋs:* ${forks}\n` +
                      `👀 *ᴡᴀᴛᴄʜᴇʀs:* ${watchers}\n` +
                      `📅 *ᴄʀᴇᴀᴛᴇᴅ:* ${createdAt}\n` +
                      `♻️ *ᴜᴘᴅᴀᴛᴇᴅ:* ${lastUpdated}\n\n` +
                      `🔗 ${repoUrl}\n\n` +
                      `> ${botConfig.BOT_FOOTER}`;
        } catch {
            caption = `*📦 ɢɪᴛʜᴜʙ ʀᴇᴘᴏsɪᴛᴏʀʏ*\n\n` +
                      `🤖 *ʙᴏᴛ:* ${botConfig.OWNER_NAME}\n` +
                      `📁 *ʀᴇᴘᴏ:* CASEYRHODES-XMD\n` +
                      `👤 *ᴏᴡɴᴇʀ:* caseyweb\n\n` +
                      `🔗 ${repoUrl}\n\n` +
                      `> ${botConfig.BOT_FOOTER}`;
        }

        // ONE message with CTA buttons
        try {
            const ctaMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: {
                                body: { text: caption },
                                footer: { text: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ' },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '⭐ Star on GitHub',
                                                url: repoUrl
                                            })
                                        },
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📢 Join Channel',
                                                url: botConfig.CHANNEL_LINK
                                            })
                                        },
                                        {
                                            name: 'quick_reply',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: '📋 Menu',
                                                id: `${prefix}menu`
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { quoted: fakevCard }
            );
            await socket.relayMessage(sender, ctaMsg.message, { messageId: ctaMsg.key.id });
        } catch {
            await socket.sendMessage(sender, {
                text: caption,
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Repo] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `*📦 ɢɪᴛʜᴜʙ ʀᴇᴘᴏ*\n\n🤖 ${botConfig.OWNER_NAME}\n🔗 https://github.com/caseyweb/CASEYRHODES-XMD\n\n> ${botConfig.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 Menu' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: botConfig.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                        )
                    });
                    break;
                    
// more future commands                  
                 
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: botConfig.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === botConfig.NEWSLETTER_JID) return;
        
        if (botConfig.AUTO_TYPING === 'true') {
            try {
                await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
                console.log(`Set typing presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set typing presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const localPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`, 'bot-settings', 'config.json');
        if (fs.existsSync(localPath)) {
            return JSON.parse(fs.readFileSync(localPath, 'utf8'));
        }
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return cloneDefaultConfig();
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    const botState = socket.__botState;
    const botConfig = socket.__botConfig;

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: botConfig.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const botState = await createBotState(sanitizedNumber, sessionPath);
    const botConfig = botState.config;
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        // =========================================================
        // 🎁 GIFTED BUTTONS INTEGRATION
        // All legacy `buttons:` and raw interactiveMessage sends
        // are routed through gifted-btns. Baileys remains the
        // WhatsApp transport/auth layer.
        // =========================================================
        const installGiftedButtons = (sock) => {
            if (!sock || sock.__giftedButtonsInstalled) return sock;

            const originalSendMessage = sock.sendMessage.bind(sock);
            const originalRelayMessage = sock.relayMessage.bind(sock);
            let giftedRelayDepth = 0;

            const normalizeGiftedButtons = (buttons = []) => {
                const list = buttons.filter(Boolean);
                if (!list.length) return [];

                // Keep explicit native-flow buttons (single_select/category, CTA URL, etc.) intact.
                const explicit = list.filter(b => b.name && b.buttonParamsJson);
                if (explicit.length) return explicit.concat(list.filter(b => b.nativeFlowInfo?.name).map(b => ({
                    name: b.nativeFlowInfo.name,
                    buttonParamsJson: b.nativeFlowInfo.paramsJson || JSON.stringify({})
                })));

                const native = list.filter(b => b.nativeFlowInfo?.name);
                if (native.length) return native.map(b => ({
                    name: b.nativeFlowInfo.name,
                    buttonParamsJson: b.nativeFlowInfo.paramsJson || JSON.stringify({})
                }));

                // Convert every legacy quick-button array into one WhatsApp native-flow
                // single_select category. This avoids the old buttonsResponseMessage format.
                const rows = list.map((button, index) => {
                    const id = button.buttonId || button.id || `${botConfig.PREFIX}option${index + 1}`;
                    const title = button.buttonText?.displayText || button.text || `Option ${index + 1}`;
                    return { title, description: 'Select this option', id };
                });

                return [{
                    name: 'single_select',
                    buttonParamsJson: JSON.stringify({
                        title: '📂 ᴄʜᴏᴏsᴇ ᴀɴ ᴏᴘᴛɪᴏɴ',
                        sections: [{ title: 'ᴏᴘᴛɪᴏɴs', rows }]
                    })
                }];
            };

            sock.sendMessage = async function (jid, content, options = {}) {
                if (content && Array.isArray(content.buttons) && content.buttons.length) {
                    const interactiveButtons = normalizeGiftedButtons(content.buttons);

                    const giftedContent = {
                        text: content.text || content.caption || '',
                        footer: content.footer || '',
                        interactiveButtons
                    };

                    if (content.title) giftedContent.title = content.title;
                    if (content.subtitle) giftedContent.subtitle = content.subtitle;
                    if (content.image) giftedContent.image = content.image;
                    if (content.contextInfo) giftedContent.contextInfo = content.contextInfo;
                    if (content.mentions) giftedContent.mentions = content.mentions;

                    // Gifted interactive messages support an image header, not arbitrary
                    // media payloads. Preserve video/audio/document/sticker messages by
                    // sending the media first, then the Gifted button message.
                    const unsupportedMedia = content.video || content.audio || content.document || content.sticker || content.location || content.contacts || content.poll;
                    if (unsupportedMedia) {
                        const mediaContent = { ...content };
                        delete mediaContent.buttons;
                        await originalSendMessage(jid, mediaContent, options);
                    }

                    giftedRelayDepth++;
                    try {
                        return await sendInteractiveMessage(sock, jid, giftedContent, options);
                    } finally {
                        giftedRelayDepth--;
                    }
                }

                return originalSendMessage(jid, content, options);
            };

            sock.relayMessage = async function (jid, message, options = {}) {
                // Some native interactive messages (notably the main menu) contain
                // a real imageMessage header. Let Baileys relay those untouched so
                // the image is preserved instead of gifted-btns rebuilding the message
                // without its media header.
                if (sock.__bypassGiftedRelay) {
                    return originalRelayMessage(jid, message, options);
                }
                if (giftedRelayDepth > 0) {
                    return originalRelayMessage(jid, message, options);
                }

                const interactive =
                    message?.interactiveMessage ||
                    message?.viewOnceMessage?.message?.interactiveMessage ||
                    message?.viewOnceMessageV2?.message?.interactiveMessage;

                if (interactive?.nativeFlowMessage?.buttons?.length) {
                    const nativeButtons = interactive.nativeFlowMessage.buttons;

                    const giftedContent = {
                        text: interactive.body?.text || '',
                        footer: interactive.footer?.text || '',
                        interactiveButtons: nativeButtons
                    };

                    if (interactive.header?.title) giftedContent.title = interactive.header.title;
                    if (interactive.header?.subtitle) giftedContent.subtitle = interactive.header.subtitle;

                    giftedRelayDepth++;
                    try {
                        return await sendInteractiveMessage(sock, jid, giftedContent, options);
                    } finally {
                        giftedRelayDepth--;
                    }
                }

                return originalRelayMessage(jid, message, options);
            };

            sock.__giftedButtonsInstalled = true;
            return sock;
        };

        // Use a current WhatsApp Web version and the requested Firefox/Windows identity.
        let waWebVersion;
        try {
            const latestWaWeb = await fetchLatestWaWebVersion({});
            waWebVersion = latestWaWeb?.version;
            if (Array.isArray(waWebVersion)) {
                console.log('[Pairing] WhatsApp Web version:', waWebVersion.join('.'));
            }
        } catch (versionError) {
            console.warn('[Pairing] Could not fetch latest WhatsApp Web version:', versionError.message);
        }

        const socketOptions = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            // Restore the original Firefox/Windows browser identity.
            browser: Browsers.windows('Firefox'),
            connectTimeoutMs: 60_000,
        };

        if (Array.isArray(waWebVersion) && waWebVersion.length === 3) {
            socketOptions.version = waWebVersion;
        }

        const socket = makeWASocket(socketOptions);

        socket.__botState = botState;
        socket.__botConfig = botConfig;
        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupWelcomeGoodbyeHandlers(socket);
        setupAntiDelete(socket);
        initAntiCallHandler(socket);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        setupAutoReact(socket);  // Initialize auto-react
        setupAntilink(socket);  // Initialize antilink
        setupChatbot(socket);  // Initialize chatbot

        if (!socket.authState.creds.registered) {
            let retries = botConfig.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    // Give the WebSocket/companion handshake a moment to settle
                    // before asking WhatsApp for a pairing code.
                    await delay(2500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    if (!code) throw new Error('WhatsApp returned an empty pairing code');
                    console.log('[Pairing] Pairing code generated successfully');
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`[Pairing] Failed to request pairing code (${retries} retries left):`, error.message);
                    if (retries > 0) await delay(2500);
                }
            }
            if (!res.headersSent) {
                if (code) {
                    res.send({ code });
                } else {
                    res.status(503).send({
                        error: 'Unable to generate a valid WhatsApp pairing code. Please try again.'
                    });
                }
            }
        }

        // Install the optional native-button relay only after pairing has been
        // requested. This keeps the pairing path completely untouched.
        installGiftedButtons(socket);

    
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        const persisted = await loadUserConfig(sanitizedNumber);
                        Object.assign(botState.config, persisted || {});
                        socket.__botConfig = botState.config;
                        botState.saveConfig();
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, botState.config);
                        botState.saveConfig();
                    }

                    activeSockets.set(sanitizedNumber, socket);

const groupStatus = groupResult.status === 'success'
    ? 'ᴊᴏɪɴᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ'
    : `ғᴀɪʟᴇᴅ ᴛᴏ ᴊᴏɪɴ ɢʀᴏᴜᴘ: ${groupResult.error}`;
// Single message with image and newsletter context (NO BUTTONS)
await socket.sendMessage(userJid, {
    image: { url: botConfig.RCD_IMAGE_PATH },
    caption: formatMessage(
        '👻 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 👻',
        `✅ Successfully connected!\n\n` +
        `🔢 ɴᴜᴍʙᴇʀ: ${sanitizedNumber}\n` +
        `🏠 ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}\n` +
        `⏰ ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}\n\n` +
        `📢 ғᴏʟʟᴏᴡ ᴍᴀɪɴ ᴄʜᴀɴɴᴇʟ 👇\n` +
        `${botConfig.CHANNEL_LINK}\n\n` +
        `🤖 ᴛʏᴘᴇ *${botConfig.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!`,
        '> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ 🎀'
    ),
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363420261263259@newsletter',
            newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
            serverMessageId: -1
        }
    }
});

// Admin connect notification is optional; no shared/global settings are used here.


// Improved file handling with error checking
let numbers = [];
try {
    if (fs.existsSync(NUMBER_LIST_PATH)) {
        const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
        numbers = JSON.parse(fileContent) || [];
    }
    
    if (!numbers.includes(sanitizedNumber)) {
        numbers.push(sanitizedNumber);
        
        // Create backup before writing
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
        }
        
        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        console.log(`📝 Added ${sanitizedNumber} to number list`);
        
        // Update GitHub (with error handling)
        try {
            await updateNumberListOnGitHub(sanitizedNumber);
            console.log(`☁️ GitHub updated for ${sanitizedNumber}`);
        } catch (githubError) {
            console.warn(`⚠️ GitHub update failed:`, githubError.message);
        }
    }
} catch (fileError) {
    console.error(`❌ File operation failed:`, fileError.message);
    // Continue execution even if file operations fail
}
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '👻 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + (activeSockets.get(sanitizedNumber)?.__botConfig?.OTP_EXPIRY || config.OTP_EXPIRY), newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket?.__botState) {
            Object.assign(socket.__botState.config, storedData.newConfig || {});
            socket.__botConfig = socket.__botState.config;
            socket.__botState.saveConfig();
        }
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: socket?.__botConfig?.RCD_IMAGE_PATH || config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/caseywebstech/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}

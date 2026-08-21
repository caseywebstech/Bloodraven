const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')
const path = require('path')

// ==============================================
// 📁 TEMP DIRECTORY FOR MEDIA DOWNLOADS
// ==============================================
const TEMP_DIR = path.join(process.cwd(), 'temp')
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
}

// Clean up old files periodically
const cleanupTempFiles = () => {
    try {
        const files = fs.readdirSync(TEMP_DIR)
        const now = Date.now()
        let deleted = 0
        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file)
            try {
                const stats = fs.statSync(filePath)
                // Delete files older than 1 hour
                if (now - stats.mtimeMs > 3600000) {
                    fs.unlinkSync(filePath)
                    deleted++
                }
            } catch (e) {
                // File might have been deleted already
            }
        }
        if (deleted > 0) {
            console.log(`[Temp] Cleaned ${deleted} old files from temp directory`)
        }
    } catch (err) {
        console.error('[Temp] Cleanup error:', err.message)
    }
}

// Run cleanup every hour
setInterval(cleanupTempFiles, 3600000)

// ==============================================
// 📥 DOWNLOAD MEDIA MESSAGE
// ==============================================
const downloadMediaMessage = async (m, filename) => {
    try {
        if (!m || !m.msg) {
            throw new Error('Invalid message object')
        }

        // Handle view-once messages
        if (m.type === 'viewOnceMessage') {
            m.type = m.msg.type
        }

        let buffer = Buffer.from([])
        let filePath = ''
        let resultBuffer = null

        // ========== IMAGE ==========
        if (m.type === 'imageMessage') {
            const nameJpg = filename ? filename + '.jpg' : `img_${Date.now()}.jpg`
            filePath = path.join(TEMP_DIR, nameJpg)
            const stream = await downloadContentFromMessage(m.msg, 'image')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            resultBuffer = fs.readFileSync(filePath)
            // Clean up after reading
            try { fs.unlinkSync(filePath) } catch (e) {}
            return resultBuffer
        }

        // ========== VIDEO ==========
        else if (m.type === 'videoMessage') {
            const nameMp4 = filename ? filename + '.mp4' : `vid_${Date.now()}.mp4`
            filePath = path.join(TEMP_DIR, nameMp4)
            const stream = await downloadContentFromMessage(m.msg, 'video')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            resultBuffer = fs.readFileSync(filePath)
            try { fs.unlinkSync(filePath) } catch (e) {}
            return resultBuffer
        }

        // ========== AUDIO ==========
        else if (m.type === 'audioMessage') {
            const mime = m.msg.mimetype || ''
            const ext = mime.includes('mpeg') ? 'mp3' : (mime.includes('ogg') ? 'ogg' : 'mp3')
            const nameMp3 = filename ? filename + '.' + ext : `aud_${Date.now()}.${ext}`
            filePath = path.join(TEMP_DIR, nameMp3)
            const stream = await downloadContentFromMessage(m.msg, 'audio')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            resultBuffer = fs.readFileSync(filePath)
            try { fs.unlinkSync(filePath) } catch (e) {}
            return resultBuffer
        }

        // ========== STICKER ==========
        else if (m.type === 'stickerMessage') {
            const nameWebp = filename ? filename + '.webp' : `stk_${Date.now()}.webp`
            filePath = path.join(TEMP_DIR, nameWebp)
            const stream = await downloadContentFromMessage(m.msg, 'sticker')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            resultBuffer = fs.readFileSync(filePath)
            try { fs.unlinkSync(filePath) } catch (e) {}
            return resultBuffer
        }

        // ========== DOCUMENT ==========
        else if (m.type === 'documentMessage') {
            const ext = m.msg.fileName ? m.msg.fileName.split('.').pop().toLowerCase().replace('jpeg', 'jpg').replace('png', 'jpg').replace('m4a', 'mp3') : 'pdf'
            const nameDoc = filename ? filename + '.' + ext : `doc_${Date.now()}.${ext}`
            filePath = path.join(TEMP_DIR, nameDoc)
            const stream = await downloadContentFromMessage(m.msg, 'document')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            resultBuffer = fs.readFileSync(filePath)
            try { fs.unlinkSync(filePath) } catch (e) {}
            return resultBuffer
        }

        // ========== CONTACT (VCARD) ==========
        else if (m.type === 'contactMessage') {
            const vcard = m.msg.vcard || ''
            const nameContact = filename ? filename + '.vcf' : `contact_${Date.now()}.vcf`
            filePath = path.join(TEMP_DIR, nameContact)
            fs.writeFileSync(filePath, vcard)
            resultBuffer = fs.readFileSync(filePath)
            try { fs.unlinkSync(filePath) } catch (e) {}
            return resultBuffer
        }

        // ========== LOCATION ==========
        else if (m.type === 'locationMessage') {
            const lat = m.msg.degreesLatitude || 0
            const lng = m.msg.degreesLongitude || 0
            const locationText = `📍 Location: ${lat}, ${lng}\nhttps://maps.google.com/?q=${lat},${lng}`
            return Buffer.from(locationText)
        }

        // ========== POLL ==========
        else if (m.type === 'pollCreationMessage') {
            const pollName = m.msg.name || 'Poll'
            const options = m.msg.options?.map(o => o.optionName).join(', ') || ''
            const pollText = `📊 Poll: ${pollName}\nOptions: ${options}`
            return Buffer.from(pollText)
        }

        // ========== REACTION ==========
        else if (m.type === 'reactionMessage') {
            const emoji = m.msg.text || '❤️'
            const reactionText = `Reaction: ${emoji}`
            return Buffer.from(reactionText)
        }

        // Unsupported type
        return null

    } catch (error) {
        console.error('[DownloadMedia] Error:', error.message)
        return null
    }
}

// ==============================================
// 📨 MESSAGE PROCESSOR (SMS)
// ==============================================
const sms = (conn, m) => {
    try {
        if (!conn || !m) return m

        // ========== BASIC MESSAGE INFO ==========
        if (m.key) {
            m.id = m.key.id
            m.chat = m.key.remoteJid
            m.fromMe = m.key.fromMe
            m.isGroup = m.chat ? m.chat.endsWith('@g.us') : false
            m.isNewsletter = m.chat ? m.chat.endsWith('@newsletter') : false
            m.isStatus = m.chat === 'status@broadcast'
            m.sender = m.fromMe ? 
                conn.user.id.split(':')[0] + '@s.whatsapp.net' : 
                m.isGroup ? (m.key.participant || m.sender) : 
                (m.key.remoteJid || m.sender)
        }

        // ========== MESSAGE CONTENT ==========
        if (m.message) {
            // Handle ephemeral messages (auto-deleting)
            const raw = m.message.ephemeralMessage?.message || m.message
            m.type = getContentType(raw)

            // View-once wrapper
            if (m.type === 'viewOnceMessage') {
                const innerType = getContentType(raw.viewOnceMessage.message)
                m.msg = raw.viewOnceMessage.message[innerType]
                m.msg.type = innerType
                m.viewOnce = true
                m.type = innerType // Update type to actual content
            } else if (m.type === 'viewOnceMessageV2') {
                const innerType = getContentType(raw.viewOnceMessageV2.message)
                m.msg = raw.viewOnceMessageV2.message[innerType]
                m.msg.type = innerType
                m.viewOnce = true
                m.type = innerType
            } else {
                m.msg = raw[m.type]
            }

            if (m.msg) {
                // ========== MENTIONS ==========
                var quotedMention = m.msg.contextInfo ? m.msg.contextInfo.participant : ''
                var tagMention = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
                var mention = Array.isArray(tagMention) ? tagMention : [tagMention]
                if (quotedMention) mention.push(quotedMention)
                m.mentionUser = [...new Set(mention.filter(x => x))] // Remove duplicates

                // ========== BODY EXTRACTION (ALL TYPES) ==========
                m.body = ''
                
                // Text messages
                if (m.type === 'conversation') {
                    m.body = m.msg || ''
                } else if (m.type === 'extendedTextMessage') {
                    m.body = m.msg.text || ''
                }
                // Media with captions
                else if (m.type === 'imageMessage') {
                    m.body = m.msg.caption || ''
                } else if (m.type === 'videoMessage') {
                    m.body = m.msg.caption || ''
                } else if (m.type === 'audioMessage') {
                    m.body = m.msg.caption || ''
                } else if (m.type === 'documentMessage') {
                    m.body = m.msg.caption || ''
                }
                // Interactive messages
                else if (m.type === 'buttonsResponseMessage') {
                    m.body = m.msg.selectedButtonId || m.msg.selectedDisplayText || ''
                } else if (m.type === 'templateButtonReplyMessage') {
                    m.body = m.msg.selectedId || m.msg.selectedDisplayText || ''
                } else if (m.type === 'listResponseMessage') {
                    m.body = m.msg.singleSelectReply?.selectedRowId || m.msg.title || ''
                } else if (m.type === 'interactiveResponseMessage') {
                    try {
                        const json = JSON.parse(m.msg.nativeFlowResponseMessage?.paramsJson || '{}')
                        m.body = json.id || json.text || ''
                    } catch { 
                        m.body = m.msg.body || ''
                    }
                }
                // Poll messages
                else if (m.type === 'pollCreationMessage') {
                    m.body = m.msg.name || ''
                } else if (m.type === 'pollUpdateMessage') {
                    m.body = 'Poll vote'
                } else if (m.type === 'pollVoteMessage') {
                    m.body = 'Poll vote'
                }
                // Reactions
                else if (m.type === 'reactionMessage') {
                    m.body = `Reacted with ${m.msg.text || 'emoji'}`
                }
                // Contacts
                else if (m.type === 'contactMessage') {
                    m.body = m.msg.displayName || 'Contact'
                }
                // Location
                else if (m.type === 'locationMessage') {
                    const lat = m.msg.degreesLatitude || 0
                    const lng = m.msg.degreesLongitude || 0
                    m.body = `📍 Location: ${lat}, ${lng}`
                }
                // Live location
                else if (m.type === 'liveLocationMessage') {
                    const lat = m.msg.degreesLatitude || 0
                    const lng = m.msg.degreesLongitude || 0
                    m.body = `📍 Live Location: ${lat}, ${lng}`
                }
                // Sticker
                else if (m.type === 'stickerMessage') {
                    m.body = '🎨 Sticker'
                }
                // Product
                else if (m.type === 'productMessage') {
                    m.body = m.msg.product?.title || 'Product'
                }
                // Order
                else if (m.type === 'orderMessage') {
                    m.body = `Order: ${m.msg.orderId || ''}`
                }
                // Group invites
                else if (m.type === 'groupInviteMessage') {
                    m.body = `Group invite: ${m.msg.groupJid || ''}`
                }

                // If still no body, try to get from raw message
                if (!m.body && m.msg.text) {
                    m.body = m.msg.text
                }

                // ========== QUOTED MESSAGE ==========
                if (m.msg.contextInfo && m.msg.contextInfo.quotedMessage) {
                    m.quoted = m.msg.contextInfo.quotedMessage
                    if (m.quoted) {
                        m.quoted.type = getContentType(m.quoted)
                        m.quoted.id = m.msg.contextInfo.stanzaId
                        m.quoted.sender = m.msg.contextInfo.participant || m.msg.contextInfo.remoteJid
                        m.quoted.fromMe = m.quoted.sender ? 
                            m.quoted.sender.split('@')[0].includes(conn.user.id.split(':')[0]) : 
                            false
                        m.quoted.msg = m.quoted[m.quoted.type]
                        
                        if (m.quoted.msg) {
                            m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename)
                            m.quoted.delete = async () => {
                                try {
                                    await conn.sendMessage(m.chat, {
                                        delete: m.quoted.key || m.msg.contextInfo.stanzaId
                                    })
                                } catch (err) {
                                    console.error('[Quoted] Delete error:', err.message)
                                }
                            }
                            m.quoted.react = async (emoji) => {
                                try {
                                    await conn.sendMessage(m.chat, {
                                        react: { text: emoji, key: m.quoted.key }
                                    })
                                } catch (err) {
                                    console.error('[Quoted] React error:', err.message)
                                }
                            }
                        }
                    }
                }
            }

            m.download = (filename) => downloadMediaMessage(m, filename)
        }

        // ========== REPLY SHORTCUTS ==========
        m.reply = async (teks, id = m.chat, option = { mentions: [m.sender] }) => {
            try {
                return await conn.sendMessage(id, { 
                    text: teks, 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('[Reply] Error:', error.message)
                return null
            }
        }

        m.replyS = async (stik, id = m.chat, option = { mentions: [m.sender] }) => {
            try {
                return await conn.sendMessage(id, { 
                    sticker: stik, 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyS] Error:', error.message)
                return null
            }
        }

        m.replyImg = async (img, teks, id = m.chat, option = { mentions: [m.sender] }) => {
            try {
                return await conn.sendMessage(id, { 
                    image: img, 
                    caption: teks, 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyImg] Error:', error.message)
                return null
            }
        }

        m.replyVid = async (vid, teks, id = m.chat, option = { mentions: [m.sender], gif: false }) => {
            try {
                return await conn.sendMessage(id, { 
                    video: vid, 
                    caption: teks, 
                    gifPlayback: option.gif, 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyVid] Error:', error.message)
                return null
            }
        }

        m.replyAud = async (aud, id = m.chat, option = { mentions: [m.sender], ptt: false }) => {
            try {
                return await conn.sendMessage(id, { 
                    audio: aud, 
                    ptt: option.ptt, 
                    mimetype: 'audio/mpeg', 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyAud] Error:', error.message)
                return null
            }
        }

        m.replyDoc = async (doc, id = m.chat, option = { mentions: [m.sender], filename: 'undefined.pdf', mimetype: 'application/pdf' }) => {
            try {
                return await conn.sendMessage(id, { 
                    document: doc, 
                    mimetype: option.mimetype, 
                    fileName: option.filename, 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyDoc] Error:', error.message)
                return null
            }
        }

        m.replyContact = (name, info, number) => {
            try {
                var vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:' + name + '\nORG:' + info + ';\nTEL;type=CELL;type=VOICE;waid=' + number + ':+' + number + '\nEND:VCARD'
                conn.sendMessage(m.chat, { 
                    contacts: { displayName: name, contacts: [{ vcard }] } 
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyContact] Error:', error.message)
            }
        }

        m.replyLocation = async (lat, lng, teks, id = m.chat) => {
            try {
                return await conn.sendMessage(id, { 
                    location: { degreesLatitude: lat, degreesLongitude: lng },
                    caption: teks || ''
                }, { quoted: m })
            } catch (error) {
                console.error('[ReplyLocation] Error:', error.message)
                return null
            }
        }

        m.react = async (emoji) => {
            try {
                await conn.sendMessage(m.chat, { 
                    react: { text: emoji, key: m.key } 
                })
            } catch (error) {
                console.error('[React] Error:', error.message)
            }
        }

        // ========== PRESENCE HELPERS ==========
        m.sendTyping = async (duration = 2000) => {
            try {
                await conn.sendPresenceUpdate('composing', m.chat)
                setTimeout(async () => {
                    await conn.sendPresenceUpdate('paused', m.chat)
                }, duration)
            } catch (error) {
                console.error('[Typing] Error:', error.message)
            }
        }

        m.sendRecording = async (duration = 2000) => {
            try {
                await conn.sendPresenceUpdate('recording', m.chat)
                setTimeout(async () => {
                    await conn.sendPresenceUpdate('paused', m.chat)
                }, duration)
            } catch (error) {
                console.error('[Recording] Error:', error.message)
            }
        }

        // ========== UTILITY HELPERS ==========
        m.isOwner = (ownerNumber) => {
            return m.sender === ownerNumber || m.sender.split('@')[0] === ownerNumber
        }

        m.isAdmin = async () => {
            if (!m.isGroup) return false
            try {
                const groupMetadata = await conn.groupMetadata(m.chat)
                const participant = groupMetadata.participants.find(p => p.id === m.sender)
                return participant?.admin === 'admin' || participant?.admin === 'superadmin'
            } catch (error) {
                return false
            }
        }

        return m

    } catch (error) {
        console.error('[SMS] Error:', error.message)
        return m
    }
}

module.exports = { sms, downloadMediaMessage, cleanupTempFiles }

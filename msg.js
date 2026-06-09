const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')
const path = require('path')

// Create a temp directory for downloads
const TEMP_DIR = path.join(process.cwd(), 'temp')
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
}

// Clean up old files periodically
const cleanupTempFiles = () => {
    const files = fs.readdirSync(TEMP_DIR)
    const now = Date.now()
    files.forEach(file => {
        const filePath = path.join(TEMP_DIR, file)
        const stats = fs.statSync(filePath)
        // Delete files older than 1 hour
        if (now - stats.mtimeMs > 3600000) {
            fs.unlinkSync(filePath)
        }
    })
}
setInterval(cleanupTempFiles, 3600000) // Run every hour

const downloadMediaMessage = async (m, filename) => {
    try {
        if (!m || !m.msg) {
            throw new Error('Invalid message object')
        }

        if (m.type === 'viewOnceMessage') {
            m.type = m.msg.type
        }
        
        let buffer = Buffer.from([])
        let filePath = ''
        
        if (m.type === 'imageMessage') {
            var nameJpg = filename ? filename + '.jpg' : `img_${Date.now()}.jpg`
            filePath = path.join(TEMP_DIR, nameJpg)
            const stream = await downloadContentFromMessage(m.msg, 'image')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            return fs.readFileSync(filePath)
        } 
        else if (m.type === 'videoMessage') {
            var nameMp4 = filename ? filename + '.mp4' : `vid_${Date.now()}.mp4`
            filePath = path.join(TEMP_DIR, nameMp4)
            const stream = await downloadContentFromMessage(m.msg, 'video')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            return fs.readFileSync(filePath)
        } 
        else if (m.type === 'audioMessage') {
            var nameMp3 = filename ? filename + '.mp3' : `aud_${Date.now()}.mp3`
            filePath = path.join(TEMP_DIR, nameMp3)
            const stream = await downloadContentFromMessage(m.msg, 'audio')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            return fs.readFileSync(filePath)
        } 
        else if (m.type === 'stickerMessage') {
            var nameWebp = filename ? filename + '.webp' : `stk_${Date.now()}.webp`
            filePath = path.join(TEMP_DIR, nameWebp)
            const stream = await downloadContentFromMessage(m.msg, 'sticker')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            return fs.readFileSync(filePath)
        } 
        else if (m.type === 'documentMessage') {
            var ext = m.msg.fileName ? m.msg.fileName.split('.').pop().toLowerCase().replace('jpeg', 'jpg').replace('png', 'jpg').replace('m4a', 'mp3') : 'pdf'
            var nameDoc = filename ? filename + '.' + ext : `doc_${Date.now()}.${ext}`
            filePath = path.join(TEMP_DIR, nameDoc)
            const stream = await downloadContentFromMessage(m.msg, 'document')
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }
            fs.writeFileSync(filePath, buffer)
            return fs.readFileSync(filePath)
        }
        
        return null
    } catch (error) {
        console.error('Error downloading media:', error)
        return null
    }
}

const sms = (conn, m) => {
    if (!conn || !m) return m
    
    try {
        if (m.key) {
            m.id = m.key.id
            m.chat = m.key.remoteJid
            m.fromMe = m.key.fromMe
            m.isGroup = m.chat ? m.chat.endsWith('@g.us') : false
            m.sender = m.fromMe ? conn.user.id.split(':')[0] + '@s.whatsapp.net' : 
                       m.isGroup ? (m.key.participant || m.sender) : 
                       (m.key.remoteJid || m.sender)
        }

        if (m.message) {
            // Handle ephemeral messages (auto‑deleting)
            const raw = m.message.ephemeralMessage?.message || m.message
            m.type = getContentType(raw)

            // View‑once wrapper
            if (m.type === 'viewOnceMessage') {
                const innerType = getContentType(raw.viewOnceMessage.message)
                m.msg = raw.viewOnceMessage.message[innerType]
                m.msg.type = innerType
                m.viewOnce = true
                m.type = innerType // Update type to actual content
            } else {
                m.msg = raw[m.type]
            }

            if (m.msg) {
                // Mentions
                var quotedMention = m.msg.contextInfo ? m.msg.contextInfo.participant : ''
                var tagMention = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
                var mention = Array.isArray(tagMention) ? tagMention : [tagMention]
                if (quotedMention) mention.push(quotedMention)
                m.mentionUser = [...new Set(mention.filter(x => x))] // Remove duplicates

                // *** IMPROVED BODY EXTRACTION (covers all important types) ***
                m.body = ''
                if (m.type === 'conversation') {
                    m.body = m.msg || ''
                } else if (m.type === 'extendedTextMessage') {
                    m.body = m.msg.text || ''
                } else if (m.type === 'imageMessage') {
                    m.body = m.msg.caption || ''
                } else if (m.type === 'videoMessage') {
                    m.body = m.msg.caption || ''
                } else if (m.type === 'buttonsResponseMessage') {
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
                } else if (m.type === 'pollCreationMessage') {
                    m.body = m.msg.name || ''
                } else if (m.type === 'pollUpdateMessage') {
                    m.body = 'Poll vote'
                } else if (m.type === 'reactionMessage') {
                    m.body = `Reacted with ${m.msg.text || 'emoji'}`
                }

                // If still no body, try to get from raw message
                if (!m.body && m.msg.text) {
                    m.body = m.msg.text
                }

                // Quoted message handling
                if (m.msg.contextInfo && m.msg.contextInfo.quotedMessage) {
                    m.quoted = m.msg.contextInfo.quotedMessage
                    if (m.quoted) {
                        m.quoted.type = getContentType(m.quoted)
                        m.quoted.id = m.msg.contextInfo.stanzaId
                        m.quoted.sender = m.msg.contextInfo.participant || m.msg.contextInfo.remoteJid
                        m.quoted.fromMe = m.quoted.sender ? m.quoted.sender.split('@')[0].includes(conn.user.id.split(':')[0]) : false
                        m.quoted.msg = m.quoted[m.quoted.type]
                        
                        if (m.quoted.msg) {
                            m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename)
                            m.quoted.delete = async () => {
                                try {
                                    await conn.sendMessage(m.chat, {
                                        delete: m.quoted.key || m.msg.contextInfo.stanzaId
                                    })
                                } catch (err) {
                                    console.error('Failed to delete quoted message:', err)
                                }
                            }
                            m.quoted.react = async (emoji) => {
                                try {
                                    await conn.sendMessage(m.chat, {
                                        react: { text: emoji, key: m.quoted.key }
                                    })
                                } catch (err) {
                                    console.error('Failed to react to quoted message:', err)
                                }
                            }
                        }
                    }
                }
            }

            m.download = (filename) => downloadMediaMessage(m, filename)
        }

        // Enhanced reply functions with error handling
        m.reply = async (teks, id = m.chat, option = { mentions: [m.sender] }) => {
            try {
                return await conn.sendMessage(id, { 
                    text: teks, 
                    contextInfo: { mentionedJid: option.mentions } 
                }, { quoted: m })
            } catch (error) {
                console.error('Reply error:', error)
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
                console.error('Sticker reply error:', error)
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
                console.error('Image reply error:', error)
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
                console.error('Video reply error:', error)
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
                console.error('Audio reply error:', error)
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
                console.error('Document reply error:', error)
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
                console.error('Contact reply error:', error)
            }
        }

        m.react = async (emoji) => {
            try {
                await conn.sendMessage(m.chat, { 
                    react: { text: emoji, key: m.key } 
                })
            } catch (error) {
                console.error('React error:', error)
            }
        }

        // Additional helper: check if sender is bot owner
        m.isOwner = (ownerNumber) => {
            return m.sender === ownerNumber || m.sender.split('@')[0] === ownerNumber
        }

        // Helper to send typing indicator
        m.sendTyping = async (duration = 2000) => {
            try {
                await conn.sendPresenceUpdate('composing', m.chat)
                setTimeout(async () => {
                    await conn.sendPresenceUpdate('paused', m.chat)
                }, duration)
            } catch (error) {
                console.error('Typing indicator error:', error)
            }
        }

        return m
    } catch (error) {
        console.error('Error in sms function:', error)
        return m
    }
}

module.exports = { sms, downloadMediaMessage, cleanupTempFiles }

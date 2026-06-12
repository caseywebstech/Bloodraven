Update this too 

const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')

const downloadMediaMessage = async (m, filename) => {
    if (m.type === 'viewOnceMessage') {
        m.type = m.msg.type
    }
    if (m.type === 'imageMessage') {
        var nameJpg = filename ? filename + '.jpg' : 'undefined.jpg'
        const stream = await downloadContentFromMessage(m.msg, 'image')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameJpg, buffer)
        return fs.readFileSync(nameJpg)
    } else if (m.type === 'videoMessage') {
        var nameMp4 = filename ? filename + '.mp4' : 'undefined.mp4'
        const stream = await downloadContentFromMessage(m.msg, 'video')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameMp4, buffer)
        return fs.readFileSync(nameMp4)
    } else if (m.type === 'audioMessage') {
        var nameMp3 = filename ? filename + '.mp3' : 'undefined.mp3'
        const stream = await downloadContentFromMessage(m.msg, 'audio')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameMp3, buffer)
        return fs.readFileSync(nameMp3)
    } else if (m.type === 'stickerMessage') {
        var nameWebp = filename ? filename + '.webp' : 'undefined.webp'
        const stream = await downloadContentFromMessage(m.msg, 'sticker')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameWebp, buffer)
        return fs.readFileSync(nameWebp)
    } else if (m.type === 'documentMessage') {
        var ext = m.msg.fileName.split('.').pop().toLowerCase().replace('jpeg', 'jpg').replace('png', 'jpg').replace('m4a', 'mp3')
        var nameDoc = filename ? filename + '.' + ext : 'undefined.' + ext
        const stream = await downloadContentFromMessage(m.msg, 'document')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        fs.writeFileSync(nameDoc, buffer)
        return fs.readFileSync(nameDoc)
    }
}

const sms = (conn, m) => {
    if (m.key) {
        m.id = m.key.id
        m.chat = m.key.remoteJid
        m.fromMe = m.key.fromMe
        m.isGroup = m.chat.endsWith('@g.us')
        m.sender = m.fromMe ? conn.user.id.split(':')[0] + '@s.whatsapp.net' : m.isGroup ? m.key.participant : m.key.remoteJid
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
        } else {
            m.msg = raw[m.type]
        }

        if (m.msg) {
            // Mentions
            var quotedMention = m.msg.contextInfo ? m.msg.contextInfo.participant : ''
            var tagMention = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
            var mention = Array.isArray(tagMention) ? tagMention : [tagMention]
            if (quotedMention) mention.push(quotedMention)
            m.mentionUser = mention.filter(x => x)

            // *** BODY EXTRACTION (covers all important types) ***
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
                m.body = m.msg.selectedButtonId || ''
            } else if (m.type === 'templateButtonReplyMessage') {
                m.body = m.msg.selectedId || ''
            } else if (m.type === 'listResponseMessage') {
                m.body = m.msg.singleSelectReply?.selectedRowId || ''
            } else if (m.type === 'interactiveResponseMessage') {
                // Native flow / interactive messages
                try {
                    const json = JSON.parse(m.msg.nativeFlowResponseMessage?.paramsJson || '{}')
                    m.body = json.id || ''
                } catch { m.body = '' }
            }

            // Quoted message
            m.quoted = m.msg.contextInfo ? m.msg.contextInfo.quotedMessage : null
            if (m.quoted) {
                m.quoted.type = getContentType(m.quoted)
                m.quoted.id = m.msg.contextInfo.stanzaId
                m.quoted.sender = m.msg.contextInfo.participant
                m.quoted.fromMe = m.quoted.sender.split('@')[0].includes(conn.user.id.split(':')[0])
                m.quoted.msg = m.quoted[m.quoted.type]
                m.quoted.download = (filename) => downloadMediaMessage(m.quoted, filename)
                m.quoted.delete = () => conn.sendMessage(m.chat, {
                    delete: m.quoted.fakeObj.key
                })
                m.quoted.react = (emoji) => conn.sendMessage(m.chat, {
                    react: { text: emoji, key: m.quoted.fakeObj.key }
                })
            }
        }

        m.download = (filename) => downloadMediaMessage(m, filename)
    }

    // Shortcuts for replies
    m.reply = (teks, id = m.chat, option = { mentions: [m.sender] }) =>
        conn.sendMessage(id, { text: teks, contextInfo: { mentionedJid: option.mentions } }, { quoted: m })

    m.replyS = (stik, id = m.chat, option = { mentions: [m.sender] }) =>
        conn.sendMessage(id, { sticker: stik, contextInfo: { mentionedJid: option.mentions } }, { quoted: m })

    m.replyImg = (img, teks, id = m.chat, option = { mentions: [m.sender] }) =>
        conn.sendMessage(id, { image: img, caption: teks, contextInfo: { mentionedJid: option.mentions } }, { quoted: m })

    m.replyVid = (vid, teks, id = m.chat, option = { mentions: [m.sender], gif: false }) =>
        conn.sendMessage(id, { video: vid, caption: teks, gifPlayback: option.gif, contextInfo: { mentionedJid: option.mentions } }, { quoted: m })

    m.replyAud = (aud, id = m.chat, option = { mentions: [m.sender], ptt: false }) =>
        conn.sendMessage(id, { audio: aud, ptt: option.ptt, mimetype: 'audio/mpeg', contextInfo: { mentionedJid: option.mentions } }, { quoted: m })

    m.replyDoc = (doc, id = m.chat, option = { mentions: [m.sender], filename: 'undefined.pdf', mimetype: 'application/pdf' }) =>
        conn.sendMessage(id, { document: doc, mimetype: option.mimetype, fileName: option.filename, contextInfo: { mentionedJid: option.mentions } }, { quoted: m })

    m.replyContact = (name, info, number) => {
        var vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:' + name + '\nORG:' + info + ';\nTEL;type=CELL;type=VOICE;waid=' + number + ':+' + number + '\nEND:VCARD'
        conn.sendMessage(m.chat, { contacts: { displayName: name, contacts: [{ vcard }] } }, { quoted: m })
    }

    m.react = (emoji) => conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } })

    return m
}

module.exports = { sms, downloadMediaMessage }

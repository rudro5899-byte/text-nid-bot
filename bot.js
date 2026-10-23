const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

const PHONE_NUMBER = "8801973906022"; 
const BKASH_NUMBER = process.env.BKASH_NUMBER || "+8801798391770"; 
const ADMIN_CONTACT = "8801905876973"; 
const API_KEY = process.env.API_KEY || "51b038a045ef49e2dffbd6afb924efc9"; 

app.get('/', (req, res) => res.send('NID Bot is Running Live!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));

const users = {};
let isPairingRequested = false;

async function startBot() {
    if (fs.existsSync('./auth_info_baileys')) {
        try {
            fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
            console.log("🔄 purono session shoyongkriyভাবে muche fela hoyeche!");
        } catch (e) {
            console.log("Session clear error:", e);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Chrome", "Desktop", "120.0.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered && !isPairingRequested) {
        isPairingRequested = true;
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER.replace(/[^0-9]/g, ''));
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log("\n================ PAIRING CODE ================\n");
                console.log(`🔑 Pairing Code: ${code}`);
                console.log("\n==============================================\n");
            } catch (err) {
                console.log("Pairing Code error...", err);
                isPairingRequested = false;
            }
        }, 15000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot Active & Connected!\n');
            isPairingRequested = false;
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(startBot, 8000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const sender = msg.key.remoteJid;
            const isFromMe = msg.key.fromMe;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const cleanText = text.trim().toLowerCase();

            const isQuoted = msg.message.extendedTextMessage?.contextInfo?.participant;
            const targetUser = isQuoted || sender;

            if (!users[targetUser]) users[targetUser] = { tokens: 5 };
            const user = users[targetUser];

            if (cleanText.startsWith('!settoken')) {
                const cleanAdmin = ADMIN_CONTACT.replace(/[^0-9]/g, '');
                const senderNumber = sender.replace(/[^0-9]/g, '');

                if (!isFromMe && senderNumber !== cleanAdmin) {
                    await sock.sendMessage(sender, { text: '❌ Dukkhito, kebol admin token set korte parben!' });
                    return;
                }

                const amount = parseInt(cleanText.split(' ')[1]);
                if (!isNaN(amount)) {
                    users[targetUser].tokens = amount;
                    await sock.sendMessage(sender, { text: `✅ Token set kora hoyeche: ${amount}` });
                }
                return;
            }

            if (isFromMe) continue;

            if (cleanText === 'balance' || cleanText === 'token' || cleanText === 'টোকেন') {
                await sock.sendMessage(sender, { text: `Apnar bortoman token: ${user.tokens}` });
            } else if (cleanText.includes('nid') || cleanText.includes('এনআইডি')) {
                if (user.tokens <= 0) {
                    await sock.sendMessage(sender, { 
                        text: `⚠️ *Apnar account-e kono token nei!*\n\nBkash send money korun: ${BKASH_NUMBER}` 
                    });
                    return;
                }

                const parts = text.trim().split(/\s+/);
                const nidNumber = parts[1];
                const dob = parts[2];

                if (!nidNumber || !dob) {
                    await sock.sendMessage(sender, { text: '⚠️ Sothikvabe likhun:\nnid <NID_Number> <YYYY-MM-DD>' });
                    return;
                }

                user.tokens -= 1;
                await sock.sendMessage(sender, { text: `⏳ Mukh server theke tottho o original PDF fetch kora hocche...` });

                try {
                    const apiUrl = `https://virtual-suport.com/sv.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                    const response = await axios.get(apiUrl);
                    const resData = response.data;

                    if (resData && resData.success && resData['data-Info']) {
                        const info = resData['data-Info'];
                        
                        const targetUrl = `https://virtual-suport.com/pdf.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                        const pdfResponse = await axios.get(targetUrl, { responseType: 'arraybuffer' });
                        const originalBuffer = Buffer.from(pdfResponse.data);

                        const preAddr = typeof info.preAddress === 'object' ? (info.preAddress?.addressLine || Object.values(info.preAddress || {}).filter(Boolean).join(', ')) : (info.preAddress || 'N/A');
                        const perAddr = typeof info.perAddress === 'object' ? (info.perAddress?.addressLine || Object.values(info.perAddress || {}).filter(Boolean).join(', ')) : (info.perAddress || 'N/A');

                        const replyText = `✅ *NID server copy paoa geche!*\n\n` +
                            `👤 *Nam (Bangla):* ${info.nameBangla || 'N/A'}\n` +
                            `👤 *Nam (English):* ${info.nameEnglish || 'N/A'}\n` +
                            `🆔 *National ID No:* ${info.nationalId || nidNumber}\n` +
                            `📌 *Pin No:* ${info.pin || 'N/A'}\n` +
                            `📅 *Date of Birth:* ${info.dateOfBirth || dob}\n` +
                            `♂️ *Gender:* ${info.gender || 'N/A'}\n` +
                            `🩸 *Blood Group:* ${info.bloodGroup || 'N/A'}\n` +
                            `👨‍👦 *Father Name:* ${info.fatherName || 'N/A'}\n` +
                            `👩‍👦 *Mother Name:* ${info.motherName || 'N/A'}\n` +
                            `🏠 *Present Address:* ${preAddr}\n` +
                            `🏠 *Permanent Address:* ${perAddr}`;

                        if (info.photo) {
                            await sock.sendMessage(sender, { image: { url: info.photo }, caption: replyText });
                        } else {
                            await sock.sendMessage(sender, { text: replyText });
                        }

                        await sock.sendMessage(sender, {
                            document: originalBuffer,
                            mimetype: 'application/pdf',
                            fileName: `NID_Server_Copy_${nidNumber}.pdf`
                        });

                    } else {
                        await sock.sendMessage(sender, { text: '⚠️ Dukkhito, ei NID ebong jonmo tarikh diye kono tottho paoa jayni.' });
                    }
                } catch (error) {
                    console.error("Error:", error);
                    await sock.sendMessage(sender, { text: '⚠️ Server theke tottho shongrohe shomoshya hoyeche.' });
                }
            }
        }
    });
}

startBot();

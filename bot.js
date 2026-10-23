const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

const PHONE_NUMBER = "8801905876973"; 
const BKASH_NUMBER = process.env.BKASH_NUMBER || "+8801798391770"; 
const ADMIN_CONTACT = "8801905876973"; 
const API_KEY = process.env.API_KEY || "51b038a045ef49e2dffbd6afb924efc9"; 

// Render Domain
const BOT_SERVER_URL = "https://text-nid-bot.onrender.com";

app.get('/', (req, res) => res.send('NID Bot is Running Live!'));

// 🛡️ NO ACCESS TO MAIN SERVER / DIRECT PDF DOWNLOAD ONLY
app.get('/pdf', async (req, res) => {
    const { nid, dob } = req.query;
    if (!nid || !dob) {
        return res.status(400).send("NID and DOB required");
    }
    try {
        const targetUrl = `https://virtual-suport.com/nid.php?key=${API_KEY}&nid=${nid}&dob=${dob}`;
        
        // Backend fetching as arraybuffer stream
        const response = await axios.get(targetUrl, { responseType: 'stream' });
        
        // Force PDF download header (User kono page dekhbe na, direct download hobe)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="NID_Server_Copy_${nid}.pdf"`);
        
        response.data.pipe(res);
    } catch (err) {
        res.status(500).send("Error generating PDF file");
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));

const users = {};
let isPairingRequested = false;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
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
                console.log(" Pairing Code error...", err);
                isPairingRequested = false;
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot Active!\n');
            isPairingRequested = false;
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
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

            if (!users[targetUser]) users[targetUser] = { tokens: 0 };
            const user = users[targetUser];

            if (cleanText.startsWith('!settoken')) {
                const cleanAdmin = ADMIN_CONTACT.replace(/[^0-9]/g, '');
                const senderNumber = sender.replace(/[^0-9]/g, '');

                if (!isFromMe && senderNumber !== cleanAdmin) {
                    await sock.sendMessage(sender, { text: '❌ Dukhito, kebol admin-i token set korte parben!' });
                    return;
                }

                const amount = parseInt(cleanText.split(' ')[1]);

                if (!isNaN(amount)) {
                    users[targetUser].tokens = amount;
                    await sock.sendMessage(sender, { text: `✅ Token set kora hoyeche: ${amount}` });
                    if (targetUser !== sender) {
                        await sock.sendMessage(targetUser, { text: `🎉 Apnar account-e ${amount} ti token yukto hoyeche!` });
                    }
                }
                return;
            }

            if (isFromMe) continue;

            if (cleanText === 'balance' || cleanText === 'token' || cleanText === 'টোকেন') {
                await sock.sendMessage(sender, { text: `Apnar bortoman token: ${user.tokens}` });
            } else if (cleanText.includes('nid') || cleanText.includes('এনআইডি')) {
                if (user.tokens <= 0) {
                    await sock.sendMessage(sender, { 
                        text: `⚠️ Apnar account-e kono token nei!\n\nToken recharge korte bKash Send Money korun:\n📱 bKash (Send Money): ${BKASH_NUMBER}\n\nTaka pathanor por Trnx ID ebong koto taka pathayechen ta ekhane message korun.` 
                    });
                    return;
                }

                const parts = text.trim().split(/\s+/);
                const nidNumber = parts[1];
                const dob = parts[2];

                if (!nidNumber || !dob) {
                    await sock.sendMessage(sender, { text: '⚠️ Sothikbhabe likhun:\nnid <nid_number> <dob>' });
                    return;
                }

                user.tokens -= 1;
                await sock.sendMessage(sender, { text: `⏳ Process hocche... (Oboshto token: ${user.tokens})` });

                try {
                    const apiUrl = `https://virtual-suport.com/sv.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                    const response = await axios.get(apiUrl);
                    const resData = response.data;

                    if (resData && resData.success && resData['data-Info']) {
                        const info = resData['data-Info'];
                        
                        // Direct Download Link
                        const downloadPdfUrl = `${BOT_SERVER_URL}/pdf?nid=${nidNumber}&dob=${dob}`;
                        
                        const replyText = `✅ *NID Server Copy Found!*\n\n` +
                            `👤 *Name (Bangla):* ${info.nameBangla}\n` +
                            `👤 *Name (English):* ${info.nameEnglish}\n` +
                            `🆔 *NID No:* ${info.nationalId}\n` +
                            `📌 *PIN No:* ${info.pin}\n` +
                            `📅 *Date of Birth:* ${info.dateOfBirth}\n` +
                            `♂️ *Gender:* ${info.gender}\n` +
                            `🩸 *Blood Group:* ${info.bloodGroup}\n` +
                            `👨‍👦 *Father:* ${info.fatherName}\n` +
                            `👩‍👦 *Mother:* ${info.motherName}\n` +
                            `🏠 *Present Address:* ${info.preAddress?.addressLine || 'N/A'}\n` +
                            `🏠 *Permanent Address:* ${info.perAddress?.addressLine || 'N/A'}\n\n` +
                            `📥 *Download PDF:* ${downloadPdfUrl}`;

                        if (info.photo) {
                            await sock.sendMessage(sender, { 
                                image: { url: info.photo }, 
                                caption: replyText 
                            });
                        } else {
                            await sock.sendMessage(sender, { text: replyText });
                        }

                    } else {
                        await sock.sendMessage(sender, { text: '⚠️ Dukkhito, ei NID ebong birth date diye kono totho paoya jayni.' });
                    }
                } catch (error) {
                    await sock.sendMessage(sender, { text: '⚠️ Server-e songjukto hote somosya hoyeche.' });
                }
            }
        }
    });
}

startBot();

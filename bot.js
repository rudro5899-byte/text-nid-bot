const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');

// Render Port Fix
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('NID Bot is Running Live!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));

const PHONE_NUMBER = process.env.PHONE_NUMBER || "8801905876973"; 
const BKASH_NUMBER = process.env.BKASH_NUMBER || "+8801798391770"; 
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || "8801905876973"; 
const API_KEY = process.env.API_KEY || "51b038a045ef49e2dffbd6afb924efc9"; 

const users = {};

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

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER.replace(/[^0-9]/g, ''));
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log("\n================ PAIRING CODE ================\n");
                console.log(`🔑 Pairing Code: ${code}`);
                console.log("\n==============================================\n");
            } catch (err) {
                console.log(" Pairing Code error...", err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot Active!\n');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
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
                    await sock.sendMessage(sender, { text: '❌ দুঃখিত, কেবল অ্যাডমিনই টোকেন সেট করতে পারবেন!' });
                    return;
                }

                const amount = parseInt(cleanText.split(' ')[1]);

                if (!isNaN(amount)) {
                    users[targetUser].tokens = amount;
                    await sock.sendMessage(sender, { text: `✅ টোকেন সেট করা হয়েছে: ${amount}` });
                    if (targetUser !== sender) {
                        await sock.sendMessage(targetUser, { text: `🎉 আপনার অ্যাকাউন্টে ${amount} টি টোকেন যুক্ত হয়েছে!` });
                    }
                }
                return;
            }

            if (isFromMe) continue;

            if (cleanText === 'balance' || cleanText === 'token' || cleanText === 'টোকেন') {
                await sock.sendMessage(sender, { text: `আপনার বর্তমান টোকেন: ${user.tokens}` });
            } else if (cleanText.includes('nid') || cleanText.includes('এনআইডি')) {
                if (user.tokens <= 0) {
                    await sock.sendMessage(sender, { 
                        text: `⚠️ আপনার অ্যাকাউন্টে কোনো টোকেন নেই!\n\nটোকেন রিচার্জ করতে বিকাশ সেন্ড মানি করুন:\n📱 বিকাশ (Send Money): ${BKASH_NUMBER}\n\nটাকা পাঠানোর পর Trnx ID এবং কত টাকা পাঠিয়েছেন তা এখানে মেসেজ করুন:\n📌 উদাহরণ: TrnxID 9A8B7C6D 100tk\n\nঅ্যাডমিন Trnx ID চেক করে আপনার অ্যাকাউন্টে টোকেন যুক্ত করে দেবে!` 
                    });
                    return;
                }

                const parts = text.trim().split(/\s+/);
                const nidNumber = parts[1];
                const dob = parts[2];

                if (!nidNumber || !dob) {
                    await sock.sendMessage(sender, { text: '⚠️ সঠিকভাবে লিখুন:\nnid <nid_number> <dob>' });
                    return;
                }

                user.tokens -= 1;
                await sock.sendMessage(sender, { text: `⏳ প্রসেস হচ্ছে... (অবশিষ্ট: ${user.tokens})` });

                try {
                    const apiUrl = `https://virtual-suport.com/nid.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                    const response = await axios.get(apiUrl);
                    const pdfLink = response.data?.pdfUrl || response.data?.downloadUrl || response.data?.file || response.data?.url || (typeof response.data === 'string' && response.data.startsWith('http') ? response.data : null);

                    if (pdfLink) {
                        await sock.sendMessage(sender, {
                            document: { url: pdfLink },
                            mimetype: 'application/pdf',
                            fileName: `NID_${nidNumber}.pdf`,
                            caption: '✅ NID Server Copy PDF ফাইল।'
                        });
                    } else {
                        await sock.sendMessage(sender, { text: '⚠️ ফাইল পাওয়া যায়নি।' });
                    }
                } catch (error) {
                    await sock.sendMessage(sender, { text: '⚠️ সার্ভারে সমস্যা হয়েছে।' });
                }
            }
        }
    });
}

startBot();

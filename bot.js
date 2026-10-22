const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');

const PHONE_NUMBER = process.env.PHONE_NUMBER || "8801798391770"; // আপনার হোয়াটসঅ্যাপ নম্বর (কান্ট্রি কোড সহ)
const BKASH_NUMBER = process.env.BKASH_NUMBER || "+8801798391770"; 
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || "+8801973906022"; 
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
                console.log(`🔑 আপনার হোয়াটসঅ্যাপ কানেক্ট করার Pairing Code: ${code}`);
                console.log("\n==============================================\n");
            } catch (err) {
                console.log(" Pairing Code তৈরিতে সমস্যা হয়েছে, পুনরায় চেষ্টা করা হচ্ছে...", err);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot সফলভাবে যুক্ত এবং চালু হয়েছে!\n');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const sender = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const cleanText = text.trim().toLowerCase();

            if (!users[sender]) users[sender] = { tokens: 0 };
            const user = users[sender];

            if (cleanText.startsWith('!settoken')) {
                const isQuoted = msg.message.extendedTextMessage?.contextInfo?.participant;
                const targetUser = isQuoted || sender;
                const amount = parseInt(cleanText.split(' ')[1]);

                if (!isNaN(amount)) {
                    if (!users[targetUser]) users[targetUser] = { tokens: 0 };
                    users[targetUser].tokens = amount;
                    await sock.sendMessage(sender, { text: `✅ টোকেন সেট করা হয়েছে: ${amount}` });
                    await sock.sendMessage(targetUser, { text: `🎉 আপনার অ্যাকাউন্টে ${amount} টি টোকেন যুক্ত হয়েছে!` });
                }
                return;
            }

            if (cleanText === 'balance' || cleanText === 'টোকেন') {
                await sock.sendMessage(sender, { text: `আপনার বর্তমান টোকেন: ${user.tokens}` });
            } else if (cleanText.includes('nid') || cleanText.includes('এনআইডি')) {
                if (user.tokens <= 0) {
                    await sock.sendMessage(sender, { text: `⚠️ টোকেন নেই!\n বিকাশ: ${BKASH_NUMBER}\nকন্টাক্ট: ${ADMIN_CONTACT}` });
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

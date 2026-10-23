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

app.get('/', (req, res) => res.send('NID Bot is Running Live!'));
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
                        text: `⚠️ *আপনার অ্যাকাউন্টে কোনো টোকেন নেই!*\n\nটোকেন রিচার্জ করতে বিকাশ সেন্ড মানি করুন:\n📱 *বিকাশ (Send Money):* ${BKASH_NUMBER}\n\nটাকা পাঠানোর পর Trnx ID এবং কত টাকা পাঠিয়েছেন তা এখানে মেসেজ করুন।` 
                    });
                    return;
                }

                const parts = text.trim().split(/\s+/);
                const nidNumber = parts[1];
                const dob = parts[2];

                if (!nidNumber || !dob) {
                    await sock.sendMessage(sender, { text: '⚠️ সঠিকভাবে লিখুন:\nnid <NID_Number> <YYYY-MM-DD>' });
                    return;
                }

                user.tokens -= 1;
                await sock.sendMessage(sender, { text: `⏳ মূল সার্ভার থেকে অরিজিনাল PDF সংগ্রহ করা হচ্ছে... (অবশিষ্ট টোকেন: ${user.tokens})` });

                try {
                    // ১. প্রথমে এপিআই থেকে ডাটা চেক করা
                    const apiUrl = `https://virtual-suport.com/sv.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                    const response = await axios.get(apiUrl);
                    const resData = response.data;

                    if (resData && resData.success && resData['data-Info']) {
                        const info = resData['data-Info'];
                        
                        // ২. সরাসরি মূল সার্ভার থেকে অরিজিনাল PDF বা প্রিন্ট কপি বাইনারি হিসেবে ফেচ করা
                        const pdfUrl = `https://virtual-suport.com/nid.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                        const pdfResponse = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
                        const originalPdfBuffer = Buffer.from(pdfResponse.data);

                        // ৩. সংক্ষিপ্ত টেক্সট মেসেজ পাঠানো
                        const replyText = `✅ *এনআইডি সার্ভার কপি পাওয়া গেছে!*\n\n` +
                            `👤 *নাম (বাংলা):* ${info.nameBangla}\n` +
                            `👤 *নাম (ইংরেজি):* ${info.nameEnglish}\n` +
                            `🆔 *জাতীয় পরিচয়পত্র নং:* ${info.nationalId}\n` +
                            `📅 *জন্ম তারিখ:* ${info.dateOfBirth}\n` +
                            `👨‍👦 *পিতার নাম:* ${info.fatherName}\n` +
                            `👩‍👦 *মাতার নাম:* ${info.motherName}`;

                        await sock.sendMessage(sender, { text: replyText });

                        // ৪. মূল সার্ভারের একদম অরিজিনাল PDF ফাইল হোয়াটসঅ্যাপে পাঠানো
                        await sock.sendMessage(sender, {
                            document: originalPdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `NID_Server_Copy_${nidNumber}.pdf`
                        });

                    } else {
                        await sock.sendMessage(sender, { text: '⚠️ দুঃখিত, এই NID এবং জন্ম তারিখ দিয়ে কোনো তথ্য পাওয়া যায়নি।' });
                    }
                } catch (error) {
                    await sock.sendMessage(sender, { text: '⚠️ সার্ভার থেকে PDF ডাউনলোড করতে সমস্যা হয়েছে।' });
                }
            }
        }
    });
}

startBot();

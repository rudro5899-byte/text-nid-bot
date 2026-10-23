const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const express = require('express');
const htmlPdfNode = require('html-pdf-node');

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

// এপিআই-এর অরিজিনাল HTML কে নিখুঁত সার্ভার কপি PDF-এ রূপান্তর করার ফাংশন
async function convertHtmlToOriginalPdf(htmlString) {
    const file = { content: htmlString };
    const options = { 
        format: 'A4', 
        printBackground: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    return await htmlPdfNode.generatePdf(file, options);
}

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
                    await sock.sendMessage(sender, { text: `✅ টোকেন সেট করা হয়েছে: ${amount}` });
                    if (targetUser !== sender) {
                        await sock.sendMessage(targetUser, { text: `🎉 আপনার অ্যাকাউন্টে ${amount} টি টোকেন যুক্ত হয়েছে!` });
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
                        text: `⚠️ *আপনার অ্যাকাউন্টে কোনো টোকেন নেই!*\n\nটোকেন রিচার্জ করতে বিকাশ সেন্ড মানি করুন:\n📱 *বিকাশ (Send Money):* ${BKASH_NUMBER}\n\nটাকা পাঠানোর পর Trnx ID এবং কত টাকা পাঠিয়েছেন তা এখানে মেসেজ করুন।` 
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
                await sock.sendMessage(sender, { text: `⏳ অরিজিনাল সার্ভার কপি তৈরি করা হচ্ছে... (অবশিষ্ট টোকেন: ${user.tokens})` });

                try {
                    // ১. API থেকে তথ্য চেক
                    const apiUrl = `https://virtual-suport.com/sv.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                    const response = await axios.get(apiUrl);
                    const resData = response.data;

                    if (resData && resData.success && resData['data-Info']) {
                        const info = resData['data-Info'];
                        
                        // ২. মূল সার্ভার থেকে অরিজিনাল HTML ডিজাইন পেজটি নিয়ে আসা
                        const targetUrl = `https://virtual-suport.com/nid.php?key=${API_KEY}&nid=${nidNumber}&dob=${dob}`;
                        const htmlResponse = await axios.get(targetUrl, { responseType: 'text' });
                        
                        // ৩. HTML পেজটিকে অবিকল অরিজিনাল সার্ভার কপি PDF ফাইলে রূপান্তর
                        const originalPdfBuffer = await convertHtmlToOriginalPdf(htmlResponse.data);

                        // ৪. ঠিকানা ও টেক্সট সাজানো
                        const preAddr = typeof info.preAddress === 'object' ? (info.preAddress?.addressLine || Object.values(info.preAddress || {}).filter(Boolean).join(', ')) : (info.preAddress || 'N/A');
                        const perAddr = typeof info.perAddress === 'object' ? (info.perAddress?.addressLine || Object.values(info.perAddress || {}).filter(Boolean).join(', ')) : (info.perAddress || 'N/A');

                        const replyText = `✅ *এনআইডি সার্ভার কপি পাওয়া গেছে!*\n\n` +
                            `👤 *নাম (বাংলা):* ${info.nameBangla || 'N/A'}\n` +
                            `👤 *নাম (ইংরেজি):* ${info.nameEnglish || 'N/A'}\n` +
                            `🆔 *জাতীয় পরিচয়পত্র নং:* ${info.nationalId || nidNumber}\n` +
                            `📌 *পিন নং:* ${info.pin || 'N/A'}\n` +
                            `📅 *জন্ম তারিখ:* ${info.dateOfBirth || dob}\n` +
                            `♂️ *লিঙ্গ:* ${info.gender || 'N/A'}\n` +
                            `🩸 *রক্তের গ্রুপ:* ${info.bloodGroup || 'N/A'}\n` +
                            `👨‍👦 *পিতার নাম:* ${info.fatherName || 'N/A'}\n` +
                            `👩‍👦 *মাতার নাম:* ${info.motherName || 'N/A'}\n` +
                            `🏠 *বর্তমান ঠিকানা:* ${preAddr}\n` +
                            `🏠 *স্থায়ী ঠিকানা:* ${perAddr}`;

                        // ৫. ছবিসহ টেক্সট পাঠানো
                        if (info.photo) {
                            await sock.sendMessage(sender, { 
                                image: { url: info.photo }, 
                                caption: replyText 
                            });
                        } else {
                            await sock.sendMessage(sender, { text: replyText });
                        }

                        // ৬. একদম আসল অরিজিনাল সার্ভার কপি PDF ফাইল হোয়াটসঅ্যাপ চ্যাটে পাঠানো
                        await sock.sendMessage(sender, {
                            document: originalPdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `NID_Server_Copy_${nidNumber}.pdf`
                        });

                    } else {
                        await sock.sendMessage(sender, { text: '⚠️ দুঃখিত, এই NID এবং জন্ম তারিখ দিয়ে কোনো তথ্য পাওয়া যায়নি।' });
                    }
                } catch (error) {
                    console.error("PDF Convert Error:", error);
                    await sock.sendMessage(sender, { text: '⚠️ অরিজিনাল সার্ভার কপি PDF তৈরিতে সমস্যা হয়েছে। আবার চেষ্টা করুন।' });
                }
            }
        }
    });
}

startBot();

const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('Starting bot initialization...');

const client = new Client({
    authStrategy: new LocalAuth(),
    // Puppeteer args often help with stability on some operating systems
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// const client = new Client({
//     // Save auth data to HAOS's persistent /data folder
//     authStrategy: new LocalAuth({
//         dataPath: '/data'
//     }),
//     puppeteer: {
//         executablePath: '/usr/bin/chromium-browser', 
//         args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
//     }
// });

client.on('qr', qr => {
    console.log('QR Code received, please scan:');
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('====================================');
    console.log('✅ Bot is alive and fully connected!');
    console.log('====================================');
});

client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ Client was disconnected. Reason:', reason);
});

// Changed from 'message' to 'message_create' so it catches your own messages too
client.on('message_create', async msg => {
    if (msg.body === '/plansesh') {
        console.log('🎯 Command /plansesh recognized! Attempting to send poll...');
        
        try {
            const poll = new Poll('when sesh?', [
                'Monday', 
                'Tuesday', 
                'Wednesday', 
                'Thursday', 
                'Friday', 
                'Saturday', 
                'Sunday'
            ], { allowMultipleAnswers: true });
            await msg.reply(poll);
            console.log('✅ Poll sent successfully!');
            
        } catch (error) {
            console.error('❌ Failed to send the poll. Error details:', error);
        }
    }
});

client.initialize();
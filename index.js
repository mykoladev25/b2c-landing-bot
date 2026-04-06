require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
const bot = new TelegramBot(token, {polling: true});

const states = {}; // {chatId: {step: 'stepName', data: {}}}

const QUIZ_STEPS = {
    START: 'start',
    BUSINESS_NAME: 'business_name',
    DESCRIPTION: 'description',
    VIBE: 'vibe',
    SERVICES: 'services',
    REVIEWS: 'reviews',
    LANGUAGE: 'language',
    CONTACT: 'contact',
    CONFIRM: 'confirm',
    GENERATE: 'generate'
};

const questions = {
    [QUIZ_STEPS.BUSINESS_NAME]: "Як називається ваш бізнес? (наприклад, 'Кав'ярня Золотий Дощ')",
    [QUIZ_STEPS.DESCRIPTION]: "Опишіть ваш бізнес в 2-3 реченнях. Чим ви унікальні?",
    [QUIZ_STEZPS.VIBE]: "Опишіть атмосферу/стиль вашого бізнесу трьома ключовими словами (наприклад, 'модерн, затишний, преміум')",
    [QUIZ_STEPS.SERVICES]: "Перерахуйте ваші основні послуги/товари та їх ціни (наприклад, 'Еспресо: 2 EUR, Капучино: 3 EUR'). Кожен пункт з нового рядка.",
    [QUIZ_STEPS.REVIEWS]: "Надайте 2-3 коротких відгуки від ваших клієнтів (наприклад, 'Дуже смачна кава - Іван П.'). Кожен відгук з нового рядка.",
    [QUIZ_STEPS.LANGUAGE]: "Якою мовою ви хочете бачити лендінг? (наприклад, 'Українська', 'English', 'Deutsch')",
    [QUIZ_STEPS.CONTACT]: "Надайте ваш контактний email або телефон у форматі E.164 (наприклад, '+380991234567')." 
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    states[chatId] = { step: QUIZ_STEPS.BUSINESS_NAME, data: {} };
    bot.sendMessage(chatId, `Привіт! 👋 Я допоможу створити демо-лендінг для вашого бізнесу. Почнемо з короткого опитування.

` + questions[QUIZ_STEPS.BUSINESS_NAME]);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') return; // Already handled

    if (!states[chatId]) {
        return bot.sendMessage(chatId, "Будь ласка, почніть з команди /start");
    }

    const currentState = states[chatId];

    switch (currentState.step) {
        case QUIZ_STEPS.BUSINESS_NAME:
            currentState.data.name = text;
            currentState.step = QUIZ_STEPS.DESCRIPTION;
            bot.sendMessage(chatId, questions[QUIZ_STEPS.DESCRIPTION]);
            break;
        case QUIZ_STEPS.DESCRIPTION:
            currentState.data.description = text;
            currentState.step = QUIZ_STEPS.VIBE;
            bot.sendMessage(chatId, questions[QUIZ_STEPS.VIBE]);
            break;
        case QUIZ_STEPS.VIBE:
            currentState.data.vibe = text;
            currentState.step = QUIZ_STEPS.SERVICES;
            bot.sendMessage(chatId, questions[QUIZ_STEPS.SERVICES]);
            break;
        case QUIZ_STEPS.SERVICES:
            currentState.data.menu = text.split('\n').map(line => {
                const parts = line.split(':');
                return { name: parts[0] ? parts[0].trim() : '', price: parts[1] ? parts[1].trim() : '' };
            });
            currentState.step = QUIZ_STEPS.REVIEWS;
            bot.sendMessage(chatId, questions[QUIZ_STEPS.REVIEWS]);
            break;
        case QUIZ_STEPS.REVIEWS:
            currentState.data.reviews = text.split('\n').map(line => {
                const parts = line.split('-');
                return { text: parts[0] ? parts[0].trim() : '', author: parts[1] ? parts[1].trim() : '' };
            });
            currentState.step = QUIZ_STEPS.LANGUAGE;
            bot.sendMessage(chatId, questions[QUIZ_STEPS.LANGUAGE]);
            break;
        case QUIZ_STEPS.LANGUAGE:
            currentState.data.language = text;
            currentState.step = QUIZ_STEPS.CONTACT;
            bot.sendMessage(chatId, questions[QUIZ_STEPS.CONTACT]);
            break;
        case QUIZ_STEPS.CONTACT:
            // Basic validation for email or phone (E.164)
            if (text.includes('@')) {
                currentState.data.email = text;
            } else if (/^\+?[1-9]\d{7,14}$/.test(text.replace(/\\s|-/g, ''))) {
                currentState.data.phone = text.replace(/[^\d+]/g, '');
            } else {
                return bot.sendMessage(chatId, "Невірний формат. Будь ласка, введіть дійсний email або телефон у форматі E.164.");
            }
            currentState.step = QUIZ_STEPS.CONFIRM;
            const summary = `*Підсумок замовлення:*
Ім'я бізнесу: ${currentState.data.name}
Опис: ${currentState.data.description}
Атмосфера: ${currentState.data.vibe}
Послуги: ${currentState.data.menu.map(i => i.name + ' ' + i.price).join(', ')}
Відгуки: ${currentState.data.reviews.map(r => r.text).join('; ')}
Мова: ${currentState.data.language}
Контакт: ${currentState.data.email || currentState.data.phone}

Все вірно? (Так/Ні)`;
            bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
            break;
        case QUIZ_STEPS.CONFIRM:
            if (text.toLowerCase() === 'так') {
                currentState.step = QUIZ_STEPS.GENERATE;
                bot.sendMessage(chatId, "Чудово! Починаю генерацію вашого демо-лендінгу. Це займе кілька хвилин...");
                await generateLandingPage(chatId, currentState.data);
            } else {
                states[chatId] = { step: QUIZ_STEPS.BUSINESS_NAME, data: {} };
                bot.sendMessage(chatId, "Гаразд, почнемо заново.\n\n" + questions[QUIZ_STEPS.BUSINESS_NAME]);
            }
            break;
        default:
            bot.sendMessage(chatId, "Невідома команда. Будь ласка, почніть з /start");
            break;
    }
});

async function generateLandingPage(chatId, data) {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'demo-' + Date.now();
    const landingUrl = `${process.env.BASE_URL}/${slug}`;

    // Create a temporary prompt file for the agent
    const frontendPromptContent = `You are a top-tier Senior Frontend Engineer and an Awwwards-winning Designer. Build an ultra-premium, cutting-edge landing page for the business below.
Your task demands maximum concentration, flawless code, and the use of modern UI/UX principles.

Business Name: ${data.name}
Description: ${data.description}
Vibe: ${data.vibe}
Language: ${data.language}
Reviews: ${JSON.stringify(data.reviews)}
Services/Menu: ${JSON.stringify(data.menu)}

Instructions:
1. DESIGN: Full-page, ultra-premium editorial design in ${data.language}. MUST include Hero, About Us, Services (all items), Testimonials (all reviews), Gallery, and Footer. Total minimum 6 sections.
2. RESPONSIVE & BUG-FREE (CRITICAL): The layout MUST be 100% fully responsive. NO horizontal scrolling. Add \`overflow-x-hidden\` to body. Avoid \`w-screen\` with paddings. DO NOT USE \`opacity-0\` on elements without a bulletproof Alpine.js unhide mechanism. Default to elements being visible.
3. INTERACTIVITY: Implement a subtle, playful interactive element using Alpine.js that responds to user action (scroll, hover, click).
4. CRO MODAL: Include an Alpine.js x-show modal with a button to contact the business in ${data.language}. The modal should clearly state that this is a demo and to contact you for pricing.
5. IMAGES: Dynamically fetch highly relevant and aesthetic images from Unsplash API using a keyword representing the niche of ${data.name} (e.g., if 'coffee shop', use 'coffee'). Use 3 unique images.
6. Output ONLY raw HTML (<!DOCTYPE html>...</html>). NO markdown ticks. NO explanations. DO NOT output your thinking process. ONLY RAW HTML.`;
    
    const frontendPromptFile = path.join(os.tmpdir(), `frontend_prompt_${chatId}.txt`);
    fs.writeFileSync(frontendPromptFile, frontendPrompt);

    try {
        // Fetch images dynamically
        const imageKeyword = data.vibe.split(',')[0].trim().replace(/ /g, '_'); // Using first vibe keyword as image search term
        const unsplashUrl = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(imageKeyword)}&per_page=5`;
        const unsplashRes = execSync(`curl -s "${unsplashUrl}"`, { encoding: 'utf-8' });
        const unsplashData = JSON.parse(unsplashRes);
        const images = unsplashData.results && unsplashData.results.length >= 3 
            ? unsplashData.results.slice(0, 3).map(r => r.urls.raw + '&auto=format&fit=crop&w=1200&q=80')
            : [
                `https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200`,
                `https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&q=80&w=1200`,
                `https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=1200`
              ];
        
        // Inject images into the prompt
        const finalFrontendPrompt = frontendPromptContent.replace(/IMAGES: Dynamically fetch.*/, 
            `IMAGES: Use ONLY these exact Unsplash URLs (do not change them):\n   - ${images[0]}\n   - ${images[1]}\n   - ${images[2]}`);

        fs.writeFileSync(frontendPromptFile, finalFrontendPrompt);

        const aiResponse = execSync(`OPENCLAW_MODEL=${process.env.OPENCLAW_MODEL} openclaw agent --session-id frontend-bot-${chatId}-${Date.now()} --message "$(cat ${frontendPromptFile})"`, { encoding: 'utf-8', timeout: 300000 });
        
        let htmlContent = aiResponse.toString().trim();
        htmlContent = htmlContent.replace(/^```html/mi, '').replace(/^```/mi, '').replace(/```$/m, '').trim();
        
        const startMatch = htmlContent.match(/<!doctype html>/i);
        if (startMatch) htmlContent = htmlContent.substring(startMatch.index);
        const endMatch = htmlContent.match(/<\/html>/i);
        if (endMatch) htmlContent = htmlContent.substring(0, endMatch.index + 7);
        
        const buildDir = path.join(__dirname, 'dist', slug);
        fs.mkdirSync(buildDir, { recursive: true });
        const indexPath = path.join(buildDir, 'index.html');
        fs.writeFileSync(indexPath, htmlContent);

        const remotePath = `${process.env.REMOTE_BASE_PATH}/${slug}`;
        const serverIp = process.env.SERVER_IP;
        const sshKey = process.env.SSH_KEY_PATH;

        execSync(`ssh -i ${sshKey} root@${serverIp} "mkdir -p ${remotePath} && chown -R www-data:www-data ${remotePath}"`);
        execSync(`scp -i ${sshKey} ${indexPath} root@${serverIp}:${remotePath}/index.html`);
        execSync(`ssh -i ${sshKey} root@${serverIp} "chmod -R 755 ${remotePath} && chmod 644 ${remotePath}/index.html"`);

        const finalLandingUrl = `${process.env.BASE_URL}/${slug}`;

        bot.sendMessage(chatId, `🎉 Ваш демо-лендінг готовий!\n\n🌐 Посилання: ${finalLandingUrl}\n\nЦе лише демо-версія. Щоб дізнатися ціну та отримати повну версію сайту, напишіть, будь ласка, моєму розробнику: @nnn_ddddddd`);

        // Send notification to admin
        if (adminChatId) {
            bot.sendMessage(adminChatId, `New Landing Demo Generated:\nBusiness: ${data.name}\nURL: ${finalLandingUrl}\nContact: ${data.email || data.phone}`);
        }

    } catch (error) {
        console.error("Landing page generation failed:", error);
        bot.sendMessage(chatId, "На жаль, сталася помилка під час генерації лендінгу. Спробуйте ще раз або зверніться до розробника.`);
    } finally {
        // Clean up temporary prompt file
        if (fs.existsSync(frontendPromptFile)) fs.unlinkSync(frontendPromptFile);
    }
}

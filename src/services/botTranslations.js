/**
 * ═══════════════════════════════════════════════════════════
 * VIDVAULT BOT — MULTI-LANGUAGE TRANSLATION SYSTEM
 * 20 Languages | MarkdownV2 pre-escaped static text
 * Dynamic vars must be passed already esc()'d by caller
 * ═══════════════════════════════════════════════════════════
 */

// Language metadata — flag, native name, Telegram language_code
const LANGUAGE_META = {
  en: { flag: "🇬🇧", name: "English",    code: "en" },
  hi: { flag: "🇮🇳", name: "हिंदी",       code: "hi" },
  ar: { flag: "🇸🇦", name: "عربي",        code: "ar" },
  es: { flag: "🇪🇸", name: "Español",     code: "es" },
  pt: { flag: "🇧🇷", name: "Português",   code: "pt" },
  ru: { flag: "🇷🇺", name: "Русский",     code: "ru" },
  id: { flag: "🇮🇩", name: "Indonesia",   code: "id" },
  tr: { flag: "🇹🇷", name: "Türkçe",      code: "tr" },
  fr: { flag: "🇫🇷", name: "Français",    code: "fr" },
  de: { flag: "🇩🇪", name: "Deutsch",     code: "de" },
  bn: { flag: "🇧🇩", name: "বাংলা",       code: "bn" },
  ur: { flag: "🇵🇰", name: "اردو",        code: "ur" },
  ta: { flag: "🇮🇳", name: "தமிழ்",       code: "ta" },
  te: { flag: "🇮🇳", name: "తెలుగు",      code: "te" },
  zh: { flag: "🇨🇳", name: "中文",         code: "zh" },
  ko: { flag: "🇰🇷", name: "한국어",       code: "ko" },
  ja: { flag: "🇯🇵", name: "日本語",       code: "ja" },
  vi: { flag: "🇻🇳", name: "Tiếng Việt",  code: "vi" },
  th: { flag: "🇹🇭", name: "ภาษาไทย",    code: "th" },
  it: { flag: "🇮🇹", name: "Italiano",    code: "it" },
};

// Map Telegram language_code → our lang key
const TELEGRAM_LANG_MAP = {
  en: "en", hi: "hi", ar: "ar", es: "es", pt: "pt",
  ru: "ru", id: "id", tr: "tr", fr: "fr", de: "de",
  bn: "bn", ur: "ur", ta: "ta", te: "te", zh: "zh",
  "zh-hans": "zh", "zh-hant": "zh",
  ko: "ko", ja: "ja", vi: "vi", th: "th", it: "it",
};

// ═══════════════════════════════════════════════════════════
// TRANSLATIONS
// All static special chars pre-escaped for MarkdownV2
// Dynamic values ({{NAME}}, {{LINK}} etc) escaped by caller
// ═══════════════════════════════════════════════════════════

const T = {

  // ─────────────────────────────────────────────────────────
  en: {
    chooseLanguage:
      `🌍 *Welcome to VidVault\\!*\n\n` +
      `Please choose your language:\n` +
      `_Tap once — I'll always speak it with you_ 👇`,

    languageSet: `✅ Language set to *English*\\! Let's go 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? `Welcome back, ${name}\\!` : `Hey ${name}, welcome to VidVault\\!`}*\n\n` +
      `${isReturning
        ? `Good to see you again 👋\nYou've joined *10,000\\+* downloads served\\.\n\n`
        : `You just joined *10,000\\+* people who download smarter\\.\n\n`
      }` +
      `Paste any video link → I'll download it in seconds\\.\n` +
      `YouTube • Instagram • TikTok • Twitter \\& 25\\+ more\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Free* — ${limit} downloads/month\n` +
      `⭐ *Premium* — Unlimited \\+ 4K \\+ MP3 320k\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 *Send me a video link to start\\!*`,

    pasteLink:
      `❓ *Send me a video link to download\\!*\n\n` +
      `Paste a link from YouTube, Instagram, TikTok, Twitter \\& more\n\n` +
      `Type /help for all commands\\.`,

    fetching: `🔍 Fetching video info\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *Downloading ${label}\\.\\.\\.*\n\nUsually takes 10\\-20 seconds\\!`,

    limitReached: ({ total, days, link }) =>
      `🚫 *You've hit your limit for this month\\.*\n\n` +
      `You've downloaded *${total} videos* total\\.\n` +
      `You clearly know how to use VidVault 💪\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Your choice right now:\n\n` +
      `⏳ *Wait ${days} days* for free reset\n` +
      `_\\(miss every video you want this week\\)_\n\n` +
      `OR\n\n` +
      `⚡ *Go Unlimited RIGHT NOW*\n` +
      `Download anything tonight, this weekend, forever\\.\n\n` +
      `~₹99~ → *₹29/month* 🔥\n` +
      `_Less than one chai per day ☕_\n\n` +
      `👇 *Pay now — activates in seconds:*\n` +
      `${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *3 of 5 downloads used this month*\n` +
      `Power users download 40\\+ videos/month with Premium\\.\n` +
      `2 left → /premium`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ *1 free download left this month\\!*\n` +
      `After this — wait for reset OR upgrade\\.\n` +
      `Most people upgrade right here 😏\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Please wait ${sec} seconds between requests\\.`,

    alreadyDownloading:
      `⏳ Your previous download is still processing\\. Please wait\\!`,

    sessionExpired:
      `⏰ Session expired\\. Please send the video link again\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Done\\! Your download is ready\\.*\n\n` +
      `🎬 ${title}\n` +
      `📊 ${label}  •  📦 ${size}  •  ⚡ ${platform}\n\n` +
      `🔗 *Tap to download:*\n` +
      `${url}\n\n` +
      `⏰ Link expires in *1 hour*\n\n` +
      `${isPremium
        ? `⭐ *Premium member* — No limits, ever\\. Enjoy\\! 🎬`
        : `📊 *${used}/${limit}* downloads used this month`
      }`,

    lockedQuality: `🔒 *Premium quality*\n\nUpgrade to unlock 1080p, 4K \\& MP3 320k\\.\n/premium`,
  },

  // ─────────────────────────────────────────────────────────
  hi: {
    chooseLanguage:
      `🌍 *VidVault पर आपका स्वागत है\\!*\n\n` +
      `अपनी भाषा चुनें:\n` +
      `_एक बार चुनें — मैं हमेशा इसी में बात करूंगा_ 👇`,

    languageSet: `✅ भाषा *हिंदी* सेट हो गई\\! चलो शुरू करते हैं 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? `वापस आए, ${name}\\!` : `हे ${name}, VidVault पर स्वागत है\\!`}*\n\n` +
      `${isReturning
        ? `फिर से देखकर अच्छा लगा 👋\n*10,000\\+* downloads serve हो चुके हैं\\.\n\n`
        : `तुम *10,000\\+* smart downloaders में शामिल हो गए\\.\n\n`
      }` +
      `कोई भी video link paste करो → seconds में download\\.\n` +
      `YouTube • Instagram • TikTok • Twitter \\& 25\\+ more\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Free* — ${limit} downloads/month\n` +
      `⭐ *Premium ₹29/month* — Unlimited \\+ 4K \\+ MP3\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 *कोई भी video link भेजो और शुरू करो\\!*`,

    pasteLink:
      `❓ *कोई video link भेजो download के लिए\\!*\n\n` +
      `YouTube, Instagram, TikTok, Twitter का link paste करो\n\n` +
      `सभी commands के लिए /help टाइप करो\\.`,

    fetching: `🔍 Video की जानकारी ला रहे हैं\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *${label} download हो रहा है\\.\\.\\.*\n\n10\\-20 seconds लगेंगे\\!`,

    limitReached: ({ total, days, link }) =>
      `🚫 *इस महीने की limit खत्म हो गई\\.*\n\n` +
      `तुमने अब तक *${total} videos* download किए हैं\\.\n` +
      `तुम सच में VidVault के pro user हो 💪\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `अभी दो रास्ते हैं:\n\n` +
      `⏳ *${days} दिन wait करो* free reset के लिए\n` +
      `_\\(इस हफ्ते जो videos चाहिए वो miss हो जाएंगी\\)_\n\n` +
      `या\n\n` +
      `⚡ *अभी Unlimited हो जाओ*\n` +
      `आज रात, इस weekend, हमेशा के लिए download करो\\.\n\n` +
      `~₹99~ → *₹29/month* 🔥\n` +
      `_एक chai से भी सस्ता ☕_\n\n` +
      `👇 *Pay करो — seconds में activate:*\n` +
      `${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *5 में से 3 downloads इस्तेमाल हो गए*\n` +
      `Premium users महीने में 40\\+ videos download करते हैं\\.\n` +
      `2 बचे हैं → /premium`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ *इस महीने सिर्फ 1 download बचा है\\!*\n` +
      `इसके बाद reset का wait या upgrade\\.\n` +
      `ज़्यादातर लोग यहीं upgrade करते हैं 😏\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ ${sec} seconds रुको फिर try करो\\.`,

    alreadyDownloading:
      `⏳ पिछला download अभी चल रहा है\\. थोड़ा रुको\\!`,

    sessionExpired:
      `⏰ Session expire हो गया\\. Video link फिर से भेजो\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Download Ready है\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Quality: *${label}*\n` +
      `📦 Size: ${size}\n` +
      `⚡ Platform: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Download करने के लिए tap करो:*\n` +
      `${url}\n\n` +
      `⏰ *1 घंटे* तक available\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Unlimited downloads का मज़ा लो\\!`
        : `📊 Downloads इस्तेमाल: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Premium quality — ₹29/month में upgrade करो!`,
  },

  // ─────────────────────────────────────────────────────────
  ar: {
    chooseLanguage:
      `🌍 *مرحباً بك في VidVault\\!*\n\n` +
      `اختر لغتك:\n` +
      `_اختر مرة واحدة — سأتحدث معك بها دائماً_ 👇`,

    languageSet: `✅ تم ضبط اللغة على *العربية*\\! هيا نبدأ 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "مرحباً بعودتك" : "مرحباً"} في VidVault، ${name}\\!*\n\n` +
      `حمّل الفيديوهات من *25\\+ منصة* في ثوانٍ\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& المزيد\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *مجاناً:* ${limit} تحميلات/شهر • 720p\n` +
      `⭐ *Premium ₹29/شهر:* غير محدود • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *فقط الصق رابط الفيديو وابدأ\\!*`,

    pasteLink:
      `❓ *أرسل لي رابط فيديو للتحميل\\!*\n\n` +
      `الصق رابطاً من YouTube أو Instagram أو TikTok وغيرها\n\n` +
      `اكتب /help لجميع الأوامر\\.`,

    fetching: `🔍 جاري جلب معلومات الفيديو\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *جاري تحميل ${label}\\.\\.\\.*\n\nعادةً يستغرق 10\\-20 ثانية\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *لقد حمّلت ${total} فيديو — أنت مستخدم محترف\\!*\n\n` +
      `يتجدد الحد المجاني خلال *${days} أيام*\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `أو افتح الغير محدود الآن:\n\n` +
      `⭐ *Premium — ₹29/شهر*\n` +
      `• تحميلات غير محدودة للأبد\n` +
      `• جودة 1080p \\+ 4K\n` +
      `• يُفعَّل في ثوانٍ\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *استخدمت 3 من 5 تحميلات مجانية*\n` +
      `مستخدمو Premium لا يحسبون أبداً 😎\n` +
      `*₹29/شهر → غير محدود للأبد*\n` +
      `/premium للترقية`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *آخر تحميل مجاني هذا الشهر\\!*\n` +
      `يبدو أنك تحب VidVault كثيراً 🎬\n` +
      `انضم Premium بـ *₹1/يوم* فقط\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ انتظر ${sec} ثانية بين الطلبات\\.`,

    alreadyDownloading:
      `⏳ تحميلك السابق لا يزال جارياً\\. انتظر من فضلك\\!`,

    sessionExpired:
      `⏰ انتهت الجلسة\\. أرسل رابط الفيديو مرة أخرى\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *التحميل جاهز\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 الجودة: *${label}*\n` +
      `📦 الحجم: ${size}\n` +
      `⚡ المنصة: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *اضغط للتحميل:*\n` +
      `${url}\n\n` +
      `⏰ متاح لمدة *ساعة واحدة*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — استمتع بتحميلات غير محدودة\\!`
        : `📊 التحميلات المستخدمة: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 جودة Premium — قم بالترقية مقابل ₹29/شهر!`,
  },

  // ─────────────────────────────────────────────────────────
  es: {
    chooseLanguage:
      `🌍 *¡Bienvenido a VidVault\\!*\n\n` +
      `Elige tu idioma:\n` +
      `_Elige una vez — siempre hablaré contigo en él_ 👇`,

    languageSet: `✅ Idioma configurado a *Español*\\! ¡Vamos\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *¡${isReturning ? "Bienvenido de vuelta" : "Bienvenido"} a VidVault, ${name}\\!*\n\n` +
      `¡Descarga videos de *25\\+ plataformas* en segundos\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& más\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Gratis:* ${limit} descargas/mes • 720p\n` +
      `⭐ *Premium ₹29/mes:* Ilimitado • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *¡Solo pega cualquier link de video\\!*`,

    pasteLink:
      `❓ *¡Envíame un link de video para descargar\\!*\n\n` +
      `Pega un link de YouTube, Instagram, TikTok, Twitter y más\n\n` +
      `Escribe /help para todos los comandos\\.`,

    fetching: `🔍 Obteniendo info del video\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *Descargando ${label}\\.\\.\\.*\n\n¡Normalmente tarda 10\\-20 segundos\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *¡Has descargado ${total} videos — eres un pro\\!*\n\n` +
      `El plan gratis se reinicia en *${days} días*\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `O desbloquea ilimitado ahora mismo:\n\n` +
      `⭐ *Premium — ₹29/mes*\n` +
      `• Descargas ilimitadas para siempre\n` +
      `• Calidad 1080p \\+ 4K\n` +
      `• Se activa en segundos\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *Has usado 3 de 5 descargas gratis*\n` +
      `Los usuarios Premium nunca cuentan 😎\n` +
      `*₹29/mes → Ilimitado para siempre*\n` +
      `/premium para mejorar`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *¡Última descarga gratis del mes\\!*\n` +
      `Claramente amas VidVault 🎬\n` +
      `Únete Premium por solo *₹1/día*\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Espera ${sec} segundos entre solicitudes\\.`,

    alreadyDownloading:
      `⏳ Tu descarga anterior sigue en proceso\\. ¡Espera\\!`,

    sessionExpired:
      `⏰ Sesión expirada\\. Envía el link del video de nuevo\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *¡Descarga Lista\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Calidad: *${label}*\n` +
      `📦 Tamaño: ${size}\n` +
      `⚡ Plataforma: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Toca para descargar:*\n` +
      `${url}\n\n` +
      `⏰ Disponible por *1 hora*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — ¡Disfruta descargas ilimitadas\\!`
        : `📊 Descargas usadas: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Calidad Premium — mejora por ₹29/mes!`,
  },

  // ─────────────────────────────────────────────────────────
  pt: {
    chooseLanguage:
      `🌍 *Bem\\-vindo ao VidVault\\!*\n\n` +
      `Escolha seu idioma:\n` +
      `_Escolha uma vez — sempre falarei com você nele_ 👇`,

    languageSet: `✅ Idioma definido para *Português*\\! Bora\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "Bem\\-vindo de volta" : "Bem\\-vindo"} ao VidVault, ${name}\\!*\n\n` +
      `Baixe vídeos de *25\\+ plataformas* em segundos\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& mais\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Grátis:* ${limit} downloads/mês • 720p\n` +
      `⭐ *Premium ₹29/mês:* Ilimitado • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Cole qualquer link de vídeo e comece\\!*`,

    pasteLink:
      `❓ *Me manda um link de vídeo para baixar\\!*\n\n` +
      `Cole um link do YouTube, Instagram, TikTok, Twitter e mais\n\n` +
      `Digite /help para todos os comandos\\.`,

    fetching: `🔍 Buscando informações do vídeo\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *Baixando ${label}\\.\\.\\.*\n\nNormalmente leva 10\\-20 segundos\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *Você baixou ${total} vídeos — você é incrível\\!*\n\n` +
      `O plano grátis reseta em *${days} dias*\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Ou desbloqueie ilimitado agora:\n\n` +
      `⭐ *Premium — ₹29/mês*\n` +
      `• Downloads ilimitados para sempre\n` +
      `• Qualidade 1080p \\+ 4K\n` +
      `• Ativa em segundos\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *Você usou 3 de 5 downloads grátis*\n` +
      `Usuários Premium nunca contam 😎\n` +
      `*₹29/mês → Ilimitado para sempre*\n` +
      `/premium para fazer upgrade`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Último download grátis do mês\\!*\n` +
      `Você claramente ama o VidVault 🎬\n` +
      `Junte\\-se ao Premium por apenas *₹1/dia*\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Aguarde ${sec} segundos entre as solicitações\\.`,

    alreadyDownloading:
      `⏳ Seu download anterior ainda está processando\\. Aguarde\\!`,

    sessionExpired:
      `⏰ Sessão expirada\\. Envie o link do vídeo novamente\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Download Pronto\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Qualidade: *${label}*\n` +
      `📦 Tamanho: ${size}\n` +
      `⚡ Plataforma: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Toque para baixar:*\n` +
      `${url}\n\n` +
      `⏰ Disponível por *1 hora*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Aproveite downloads ilimitados\\!`
        : `📊 Downloads usados: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Qualidade Premium — faça upgrade por ₹29/mês!`,
  },

  // ─────────────────────────────────────────────────────────
  ru: {
    chooseLanguage:
      `🌍 *Добро пожаловать в VidVault\\!*\n\n` +
      `Выберите язык:\n` +
      `_Выберите один раз — буду всегда говорить на нём_ 👇`,

    languageSet: `✅ Язык установлен: *Русский*\\! Поехали\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "С возвращением в" : "Добро пожаловать в"} VidVault, ${name}\\!*\n\n` +
      `Скачивайте видео с *25\\+ платформ* мгновенно\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& ещё\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Бесплатно:* ${limit} загрузок/мес • 720p\n` +
      `⭐ *Premium ₹29/мес:* Безлимит • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Просто вставьте ссылку на видео\\!*`,

    pasteLink:
      `❓ *Отправьте ссылку на видео для скачивания\\!*\n\n` +
      `Вставьте ссылку с YouTube, Instagram, TikTok, Twitter и других\n\n` +
      `Напишите /help для всех команд\\.`,

    fetching: `🔍 Получаю информацию о видео\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *Скачиваю ${label}\\.\\.\\.*\n\nОбычно занимает 10\\-20 секунд\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *Вы скачали ${total} видео — вы профи\\!*\n\n` +
      `Бесплатный план сбросится через *${days} дней*\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Или разблокируйте безлимит прямо сейчас:\n\n` +
      `⭐ *Premium — ₹29/мес*\n` +
      `• Безлимитные загрузки навсегда\n` +
      `• Качество 1080p \\+ 4K\n` +
      `• Активируется за секунды\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *Использовано 3 из 5 бесплатных загрузок*\n` +
      `Premium\\-пользователи никогда не считают 😎\n` +
      `*₹29/мес → Безлимит навсегда*\n` +
      `/premium для апгрейда`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Последняя бесплатная загрузка в этом месяце\\!*\n` +
      `Вы явно любите VidVault 🎬\n` +
      `Premium всего за *₹1/день*\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Подождите ${sec} секунд между запросами\\.`,

    alreadyDownloading:
      `⏳ Предыдущая загрузка ещё идёт\\. Подождите\\!`,

    sessionExpired:
      `⏰ Сессия истекла\\. Отправьте ссылку на видео снова\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Загрузка готова\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Качество: *${label}*\n` +
      `📦 Размер: ${size}\n` +
      `⚡ Платформа: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Нажмите для скачивания:*\n` +
      `${url}\n\n` +
      `⏰ Доступно *1 час*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Наслаждайтесь безлимитными загрузками\\!`
        : `📊 Использовано загрузок: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Premium качество — апгрейд за ₹29/мес!`,
  },

  // ─────────────────────────────────────────────────────────
  id: {
    chooseLanguage:
      `🌍 *Selamat datang di VidVault\\!*\n\n` +
      `Pilih bahasamu:\n` +
      `_Pilih sekali — aku akan selalu bicara denganmu_ 👇`,

    languageSet: `✅ Bahasa diatur ke *Indonesia*\\! Yuk mulai\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "Selamat datang kembali di" : "Selamat datang di"} VidVault, ${name}\\!*\n\n` +
      `Download video dari *25\\+ platform* dalam hitungan detik\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& lainnya\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Gratis:* ${limit} download/bulan • 720p\n` +
      `⭐ *Premium ₹29/bulan:* Unlimited • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Tinggal paste link video dan mulai\\!*`,

    pasteLink:
      `❓ *Kirim link video untuk didownload\\!*\n\n` +
      `Paste link dari YouTube, Instagram, TikTok, Twitter dll\n\n` +
      `Ketik /help untuk semua perintah\\.`,

    fetching: `🔍 Mengambil info video\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *Mendownload ${label}\\.\\.\\.*\n\nBiasanya 10\\-20 detik\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *Kamu sudah download ${total} video — kamu luar biasa\\!*\n\n` +
      `Plan gratis reset dalam *${days} hari*\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Atau buka unlimited sekarang:\n\n` +
      `⭐ *Premium — ₹29/bulan*\n` +
      `• Download unlimited selamanya\n` +
      `• Kualitas 1080p \\+ 4K\n` +
      `• Aktif dalam detik\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *Sudah pakai 3 dari 5 download gratis*\n` +
      `Pengguna Premium tidak pernah hitung\\-hitungan 😎\n` +
      `*₹29/bulan → Unlimited selamanya*\n` +
      `/premium untuk upgrade`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Download gratis terakhir bulan ini\\!*\n` +
      `Kamu jelas suka VidVault banget 🎬\n` +
      `Gabung Premium cuma *₹1/hari*\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Tunggu ${sec} detik antara permintaan\\.`,

    alreadyDownloading:
      `⏳ Download sebelumnya masih berjalan\\. Tunggu dulu\\!`,

    sessionExpired:
      `⏰ Sesi kadaluarsa\\. Kirim link video lagi ya\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Download Siap\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Kualitas: *${label}*\n` +
      `📦 Ukuran: ${size}\n` +
      `⚡ Platform: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Tap untuk download:*\n` +
      `${url}\n\n` +
      `⏰ Tersedia selama *1 jam*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Nikmati download unlimited\\!`
        : `📊 Download terpakai: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Kualitas Premium — upgrade ₹29/bulan!`,
  },

  // ─────────────────────────────────────────────────────────
  tr: {
    chooseLanguage:
      `🌍 *VidVault'a Hoşgeldiniz\\!*\n\n` +
      `Dilinizi seçin:\n` +
      `_Bir kez seçin — her zaman bu dilde konuşacağım_ 👇`,

    languageSet: `✅ Dil *Türkçe* olarak ayarlandı\\! Hadi başlayalım\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *VidVault'a ${isReturning ? "Tekrar Hoşgeldiniz" : "Hoşgeldiniz"}, ${name}\\!*\n\n` +
      `*25\\+ platformdan* saniyeler içinde video indirin\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& daha fazlası\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Ücretsiz:* ${limit} indirme/ay • 720p\n` +
      `⭐ *Premium ₹29/ay:* Sınırsız • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Video linkini yapıştırın ve başlayın\\!*`,

    pasteLink:
      `❓ *İndirmek için video linki gönderin\\!*\n\n` +
      `YouTube, Instagram, TikTok, Twitter ve daha fazlasından link yapıştırın\n\n` +
      `Tüm komutlar için /help yazın\\.`,

    fetching: `🔍 Video bilgisi alınıyor\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *${label} indiriliyor\\.\\.\\.*\n\nGenellikle 10\\-20 saniye sürer\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *${total} video indirdiniz — harika bir kullanıcısınız\\!*\n\n` +
      `Ücretsiz plan *${days} gün* içinde sıfırlanır\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Ya da sınırsızı hemen açın:\n\n` +
      `⭐ *Premium — ₹29/ay*\n` +
      `• Sonsuza kadar sınırsız indirme\n` +
      `• 1080p \\+ 4K kalite\n` +
      `• Saniyeler içinde aktif\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *5 ücretsiz indirmeden 3'ünü kullandınız*\n` +
      `Premium kullanıcılar hiç saymaz 😎\n` +
      `*₹29/ay → Sonsuza kadar sınırsız*\n` +
      `/premium ile yükseltin`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Bu ayın son ücretsiz indirmesi\\!*\n` +
      `Açıkça VidVault'u seviyorsunuz 🎬\n` +
      `Sadece *₹1/gün* ile Premium'a katılın\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ İstekler arasında ${sec} saniye bekleyin\\.`,

    alreadyDownloading:
      `⏳ Önceki indirmeniz hâlâ devam ediyor\\. Lütfen bekleyin\\!`,

    sessionExpired:
      `⏰ Oturum sona erdi\\. Video linkini tekrar gönderin\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *İndirme Hazır\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Kalite: *${label}*\n` +
      `📦 Boyut: ${size}\n` +
      `⚡ Platform: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *İndirmek için dokunun:*\n` +
      `${url}\n\n` +
      `⏰ *1 saat* boyunca mevcut\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Sınırsız indirmenin tadını çıkarın\\!`
        : `📊 Kullanılan indirmeler: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Premium kalite — ₹29/ay ile yükseltin!`,
  },

  // ─────────────────────────────────────────────────────────
  fr: {
    chooseLanguage:
      `🌍 *Bienvenue sur VidVault\\!*\n\n` +
      `Choisissez votre langue:\n` +
      `_Choisissez une fois — je vous parlerai toujours dans cette langue_ 👇`,

    languageSet: `✅ Langue définie sur *Français*\\! Allons\\-y\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "Bienvenue de retour sur" : "Bienvenue sur"} VidVault, ${name}\\!*\n\n` +
      `Téléchargez des vidéos depuis *25\\+ plateformes* en secondes\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& plus\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Gratuit:* ${limit} téléchargements/mois • 720p\n` +
      `⭐ *Premium ₹29/mois:* Illimité • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Collez simplement un lien vidéo pour commencer\\!*`,

    pasteLink:
      `❓ *Envoyez\\-moi un lien vidéo à télécharger\\!*\n\n` +
      `Collez un lien depuis YouTube, Instagram, TikTok, Twitter et plus\n\n` +
      `Tapez /help pour toutes les commandes\\.`,

    fetching: `🔍 Récupération des infos vidéo\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *Téléchargement ${label}\\.\\.\\.*\n\nGénéralement 10\\-20 secondes\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *Vous avez téléchargé ${total} vidéos — vous êtes un pro\\!*\n\n` +
      `Le plan gratuit se réinitialise dans *${days} jours*\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Ou débloquez l'illimité maintenant:\n\n` +
      `⭐ *Premium — ₹29/mois*\n` +
      `• Téléchargements illimités pour toujours\n` +
      `• Qualité 1080p \\+ 4K\n` +
      `• Activé en secondes\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *Vous avez utilisé 3 des 5 téléchargements gratuits*\n` +
      `Les utilisateurs Premium ne comptent jamais 😎\n` +
      `*₹29/mois → Illimité pour toujours*\n` +
      `/premium pour mettre à niveau`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Dernier téléchargement gratuit du mois\\!*\n` +
      `Vous aimez clairement VidVault 🎬\n` +
      `Rejoignez Premium pour seulement *₹1/jour*\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Veuillez attendre ${sec} secondes entre les requêtes\\.`,

    alreadyDownloading:
      `⏳ Votre téléchargement précédent est toujours en cours\\. Patientez\\!`,

    sessionExpired:
      `⏰ Session expirée\\. Renvoyez le lien vidéo\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Téléchargement Prêt\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Qualité: *${label}*\n` +
      `📦 Taille: ${size}\n` +
      `⚡ Plateforme: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Appuyez pour télécharger:*\n` +
      `${url}\n\n` +
      `⏰ Disponible pendant *1 heure*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Profitez de téléchargements illimités\\!`
        : `📊 Téléchargements utilisés: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Qualité Premium — améliorez pour ₹29/mois!`,
  },

  // ─────────────────────────────────────────────────────────
  de: {
    chooseLanguage:
      `🌍 *Willkommen bei VidVault\\!*\n\n` +
      `Wähle deine Sprache:\n` +
      `_Einmal wählen — ich spreche immer in dieser Sprache mit dir_ 👇`,

    languageSet: `✅ Sprache auf *Deutsch* eingestellt\\! Los geht's\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "Willkommen zurück bei" : "Willkommen bei"} VidVault, ${name}\\!*\n\n` +
      `Lade Videos von *25\\+ Plattformen* in Sekunden herunter\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& mehr\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *Kostenlos:* ${limit} Downloads/Monat • 720p\n` +
      `⭐ *Premium ₹29/Monat:* Unbegrenzt • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Füge einfach einen Videolink ein\\!*`,

    pasteLink:
      `❓ *Sende mir einen Videolink zum Herunterladen\\!*\n\n` +
      `Füge einen Link von YouTube, Instagram, TikTok, Twitter usw\\. ein\n\n` +
      `Tippe /help für alle Befehle\\.`,

    fetching: `🔍 Videoinformationen werden abgerufen\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *${label} wird heruntergeladen\\.\\.\\.*\n\nNormalerweise 10\\-20 Sekunden\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *Du hast ${total} Videos heruntergeladen — du bist ein Profi\\!*\n\n` +
      `Der kostenlose Plan wird in *${days} Tagen* zurückgesetzt\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Oder schalte jetzt unbegrenzt frei:\n\n` +
      `⭐ *Premium — ₹29/Monat*\n` +
      `• Unbegrenzte Downloads für immer\n` +
      `• Qualität 1080p \\+ 4K\n` +
      `• In Sekunden aktiviert\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *3 von 5 kostenlosen Downloads verwendet*\n` +
      `Premium\\-Nutzer zählen nie 😎\n` +
      `*₹29/Monat → Unbegrenzt für immer*\n` +
      `/premium zum Upgraden`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *Letzter kostenloser Download diesen Monat\\!*\n` +
      `Du liebst VidVault offensichtlich 🎬\n` +
      `Premium für nur *₹1/Tag*\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) =>
      `⏱ Bitte warte ${sec} Sekunden zwischen Anfragen\\.`,

    alreadyDownloading:
      `⏳ Dein vorheriger Download läuft noch\\. Bitte warte\\!`,

    sessionExpired:
      `⏰ Sitzung abgelaufen\\. Sende den Videolink erneut\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Download Bereit\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 Qualität: *${label}*\n` +
      `📦 Größe: ${size}\n` +
      `⚡ Plattform: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *Tippe zum Herunterladen:*\n` +
      `${url}\n\n` +
      `⏰ Verfügbar für *1 Stunde*\n\n` +
      `${isPremium
        ? `⭐ *Premium* — Genieße unbegrenzte Downloads\\!`
        : `📊 Verwendete Downloads: *${used}/${limit}*`
      }`,

    lockedQuality: `🔒 Premium-Qualität — upgrade für ₹29/Monat!`,
  },

  // ─────────────────────────────────────────────────────────
  bn: {
    chooseLanguage:
      `🌍 *VidVault\\-এ আপনাকে স্বাগতম\\!*\n\n` +
      `আপনার ভাষা বেছে নিন:\n` +
      `_একবার বেছে নিন — আমি সবসময় এই ভাষায় কথা বলব_ 👇`,

    languageSet: `✅ ভাষা *বাংলা* সেট হয়ে গেছে\\! চলুন শুরু করি\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "ফিরে আসার" : "VidVault\\-এ"} স্বাগতম, ${name}\\!*\n\n` +
      `*25\\+ প্ল্যাটফর্ম* থেকে সেকেন্ডে ভিডিও ডাউনলোড করুন\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& আরো\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *বিনামূল্যে:* ${limit} ডাউনলোড/মাস • 720p\n` +
      `⭐ *Premium ₹29/মাস:* সীমাহীন • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *যেকোনো ভিডিও লিংক পেস্ট করুন\\!*`,

    pasteLink:
      `❓ *ডাউনলোডের জন্য একটি ভিডিও লিংক পাঠান\\!*\n\n` +
      `YouTube, Instagram, TikTok, Twitter থেকে লিংক পেস্ট করুন\n\n` +
      `সব কমান্ডের জন্য /help টাইপ করুন\\.`,

    fetching: `🔍 ভিডিও তথ্য আনা হচ্ছে\\.\\.\\.`,

    processing: ({ label }) =>
      `⏳ *${label} ডাউনলোড হচ্ছে\\.\\.\\.*\n\nসাধারণত 10\\-20 সেকেন্ড লাগে\\!`,

    limitReached: ({ total, days, link }) =>
      `💪 *আপনি ${total}টি ভিডিও ডাউনলোড করেছেন — আপনি দারুণ\\!*\n\n` +
      `বিনামূল্যে পরিকল্পনা *${days} দিনে* রিসেট হবে\\.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `অথবা এখনই সীমাহীন আনলক করুন:\n\n` +
      `⭐ *Premium — ₹29/মাস*\n` +
      `• চিরতরে সীমাহীন ডাউনলোড\n` +
      `• 1080p \\+ 4K মান\n` +
      `• সেকেন্ডে সক্রিয়\n\n` +
      `👇 ${link}`,

    upgradeNudge3:
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *5টির মধ্যে 3টি বিনামূল্যে ডাউনলোড ব্যবহার হয়েছে*\n` +
      `Premium ব্যবহারকারীরা কখনো গোনে না 😎\n` +
      `*₹29/মাস → চিরতরে সীমাহীন*\n` +
      `/premium দিয়ে আপগ্রেড করুন`,

    upgradeNudge4: ({ link }) =>
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *এই মাসের শেষ বিনামূল্যে ডাউনলোড\\!*\n` +
      `স্পষ্টতই আপনি VidVault ভালোবাসেন 🎬\n` +
      `মাত্র *₹1/দিন* এ Premium যোগ দিন\n` +
      `👉 ${link}`,

    rateLimited: ({ sec }) => `⏱ অনুরোধের মাঝে ${sec} সেকেন্ড অপেক্ষা করুন\\.`,
    alreadyDownloading: `⏳ আগের ডাউনলোড এখনো চলছে\\. অপেক্ষা করুন\\!`,
    sessionExpired: `⏰ সেশন মেয়াদোত্তীর্ণ\\. আবার ভিডিও লিংক পাঠান\\.`,

    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *ডাউনলোড প্রস্তুত\\!*\n\n` +
      `🎬 ${title}\n` +
      `📊 মান: *${label}*\n` +
      `📦 আকার: ${size}\n` +
      `⚡ প্ল্যাটফর্ম: ${platform}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 *ডাউনলোড করতে ট্যাপ করুন:*\n` +
      `${url}\n\n` +
      `⏰ *1 ঘণ্টা* পাওয়া যাবে\n\n` +
      `${isPremium ? `⭐ *Premium* — সীমাহীন ডাউনলোড উপভোগ করুন\\!` : `📊 ব্যবহৃত: *${used}/${limit}*`}`,

    lockedQuality: `🔒 Premium মান — ₹29/মাসে আপগ্রেড করুন!`,
  },

  // ─────────────────────────────────────────────────────────
  ur: {
    chooseLanguage:
      `🌍 *VidVault میں خوش آمدید\\!*\n\n` +
      `اپنی زبان چنیں:\n` +
      `_ایک بار چنیں — میں ہمیشہ اسی میں بات کروں گا_ 👇`,

    languageSet: `✅ زبان *اردو* سیٹ ہو گئی\\! چلو شروع کرتے ہیں\\! 🎬`,

    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "VidVault میں واپس آنے پر خوش آمدید" : "VidVault میں خوش آمدید"}، ${name}\\!*\n\n` +
      `*25\\+ پلیٹ فارم* سے سیکنڈوں میں ویڈیو ڈاؤن لوڈ کریں\\!\n\n` +
      `📱 YouTube • Instagram • TikTok\n` +
      `🐦 Twitter • Facebook \\& مزید\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 *مفت:* ${limit} ڈاؤن لوڈ/مہینہ • 720p\n` +
      `⭐ *Premium ₹29/مہینہ:* لامحدود • 4K\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *کوئی بھی ویڈیو لنک پیسٹ کریں\\!*`,

    pasteLink: `❓ *ڈاؤن لوڈ کے لیے ویڈیو لنک بھیجیں\\!*\n\nYouTube، Instagram، TikTok سے لنک پیسٹ کریں\n\n/help تمام کمانڈز کے لیے\\.`,
    fetching: `🔍 ویڈیو کی معلومات لی جا رہی ہیں\\.\\.\\.`,
    processing: ({ label }) => `⏳ *${label} ڈاؤن لوڈ ہو رہا ہے\\.\\.\\.*\n\nعموماً 10\\-20 سیکنڈ لگتے ہیں\\!`,
    limitReached: ({ total, days, link }) =>
      `💪 *آپ نے ${total} ویڈیو ڈاؤن لوڈ کیے — آپ بہترین ہیں\\!*\n\nمفت پلان *${days} دنوں* میں ری سیٹ ہوگا\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/مہینہ*\n• لامحدود ڈاؤن لوڈ\n• 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *5 میں سے 3 مفت ڈاؤن لوڈ استعمال ہو گئے*\nPremium صارفین کبھی نہیں گنتے 😎\n*₹29/مہینہ → لامحدود ہمیشہ کے لیے*\n/premium سے اپ گریڈ کریں`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *اس مہینے کا آخری مفت ڈاؤن لوڈ\\!*\nVidVault بہت پسند ہے آپ کو 🎬\nصرف *₹1/دن* میں Premium\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ درخواستوں کے درمیان ${sec} سیکنڈ انتظار کریں\\.`,
    alreadyDownloading: `⏳ پچھلا ڈاؤن لوڈ ابھی جاری ہے\\. انتظار کریں\\!`,
    sessionExpired: `⏰ سیشن ختم ہو گیا\\. ویڈیو لنک دوبارہ بھیجیں\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *ڈاؤن لوڈ تیار\\!*\n\n🎬 ${title}\n📊 معیار: *${label}*\n📦 سائز: ${size}\n⚡ پلیٹ فارم: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *ڈاؤن لوڈ کرنے کے لیے ٹیپ کریں:*\n${url}\n\n⏰ *1 گھنٹے* کے لیے دستیاب\n\n${isPremium ? `⭐ *Premium* — لامحدود ڈاؤن لوڈ سے لطف اندوز ہوں\\!` : `📊 استعمال شدہ: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Premium معیار — ₹29/مہینہ میں اپ گریڈ کریں!`,
  },

  // ─────────────────────────────────────────────────────────
  ta: {
    chooseLanguage: `🌍 *VidVault\\-க்கு வரவேற்கிறோம்\\!*\n\nஉங்கள் மொழியை தேர்ந்தெடுக்கவும்:\n_ஒருமுறை தேர்ந்தெடுங்கள் — எப்போதும் அதில் பேசுவேன்_ 👇`,
    languageSet: `✅ மொழி *தமிழ்* ஆக அமைக்கப்பட்டது\\! தொடங்குவோம்\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *VidVault\\-ல் ${isReturning ? "மீண்டும்" : ""} வரவேற்கிறோம், ${name}\\!*\n\n*25\\+ தளங்களில்* இருந்து வினாடிகளில் வீடியோக்களை பதிவிறக்கம் செய்யுங்கள்\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& மேலும்\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *இலவசம்:* ${limit} பதிவிறக்கங்கள்/மாதம் • 720p\n⭐ *Premium ₹29/மாதம்:* வரம்பற்றது • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *எந்த வீடியோ லிங்கையும் ஒட்டி தொடங்குங்கள்\\!*`,
    pasteLink: `❓ *பதிவிறக்கத்திற்கு வீடியோ லிங்க் அனுப்புங்கள்\\!*\n\nYouTube, Instagram, TikTok இல் இருந்து லிங்க் ஒட்டுங்கள்\n\n/help என்று தட்டச்சு செய்யுங்கள்\\.`,
    fetching: `🔍 வீடியோ தகவல் பெறுகிறோம்\\.\\.\\.`,
    processing: ({ label }) => `⏳ *${label} பதிவிறக்கம் ஆகிறது\\.\\.\\.*\n\nவழக்கமாக 10\\-20 வினாடிகள்\\!`,
    limitReached: ({ total, days, link }) => `💪 *நீங்கள் ${total} வீடியோக்கள் பதிவிறக்கம் செய்தீர்கள்\\!*\n\nஇலவச திட்டம் *${days} நாட்களில்* மீட்டமைக்கப்படும\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/மாதம்*\n• வரம்பற்ற பதிவிறக்கங்கள்\n• 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *5 இல் 3 இலவச பதிவிறக்கங்கள் பயன்படுத்தப்பட்டன*\nPremium பயனர்கள் எண்ண மாட்டார்கள் 😎\n*₹29/மாதம் → எப்போதும் வரம்பற்றது*\n/premium மேம்படுத்த`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *இந்த மாதத்தின் கடைசி இலவச பதிவிறக்கம்\\!*\nVidVault மிகவும் பிடிக்கிறது 🎬\n*₹1/நாள்* மட்டுமே Premium\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ கோரிக்கைகளுக்கு இடையே ${sec} வினாடிகள் காத்திருங்கள்\\.`,
    alreadyDownloading: `⏳ முந்தைய பதிவிறக்கம் நடைபெறுகிறது\\. காத்திருங்கள்\\!`,
    sessionExpired: `⏰ அமர்வு காலாவதியானது\\. வீடியோ லிங்கை மீண்டும் அனுப்புங்கள்\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *பதிவிறக்கம் தயார்\\!*\n\n🎬 ${title}\n📊 தரம்: *${label}*\n📦 அளவு: ${size}\n⚡ தளம்: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *பதிவிறக்க தட்டவும்:*\n${url}\n\n⏰ *1 மணி நேரம்* கிடைக்கும்\n\n${isPremium ? `⭐ *Premium* — வரம்பற்ற பதிவிறக்கங்களை அனுபவியுங்கள்\\!` : `📊 பயன்படுத்தியது: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Premium தரம் — ₹29/மாதம் மேம்படுத்துங்கள்!`,
  },

  // ─────────────────────────────────────────────────────────
  te: {
    chooseLanguage: `🌍 *VidVault\\-కు స్వాగతం\\!*\n\nమీ భాషను ఎంచుకోండి:\n_ఒకసారి ఎంచుకోండి — నేన ెప్పుడూ అందులో మాట్లాడతాను_ 👇`,
    languageSet: `✅ భాష *తెలుగు*గా సెట్ చేయబడింది\\! ప్రారంభిద్దాం\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *VidVault\\-కు ${isReturning ? "మళ్ళీ" : ""} స్వాగతం, ${name}\\!*\n\n*25\\+ ప్లాట్‌ఫారమ్‌ల* నుండి సెకన్లలో వీడియోలు డౌన్‌లోడ్ చేయండి\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& మరిన్ని\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *ఉచితం:* ${limit} డౌన్‌లోడ్‌లు/నెల • 720p\n⭐ *Premium ₹29/నెల:* అపరిమితం • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *ఏదైనా వీడియో లింక్ పేస్ట్ చేయండి\\!*`,
    pasteLink: `❓ *డౌన్‌లోడ్ చేయడానికి వీడియో లింక్ పంపండి\\!*\n\nYouTube, Instagram, TikTok నుండి లింక్ పేస్ట్ చేయండి\n\n/help అన్ని ఆదేశాల కోసం\\.`,
    fetching: `🔍 వీడియో సమాచారం తీసుకుంటున్నాం\\.\\.\\.`,
    processing: ({ label }) => `⏳ *${label} డౌన్‌లోడ్ అవుతోంది\\.\\.\\.*\n\nసాధారణంగా 10\\-20 సెకండ్లు\\!`,
    limitReached: ({ total, days, link }) => `💪 *మీరు ${total} వీడియోలు డౌన్‌లోడ్ చేశారు\\!*\n\nఉచిత ప్లాన్ *${days} రోజులలో* రీసెట్ అవుతుంది\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/నెల*\n• అపరిమిత డౌన్‌లోడ్‌లు\n• 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *5 లో 3 ఉచిత డౌన్‌లోడ్‌లు ఉపయోగించారు*\nPremium వినియోగదారులు లెక్కించరు 😎\n*₹29/నెల → ఎల్లప్పుడూ అపరిమితం*\n/premium అప్‌గ్రేడ్ చేయడానికి`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *ఈ నెల చివరి ఉచిత డౌన్‌లోడ్\\!*\nVidVault చాలా ఇష్టం 🎬\n*₹1/రోజు* మాత్రమే Premium\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ అభ్యర్థనల మధ్య ${sec} సెకండ్లు వేచి ఉండండి\\.`,
    alreadyDownloading: `⏳ మీ మునుపటి డౌన్‌లోడ్ ఇంకా జరుగుతోంది\\. వేచి ఉండండి\\!`,
    sessionExpired: `⏰ సెషన్ గడువు తీరింది\\. వీడియో లింక్ మళ్ళీ పంపండి\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *డౌన్‌లోడ్ సిద్ధం\\!*\n\n🎬 ${title}\n📊 నాణ్యత: *${label}*\n📦 పరిమాణం: ${size}\n⚡ ప్లాట్‌ఫారమ్: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *డౌన్‌లోడ్ చేయడానికి నొక్కండి:*\n${url}\n\n⏰ *1 గంట* అందుబాటులో\n\n${isPremium ? `⭐ *Premium* — అపరిమిత డౌన్‌లోడ్‌లు ఆస్వాదించండి\\!` : `📊 ఉపయోగించింది: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Premium నాణ్యత — ₹29/నెలకు అప్‌గ్రేడ్!`,
  },

  // ─────────────────────────────────────────────────────────
  zh: {
    chooseLanguage: `🌍 *欢迎来到 VidVault\\!*\n\n请选择您的语言:\n_选择一次 — 我将始终以该语言与您交流_ 👇`,
    languageSet: `✅ 语言已设置为 *中文*\\! 开始吧\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "欢迎回到" : "欢迎来到"} VidVault, ${name}\\!*\n\n从 *25\\+ 平台* 秒速下载视频\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& 更多\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *免费:* ${limit} 次下载/月 • 720p\n⭐ *Premium ₹29/月:* 无限 • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *粘贴任意视频链接即可开始\\!*`,
    pasteLink: `❓ *发送视频链接即可下载\\!*\n\n粘贴来自 YouTube、Instagram、TikTok 等的链接\n\n输入 /help 查看所有命令\\.`,
    fetching: `🔍 正在获取视频信息\\.\\.\\.`,
    processing: ({ label }) => `⏳ *正在下载 ${label}\\.\\.\\.*\n\n通常需要 10\\-20 秒\\!`,
    limitReached: ({ total, days, link }) => `💪 *您已下载 ${total} 个视频 — 您太厉害了\\!*\n\n免费计划将在 *${days} 天* 后重置\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/月*\n• 永久无限下载\n• 1080p \\+ 4K 画质\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *已使用 5 次中的 3 次免费下载*\nPremium 用户从不计数 😎\n*₹29/月 → 永久无限*\n/premium 升级`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *本月最后一次免费下载\\!*\n您显然很喜欢 VidVault 🎬\n只需 *₹1/天* 加入 Premium\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ 请在请求之间等待 ${sec} 秒\\.`,
    alreadyDownloading: `⏳ 您的上一个下载仍在进行中\\. 请稍候\\!`,
    sessionExpired: `⏰ 会话已过期\\. 请重新发送视频链接\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *下载就绪\\!*\n\n🎬 ${title}\n📊 画质: *${label}*\n📦 大小: ${size}\n⚡ 平台: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *点击下载:*\n${url}\n\n⏰ 有效期 *1 小时*\n\n${isPremium ? `⭐ *Premium* — 享受无限下载\\!` : `📊 已用下载: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Premium 画质 — ₹29/月升级!`,
  },

  // ─────────────────────────────────────────────────────────
  ko: {
    chooseLanguage: `🌍 *VidVault에 오신 것을 환영합니다\\!*\n\n언어를 선택하세요:\n_한 번만 선택하세요 — 항상 그 언어로 대화할게요_ 👇`,
    languageSet: `✅ 언어가 *한국어*로 설정되었습니다\\! 시작해볼까요\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *VidVault에 ${isReturning ? "다시 오신 것을 환영합니다" : "오신 것을 환영합니다"}, ${name}\\!*\n\n*25\\+ 플랫폼*에서 초 안에 비디오를 다운로드하세요\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& 더보기\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *무료:* ${limit}회 다운로드/월 • 720p\n⭐ *Premium ₹29/월:* 무제한 • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *영상 링크를 붙여넣어 시작하세요\\!*`,
    pasteLink: `❓ *다운로드할 비디오 링크를 보내주세요\\!*\n\nYouTube, Instagram, TikTok 링크를 붙여넣으세요\n\n/help 로 모든 명령어 확인\\.`,
    fetching: `🔍 비디오 정보 가져오는 중\\.\\.\\.`,
    processing: ({ label }) => `⏳ *${label} 다운로드 중\\.\\.\\.*\n\n보통 10\\-20초 소요\\!`,
    limitReached: ({ total, days, link }) => `💪 *${total}개의 비디오를 다운로드했습니다\\!*\n\n무료 플랜은 *${days}일* 후 초기화됩니다\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/월*\n• 영구 무제한 다운로드\n• 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *5회 중 3회 무료 다운로드 사용*\nPremium 사용자는 절대 세지 않아요 😎\n*₹29/월 → 영구 무제한*\n/premium 업그레이드`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *이번 달 마지막 무료 다운로드\\!*\n VidVault를 정말 좋아하시는군요 🎬\n*₹1/일*로 Premium\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ 요청 사이에 ${sec}초를 기다려주세요\\.`,
    alreadyDownloading: `⏳ 이전 다운로드가 아직 진행 중입니다\\. 기다려주세요\\!`,
    sessionExpired: `⏰ 세션이 만료되었습니다\\. 비디오 링크를 다시 보내주세요\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *다운로드 완료\\!*\n\n🎬 ${title}\n📊 품질: *${label}*\n📦 크기: ${size}\n⚡ 플랫폼: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *다운로드하려면 탭하세요:*\n${url}\n\n⏰ *1시간* 동안 이용 가능\n\n${isPremium ? `⭐ *Premium* — 무제한 다운로드를 즐기세요\\!` : `📊 사용한 다운로드: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Premium 품질 — ₹29/월로 업그레이드!`,
  },

  // ─────────────────────────────────────────────────────────
  ja: {
    chooseLanguage: `🌍 *VidVaultへようこそ\\!*\n\n言語を選択してください:\n_一度だけ選択してください — 常にその言語で話します_ 👇`,
    languageSet: `✅ 言語を *日本語* に設定しました\\! さあ始めましょう\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *VidVaultへ${isReturning ? "お帰りなさい" : "ようこそ"}, ${name}\\!*\n\n*25\\+ プラットフォーム*から数秒で動画をダウンロード\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& その他\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *無料:* ${limit}回ダウンロード/月 • 720p\n⭐ *Premium ₹29/月:* 無制限 • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *動画リンクを貼り付けて開始\\!*`,
    pasteLink: `❓ *ダウンロードする動画リンクを送ってください\\!*\n\nYouTube、Instagram、TikTokなどのリンクを貼り付けてください\n\n/help で全コマンドを確認\\.`,
    fetching: `🔍 動画情報を取得中\\.\\.\\.`,
    processing: ({ label }) => `⏳ *${label} をダウンロード中\\.\\.\\.*\n\n通常10\\-20秒かかります\\!`,
    limitReached: ({ total, days, link }) => `💪 *${total}本の動画をダウンロードしました\\!*\n\n無料プランは *${days}日* 後にリセットされます\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/月*\n• 永久無制限ダウンロード\n• 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *5回中3回の無料ダウンロードを使用*\nPremiumユーザーは決して数えません 😎\n*₹29/月 → 永久無制限*\n/premium でアップグレード`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *今月の最後の無料ダウンロード\\!*\nVidVaultが大好きなんですね 🎬\n*₹1/日* でPremium\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ リクエストの間に ${sec} 秒お待ちください\\.`,
    alreadyDownloading: `⏳ 前のダウンロードがまだ処理中です\\. お待ちください\\!`,
    sessionExpired: `⏰ セッションが期限切れです\\. 動画リンクを再送してください\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *ダウンロード完了\\!*\n\n🎬 ${title}\n📊 品質: *${label}*\n📦 サイズ: ${size}\n⚡ プラットフォーム: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *ダウンロードするにはタップ:*\n${url}\n\n⏰ *1時間* 利用可能\n\n${isPremium ? `⭐ *Premium* — 無制限ダウンロードを楽しんで\\!` : `📊 使用したダウンロード: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Premium品質 — ₹29/月でアップグレード!`,
  },

  // ─────────────────────────────────────────────────────────
  vi: {
    chooseLanguage: `🌍 *Chào mừng đến VidVault\\!*\n\nChọn ngôn ngữ của bạn:\n_Chọn một lần — tôi sẽ luôn nói chuyện bằng ngôn ngữ đó_ 👇`,
    languageSet: `✅ Ngôn ngữ đã đặt thành *Tiếng Việt*\\! Bắt đầu thôi\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "Chào mừng trở lại" : "Chào mừng đến"} VidVault, ${name}\\!*\n\nTải video từ *25\\+ nền tảng* trong vài giây\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& nhiều hơn\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *Miễn phí:* ${limit} lần tải/tháng • 720p\n⭐ *Premium ₹29/tháng:* Không giới hạn • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *Chỉ cần dán link video để bắt đầu\\!*`,
    pasteLink: `❓ *Gửi cho tôi link video để tải\\!*\n\nDán link từ YouTube, Instagram, TikTok và nhiều hơn\n\nGõ /help để xem tất cả lệnh\\.`,
    fetching: `🔍 Đang lấy thông tin video\\.\\.\\.`,
    processing: ({ label }) => `⏳ *Đang tải ${label}\\.\\.\\.*\n\nThường mất 10\\-20 giây\\!`,
    limitReached: ({ total, days, link }) => `💪 *Bạn đã tải ${total} video — bạn thật tuyệt\\!*\n\nGói miễn phí reset sau *${days} ngày*\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/tháng*\n• Tải không giới hạn mãi mãi\n• Chất lượng 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *Đã dùng 3/5 lượt tải miễn phí*\nNgười dùng Premium không bao giờ đếm 😎\n*₹29/tháng → Không giới hạn mãi mãi*\n/premium để nâng cấp`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *Lượt tải miễn phí cuối cùng trong tháng\\!*\nBạn rõ ràng yêu VidVault 🎬\nTham gia Premium chỉ *₹1/ngày*\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ Vui lòng chờ ${sec} giây giữa các yêu cầu\\.`,
    alreadyDownloading: `⏳ Lượt tải trước của bạn vẫn đang xử lý\\. Vui lòng chờ\\!`,
    sessionExpired: `⏰ Phiên đã hết hạn\\. Vui lòng gửi lại link video\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Tải Xong\\!*\n\n🎬 ${title}\n📊 Chất lượng: *${label}*\n📦 Kích thước: ${size}\n⚡ Nền tảng: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *Nhấn để tải:*\n${url}\n\n⏰ Có sẵn trong *1 giờ*\n\n${isPremium ? `⭐ *Premium* — Tận hưởng tải không giới hạn\\!` : `📊 Đã tải: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Chất lượng Premium — nâng cấp ₹29/tháng!`,
  },

  // ─────────────────────────────────────────────────────────
  th: {
    chooseLanguage: `🌍 *ยินดีต้อนรับสู่ VidVault\\!*\n\nเลือกภาษาของคุณ:\n_เลือกครั้งเดียว — ฉันจะคุยกับคุณในภาษานั้นเสมอ_ 👇`,
    languageSet: `✅ ตั้งภาษาเป็น *ภาษาไทย* แล้ว\\! มาเริ่มกันเลย\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "ยินดีต้อนรับกลับสู่" : "ยินดีต้อนรับสู่"} VidVault, ${name}\\!*\n\nดาวน์โหลดวิดีโอจาก *25\\+ แพลตฟอร์ม* ในไม่กี่วินาที\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& อื่นๆ\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *ฟรี:* ${limit} ดาวน์โหลด/เดือน • 720p\n⭐ *Premium ₹29/เดือน:* ไม่จำกัด • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *แค่วางลิงก์วิดีโอเพื่อเริ่ม\\!*`,
    pasteLink: `❓ *ส่งลิงก์วิดีโอมาดาวน์โหลด\\!*\n\nวางลิงก์จาก YouTube, Instagram, TikTok และอื่นๆ\n\nพิมพ์ /help สำหรับคำสั่งทั้งหมด\\.`,
    fetching: `🔍 กำลังดึงข้อมูลวิดีโอ\\.\\.\\.`,
    processing: ({ label }) => `⏳ *กำลังดาวน์โหลด ${label}\\.\\.\\.*\n\nปกติใช้เวลา 10\\-20 วินาที\\!`,
    limitReached: ({ total, days, link }) => `💪 *คุณดาวน์โหลด ${total} วิดีโอแล้ว — คุณเก่งมาก\\!*\n\nแผนฟรีจะรีเซ็ตใน *${days} วัน*\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/เดือน*\n• ดาวน์โหลดไม่จำกัดตลอดไป\n• คุณภาพ 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *ใช้แล้ว 3/5 ครั้งดาวน์โหลดฟรี*\nผู้ใช้ Premium ไม่เคยนับ 😎\n*₹29/เดือน → ไม่จำกัดตลอดไป*\n/premium เพื่ออัปเกรด`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *ดาวน์โหลดฟรีสุดท้ายของเดือน\\!*\nชัดเจนว่าคุณชอบ VidVault 🎬\nเข้าร่วม Premium แค่ *₹1/วัน*\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ กรุณารอ ${sec} วินาทีระหว่างคำขอ\\.`,
    alreadyDownloading: `⏳ การดาวน์โหลดก่อนหน้ายังอยู่ระหว่างดำเนินการ\\. กรุณารอ\\!`,
    sessionExpired: `⏰ เซสชันหมดอายุ\\. กรุณาส่งลิงก์วิดีโออีกครั้ง\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *ดาวน์โหลดพร้อมแล้ว\\!*\n\n🎬 ${title}\n📊 คุณภาพ: *${label}*\n📦 ขนาด: ${size}\n⚡ แพลตฟอร์ม: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *แตะเพื่อดาวน์โหลด:*\n${url}\n\n⏰ ใช้ได้ *1 ชั่วโมง*\n\n${isPremium ? `⭐ *Premium* — เพลิดเพลินกับการดาวน์โหลดไม่จำกัด\\!` : `📊 ดาวน์โหลดที่ใช้: *${used}/${limit}*`}`,
    lockedQuality: `🔒 คุณภาพ Premium — อัปเกรด ₹29/เดือน!`,
  },

  // ─────────────────────────────────────────────────────────
  it: {
    chooseLanguage: `🌍 *Benvenuto su VidVault\\!*\n\nScegli la tua lingua:\n_Scegli una volta — parlerò sempre in quella lingua_ 👇`,
    languageSet: `✅ Lingua impostata su *Italiano*\\! Iniziamo\\! 🎬`,
    welcome: ({ name, isReturning, limit }) =>
      `🎬 *${isReturning ? "Bentornato su" : "Benvenuto su"} VidVault, ${name}\\!*\n\nScarica video da *25\\+ piattaforme* in secondi\\!\n\n📱 YouTube • Instagram • TikTok\n🐦 Twitter • Facebook \\& altro\n\n━━━━━━━━━━━━━━━━━━━━\n🆓 *Gratis:* ${limit} download/mese • 720p\n⭐ *Premium ₹29/mese:* Illimitato • 4K\n\n━━━━━━━━━━━━━━━━━━━━\n👇 *Incolla qualsiasi link video per iniziare\\!*`,
    pasteLink: `❓ *Inviami un link video da scaricare\\!*\n\nIncolla un link da YouTube, Instagram, TikTok e altro\n\nDigita /help per tutti i comandi\\.`,
    fetching: `🔍 Recupero info video\\.\\.\\.`,
    processing: ({ label }) => `⏳ *Download di ${label}\\.\\.\\.*\n\nDi solito 10\\-20 secondi\\!`,
    limitReached: ({ total, days, link }) => `💪 *Hai scaricato ${total} video — sei un pro\\!*\n\nIl piano gratuito si resetta tra *${days} giorni*\\.\n\n━━━━━━━━━━━━━━━━━━━━\n⭐ *Premium — ₹29/mese*\n• Download illimitati per sempre\n• Qualità 1080p \\+ 4K\n\n👇 ${link}`,
    upgradeNudge3: `\n━━━━━━━━━━━━━━━━━━━━\n⚡ *Hai usato 3 dei 5 download gratuiti*\nGli utenti Premium non contano mai 😎\n*₹29/mese → Illimitato per sempre*\n/premium per aggiornare`,
    upgradeNudge4: ({ link }) => `\n━━━━━━━━━━━━━━━━━━━━\n🔥 *Ultimo download gratuito del mese\\!*\nAmi chiaramente VidVault 🎬\nUnisciti a Premium per solo *₹1/giorno*\n👉 ${link}`,
    rateLimited: ({ sec }) => `⏱ Aspetta ${sec} secondi tra le richieste\\.`,
    alreadyDownloading: `⏳ Il download precedente è ancora in corso\\. Aspetta\\!`,
    sessionExpired: `⏰ Sessione scaduta\\. Invia di nuovo il link video\\.`,
    downloadReady: ({ title, label, size, platform, url, used, limit, isPremium }) =>
      `✅ *Download Pronto\\!*\n\n🎬 ${title}\n📊 Qualità: *${label}*\n📦 Dimensione: ${size}\n⚡ Piattaforma: ${platform}\n\n━━━━━━━━━━━━━━━━━━━━\n🔗 *Tocca per scaricare:*\n${url}\n\n⏰ Disponibile per *1 ora*\n\n${isPremium ? `⭐ *Premium* — Goditi i download illimitati\\!` : `📊 Download usati: *${used}/${limit}*`}`,
    lockedQuality: `🔒 Qualità Premium — aggiorna per ₹29/mese!`,
  },
};

// ═══════════════════════════════════════════════════════════
// TRANSLATION HELPER
// ═══════════════════════════════════════════════════════════
function t(lang, key, vars) {
  const pack = T[lang] || T.en;
  const fn   = pack[key] !== undefined ? pack[key] : T.en[key];
  if (typeof fn === "function") return fn(vars || {});
  return fn || T.en[key] || key;
}

// ═══════════════════════════════════════════════════════════
// LANGUAGE SELECTION KEYBOARD
// ═══════════════════════════════════════════════════════════
function getLanguageKeyboard() {
  const langs = Object.entries(LANGUAGE_META);
  const rows  = [];
  for (let i = 0; i < langs.length; i += 2) {
    const row = [
      {
        text: `${langs[i][1].flag} ${langs[i][1].name}`,
        callback_data: `lang_${langs[i][0]}`,
      },
    ];
    if (langs[i + 1]) {
      row.push({
        text: `${langs[i + 1][1].flag} ${langs[i + 1][1].name}`,
        callback_data: `lang_${langs[i + 1][0]}`,
      });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

// Detect language from Telegram language_code
function detectLang(telegramLangCode) {
  if (!telegramLangCode) return null;
  const code = telegramLangCode.toLowerCase().split("-")[0];
  return TELEGRAM_LANG_MAP[code] || null;
}

module.exports = { t, getLanguageKeyboard, detectLang, LANGUAGE_META };

const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// 1. Configuration & Credentials
const BOT_TOKEN = '8834730895:AAFgHSWgfXicGylgw6OO5oyPnZtPBVK4RLo';
const SUPABASE_URL = 'https://jiqbhuxbxxrzstleitkd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppcWJodXhieHhyenN0bGVpdGtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTY0NDQsImV4cCI6MjEwMzQ3MjQ0NH0._0BAVpBDoUiRz9INRVNS327Ubgeo0Pq6IAughD4AFmg';
const BUCKET_NAME = 'document';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const userSessions = {};

// የ Polling ስህተት ቦቱን እንዳይዘገው መያዣ
bot.on('polling_error', (error) => {
  console.error('Telegram Polling Error:', error.code || error.message);
});

// Safe Edit Message Helper
async function safeEditMessage(chatId, messageId, text, options = {}) {
  try {
    return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
  } catch (err) {
    console.error('Edit Message Error:', err.message);
  }
}

// Helper: ፎቶዎችን ወደ Supabase Storage መጫኛ Function
async function uploadTelegramPhotoToSupabase(fileId, pathName) {
  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { 
      responseType: 'arraybuffer',
      timeout: 15000 // 15 ሰከንድ ታይምአውት
    });
    const buffer = Buffer.from(response.data, 'binary');

    const fileName = `${pathName}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      console.error('Storage Upload Error:', error.message);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Storage Exception:', err.message);
    return null;
  }
}

// -------------------------------------------------------------
// A. START COMMAND
// -------------------------------------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSessions[chatId] = { step: 'IDLE', updatedAt: Date.now() };

  const welcomeText = `👋 ሰላም ${msg.from.first_name}!\nእንኳን ወደ ትምህርት ቤታችን ኦፊሴላዊ ቦት በደህና መጡ።\n\nእባክዎን ከታች ካሉት አማራጮች አንዱን ይምረጡ፡`;

  bot.sendMessage(chatId, welcomeText, {
    reply_markup: {
      keyboard: [[{ text: '📝 ለማመዝገብ' }, { text: '📊 ውጤት ለማየት' }]],
      resize_keyboard: true
    }
  });
});

// -------------------------------------------------------------
// B. MAIN MESSAGE HANDLER
// -------------------------------------------------------------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('/')) return;

  if (text === '📝 ለማመዝገብ') {
    handleRegistrationStart(chatId);
  } else if (text === '📊 ውጤት ለማየት') {
    handleViewResultStart(chatId);
  } else {
    handleUserSteps(chatId, msg);
  }
});

// -------------------------------------------------------------
// C. REGISTRATION INITIATION
// -------------------------------------------------------------
async function handleRegistrationStart(chatId) {
  const { data: config } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'is_registration_open')
    .maybeSingle();

  if (config && config.value === 'false') {
    return bot.sendMessage(chatId, '❌ የዘመኑ ምዝገባ ተጠናቋል/ተዘጋቷል። ለተጨማሪ መረጃ ትምህርት ቤቱን በአካል ያነጋግሩ።');
  }

  userSessions[chatId] = { step: 'AWAITING_FAIDA_FIRST', updatedAt: Date.now() };

  const sent = await bot.sendMessage(chatId, '🆔 **ደረጃ 1/7፦** እባክዎን የ **ፋይዳ (Fayda FAN)** ቁጥርዎን ያስገቡ፡', { parse_mode: 'Markdown' });
  userSessions[chatId].mainMessageId = sent.message_id;
}

// -------------------------------------------------------------
// D. USER INPUT & STEP PROCESSING
// -------------------------------------------------------------
async function handleUserSteps(chatId, msg) {
  const session = userSessions[chatId];
  if (!session || !session.step) return;

  session.updatedAt = Date.now();
  try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}

  const msgId = session.mainMessageId;

  // 1. RESULT CHECKING HANDLER
  if (session.step === 'AWAITING_RESULT_FAIDA' && msg.text) {
    const inputFaida = msg.text.trim();
    
    const { data: student, error } = await supabase
      .from('students')
      .select('*')
      .eq('faida_number', inputFaida)
      .maybeSingle();

    if (error || !student) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, '❌ የገባው የፋይዳ ቁጥር አልተገኘም። እባክዎን ቁጥሩን አረጋግጠው ድጋሚ ይሞክሩ።');
    }

    if (student.status !== 'approved') {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, `ℹ️ የፋይዳ ቁጥር፦ ${inputFaida}\nየማመልከቻዎ ሁኔታ፦ **${student.status.toUpperCase()}**\n\nውጤት የሚለቀቀው ምዝገባዎ ሲጸድቅ ብቻ ነው።`);
    }

    const { data: results } = await supabase
      .from('results')
      .select('score, subjects(subject_name)')
      .eq('student_id', student.id)
      .eq('is_published', true);

    delete userSessions[chatId];

    if (!results || results.length === 0) {
      return bot.sendMessage(chatId, `👤 ተማሪ፦ **${student.full_name}**\n📚 ክፍል፦ **${student.grade_level}ኛ**\n\n⚠️ የዚህ ክፍለ-ጊዜ ውጤት እስካሁን አልተለቀቀም።`);
    }

    let resultText = `📊 **የውጤት መግለጫ**\n👤 ተማሪ፦ **${student.full_name}**\n📚 ክፍል፦ **${student.grade_level}ኛ**\n-------------------\n`;
    let total = 0;
    results.forEach(r => {
      resultText += `• ${r.subjects?.subject_name || 'ትምህርት'}: **${r.score}**\n`;
      total += Number(r.score);
    });
    const avg = (total / results.length).toFixed(1);
    resultText += `-------------------\n📈 **አማካይ ውጤት (Average)፦ ${avg}**`;

    return bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
  }

  // 2. FAYDA NUMBER CHECKING
  if (session.step === 'AWAITING_FAIDA_FIRST' && msg.text) {
    const inputFaida = msg.text.trim();

    const { data: existingRecords } = await supabase
      .from('students')
      .select('status')
      .eq('faida_number', inputFaida);

    const rejectedCount = existingRecords ? existingRecords.filter(r => r.status === 'rejected').length : 0;
    const hasApproved = existingRecords ? existingRecords.some(r => r.status === 'approved') : false;
    const hasPending = existingRecords ? existingRecords.some(r => r.status === 'pending') : false;

    if (hasApproved) {
      delete userSessions[chatId];
      return safeEditMessage(chatId, msgId, '✅ ይህ የፋይዳ ቁጥር አስቀድሞ በስኬት ተመዝግቧል። ውጤት ለማየት የመነሻ ገጽን ይጠቀሙ።');
    }

    if (hasPending) {
      delete userSessions[chatId];
      return safeEditMessage(chatId, msgId, '⏳ ይህ የፋይዳ ቁጥር አስቀድሞ ማመልከቻ ያስገባ ሲሆን በአሁኑ ወቅት በግምገማ (Pending) ላይ ይገኛል። እባክዎን አድሚኑ እስኪያጸድቀው ይታገሱ።');
    }

    if (rejectedCount >= 3) {
      delete userSessions[chatId];
      return safeEditMessage(chatId, msgId, '🛑 ይህ የፋይዳ ቁጥር 3 ጊዜ ማመልከቻ ያስገባ ሲሆን 3ቱም ተቀባይነት አላገኙም። በቦቱ መመዝገብ አይችሉም፤ እባክዎን በትምህርት ቤቱ በአካል በመገኘት ይመዝገቡ።');
    }

    session.faida_number = inputFaida;
    session.step = 'SELECT_GRADE';

    const gradeKeyboard = {
      inline_keyboard: [
        [{ text: '9ኛ ክፍል', callback_data: 'GRADE_9' }, { text: '10ኛ ክፍል', callback_data: 'GRADE_10' }],
        [{ text: '11ኛ ክፍል', callback_data: 'GRADE_11' }, { text: '12ኛ ክፍል', callback_data: 'GRADE_12' }]
      ]
    };

    return safeEditMessage(chatId, msgId, `✅ የፋይዳ ቁጥር (${inputFaida}) ተመዝግቧል።\n\n📚 **ደረጃ 2/7፦** እባክዎን መመዝገብ የሚፈልጉትን ክፍል ይምረጡ፡`, { reply_markup: gradeKeyboard });
  }

  // 3. TEXT INPUTS
  if (session.step === 'AWAITING_FULL_NAME' && msg.text) {
    session.full_name = msg.text.trim();
    session.step = 'AWAITING_FATHER_NAME';
    return safeEditMessage(chatId, msgId, `👤 የተማሪ ስም፦ **${session.full_name}**\n\n👨 **የአባት ሙሉ ስም** ያስገቡ፡`, { parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_FATHER_NAME' && msg.text) {
    session.father_name = msg.text.trim();
    session.step = 'AWAITING_MOTHER_NAME';
    return safeEditMessage(chatId, msgId, `👨 የአባት ስም፦ **${session.father_name}**\n\n👩 **የእናት ሙሉ ስም** ያስገቡ፡`, { parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_MOTHER_NAME' && msg.text) {
    session.mother_name = msg.text.trim();
    session.step = 'AWAITING_MOTHER_PHONE';
    return safeEditMessage(chatId, msgId, `👩 የእናት ስም፦ **${session.mother_name}**\n\n📞 **የእናት የስልክ ቁጥር** ያስገቡ፡`, { parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_MOTHER_PHONE' && msg.text) {
    session.mother_phone = msg.text.trim();
    session.step = 'AWAITING_CARD_PHOTO';
    return safeEditMessage(chatId, msgId, `✅ የስልክ ቁጥር ተመዝግቧል።\n\n📸 **ደረጃ 4/7፦** እባክዎን የባለፈው ዓመት የትምህርት **ሪፖርት ካርድዎን** ጥራት ያለው ፎቶ ይላኩ፡`, { parse_mode: 'Markdown' });
  }

  // 4. PHOTO UPLOADS & AVERAGE INPUT
  if (session.step === 'AWAITING_CARD_PHOTO' && msg.photo) {
    await safeEditMessage(chatId, msgId, '⏳ ሪፖርት ካርድ ወደ Storage በመጫን ላይ ነው...');
    
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const url = await uploadTelegramPhotoToSupabase(fileId, `card_${session.faida_number}`);
    
    if (!url) {
      return safeEditMessage(chatId, msgId, '❌ ፎቶውን መጫን አልተቻለም። እባክዎን ፎቶውን ድጋሚ ይላኩ።');
    }

    session.card_photo_url = url;
    session.step = 'AWAITING_AVERAGE';
    return safeEditMessage(chatId, msgId, '✅ ሪፖርት ካርድ ተጫኗል!\n\n📊 **ደረጃ 5/7፦** እባክዎን የባለፈው ዓመት **አማካይ ውጤትዎን (Average)** በቁጥር ያስገቡ (ምሳሌ፦ 85.5)፦', { parse_mode: 'Markdown' });
  }

  // AVERAGE VALUE HANDLER
  if (session.step === 'AWAITING_AVERAGE' && msg.text) {
    const avgInput = parseFloat(msg.text.trim());

    if (isNaN(avgInput) || avgInput < 0 || avgInput > 100) {
      return safeEditMessage(chatId, msgId, '⚠️ እባክዎን ትክክለኛ የአማካይ ውጤት ቁጥር ያስገቡ (ከ 0 እስከ 100)፦');
    }

    session.average = avgInput;
    session.step = 'AWAITING_ID_PHOTO';
    return safeEditMessage(chatId, msgId, `✅ አማካይ ውጤት (${avgInput}) ተመዝግቧል!\n\n📸 **ደረጃ 6/7፦** እባክዎን የ **ብሔራዊ መታወቂያዎን (National ID)** ፎቶ ይላኩ፡`, { parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_ID_PHOTO' && msg.photo) {
    await safeEditMessage(chatId, msgId, '⏳ መታወቂያው ወደ Storage በመጫን ላይ ነው...');
    
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const url = await uploadTelegramPhotoToSupabase(fileId, `faida_${session.faida_number}`);

    if (!url) {
      return safeEditMessage(chatId, msgId, '❌ መታወቂያውን መጫን አልተቻለም። እባክዎን ፎቶውን ድጋሚ ይላኩ።');
    }

    session.faida_photo_url = url;
    return showSummaryAndReviewScreen(chatId);
  }

  if (session.step === 'AWAITING_PAYMENT_SCREENSHOT' && msg.photo) {
    await safeEditMessage(chatId, msgId, '⏳ ደረሰኙ ወደ Storage በመጫን ላይ ነው...');

    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const receiptUrl = await uploadTelegramPhotoToSupabase(fileId, `receipt_${session.faida_number}`);

    if (!receiptUrl) {
      return safeEditMessage(chatId, msgId, '❌ የክፍያ ደረሰኙን መጫን አልተቻለም። እባክዎን ደረሰኙን ድጋሚ ይላኩ።');
    }

    const { error } = await supabase.from('students').insert([{
      telegram_id: msg.from.id,
      full_name: session.full_name,
      father_name: session.father_name,
      mother_name: session.mother_name,
      faida_number: session.faida_number,
      mother_phone: session.mother_phone,
      grade_level: session.grade,
      stream: session.stream || null,
      average: session.average || null, // አዲሱ የተጨመረው Average
      card_photo_url: session.card_photo_url,
      faida_photo_url: session.faida_photo_url,
      receipt_photo_url: receiptUrl,
      status: 'pending',
      payment_status: 'pending'
    }]);

    if (error) {
      console.error('Database Insert Error:', error.message);
      return safeEditMessage(chatId, msgId, `❌ መረጃውን ሲመዘገብ ስህተት አጋጥሟል፦ ${error.message}`);
    }

    safeEditMessage(chatId, msgId, '🎉 **ምዝገባዎ በስኬት ተጠናቋል!**\n\nማመልከቻዎ በአድሚን ተገምግሞ ሲጸድቅ ማሳወቂያ ይደርስዎታል።', { parse_mode: 'Markdown' });
    delete userSessions[chatId];
  }
}

// -------------------------------------------------------------
// E. CALLBACK BUTTON HANDLERS
// -------------------------------------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = userSessions[chatId];
  if (!session) return;

  session.updatedAt = Date.now();
  bot.answerCallbackQuery(query.id);
  const msgId = session.mainMessageId;

  if (data.startsWith('GRADE_')) {
    const grade = parseInt(data.split('_')[1]);
    session.grade = grade;

    if (grade >= 11) {
      session.step = 'SELECT_STREAM';
      const streamKeyboard = {
        inline_keyboard: [
          [{ text: '🔬 Natural Science', callback_data: 'STREAM_Natural Science' }],
          [{ text: '📖 Social Science', callback_data: 'STREAM_Social Science' }]
        ]
      };
      return safeEditMessage(chatId, msgId, `✅ ${grade}ኛ ክፍል ተመርጧል።\n\n🧭 እባክዎን የትምህርት ዘርፍ ይምረጡ፡`, { reply_markup: streamKeyboard });
    } else {
      session.stream = null;
      session.step = 'AWAITING_FULL_NAME';
      return safeEditMessage(chatId, msgId, `✅ ${grade}ኛ ክፍል ተመርጧል።\n\n👤 **ደረጃ 3/7፦** የተማሪውን **ስም (የራሱን ብቻ)** ያስገቡ፡`, { parse_mode: 'Markdown' });
    }
  }

  if (data.startsWith('STREAM_')) {
    session.stream = data.replace('STREAM_', '');
    session.step = 'AWAITING_FULL_NAME';
    return safeEditMessage(chatId, msgId, `✅ ዘርፍ፦ **${session.stream}** ተመርጧል።\n\n👤 **ደረጃ 3/7፦** የተማሪውን **ስም (የራሱን ብቻ)** ያስገቡ፡`, { parse_mode: 'Markdown' });
  }

  if (data === 'EDIT_FAIDA') {
    session.step = 'AWAITING_FAIDA_FIRST';
    return safeEditMessage(chatId, msgId, '🆔 አዲስ **ፋይዳ ቁጥር** ያስገቡ፡');
  }

  if (data === 'EDIT_NAME') {
    session.step = 'AWAITING_FULL_NAME';
    return safeEditMessage(chatId, msgId, '👤 አዲስ **የተማሪ ስም** ያስገቡ፡');
  }

  if (data === 'CONFIRM_GO_TO_PAYMENT') {
    session.step = 'AWAITING_PAYMENT_SCREENSHOT';
    const paymentText = `💳 **የክፍያ መረጃ (ደረጃ 7/7)**\n\n` +
      `እባክዎን የምዝገባ ክፍያ **500 ብር** በሚከተለው የባንክ ሂሳብ ገቢ ያድርጉ፡\n` +
      `🏦 **ኢትዮጵያ ንግድ ባንክ:** 1000XXXXXXXXX\n` +
      `👤 **ስም:** ንጉስ ሁለተኛ ደረጃ ትምህርት ቤት\n\n` +
      `📸 ክፍያውን ፈጽመው ደረሰኙን (ስክሪንሹት) ይላኩ።`;

    return safeEditMessage(chatId, msgId, paymentText, { parse_mode: 'Markdown' });
  }
});

// REVIEW & EDIT SUMMARY SCREEN
function showSummaryAndReviewScreen(chatId) {
  const session = userSessions[chatId];
  session.step = 'REVIEW_SUMMARY';

  let summaryText = `📋 **የማመልከቻዎ ማጠቃለያ**\n\n` +
    `👤 **ስም፦** ${session.full_name} ${session.father_name}\n` +
    `🆔 **ፋይዳ ቁጥር፦** ${session.faida_number}\n` +
    `📚 **ክፍል፦** ${session.grade}ኛ ${session.stream ? `(${session.stream})` : ''}\n` +
    `📊 **አማካይ ውጤት (Average)፦** ${session.average || 'አልተሞላም'}\n` +
    `👩 **የእናት ስም፦** ${session.mother_name}\n` +
    `📞 **ስልክ፦** ${session.mother_phone}\n\n` +
    `እባክዎን መረጃዎቹ ትክክል መሆናቸውን ያረጋግጡ። ለማስተካከል የሚፈልጉት ካለ ከታች ያሉትን ቁልፎች ይጠቀሙ፦`;

  const reviewButtons = {
    inline_keyboard: [
      [{ text: '✏️ ፋይዳ ለማስተካከል', callback_data: 'EDIT_FAIDA' }],
      [{ text: '✏️ ስም ለማስተካከል', callback_data: 'EDIT_NAME' }],
      [{ text: '✅ መረጃው ትክክል ነው (ወደ ክፍያ እለፍ)', callback_data: 'CONFIRM_GO_TO_PAYMENT' }]
    ]
  };

  return safeEditMessage(chatId, session.mainMessageId, summaryText, {
    reply_markup: reviewButtons,
    parse_mode: 'Markdown'
  });
}

// RESULT CHECKING INITIATION
function handleViewResultStart(chatId) {
  userSessions[chatId] = { step: 'AWAITING_RESULT_FAIDA', updatedAt: Date.now() };
  bot.sendMessage(chatId, '🔍 እባክዎን ለማረጋገጫ የ **ፋይዳ (Fayda FAN)** ቁጥርዎን ያስገቡ፡');
}

// Expired Session Cleaner (Memory Leak ለመከላከል)
setInterval(() => {
  const now = Date.now();
  for (const chatId in userSessions) {
    if (userSessions[chatId].updatedAt && (now - userSessions[chatId].updatedAt > 20 * 60 * 1000)) {
      delete userSessions[chatId];
    }
  }
}, 10 * 60 * 1000);

// HTTP Server for Render Hosting
const http = require('http');
http.createServer((req, res) => res.end('School Registration Bot Running!')).listen(process.env.PORT || 3000);

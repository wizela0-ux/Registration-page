const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// 1. configuration with provided credentials
const BOT_TOKEN = '8834730895:AAFgHSWgfXicGylgw6OO5oyPnZtPBVK4RLo';
const SUPABASE_URL = 'https://jiqbhuxbxxrzstleitkd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppcWJodXhieHhyenN0bGVpdGtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTY0NDQsImV4cCI6MjEwMzQ3MjQ0NH0._0BAVpBDoUiRz9INRVNS327Ubgeo0Pq6IAughD4AFmg';
const BUCKET_NAME = 'document';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const userSessions = {};

// Helper: ፎቶዎችን ወደ Supabase Storage መጫኛ function
async function uploadTelegramPhotoToSupabase(fileId, pathName) {
  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    const fileName = `${pathName}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Storage Upload Error:', err);
    return null;
  }
}

// -------------------------------------------------------------
// A. START COMMAND
// -------------------------------------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSessions[chatId] = { step: 'IDLE' };

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
// C. REGISTRATION INITIATION & LEVEL SELECTION
// -------------------------------------------------------------
async function handleRegistrationStart(chatId) {
  // Check System Status
  const { data: config } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'is_registration_open')
    .maybeSingle();

  if (config && config.value === 'false') {
    return bot.sendMessage(chatId, '❌ የዘመኑ ምዝገባ ተጠናቋል/ተዘጋቷል። ለተጨማሪ መረጃ ትምህርት ቤቱን በአካል ያነጋግሩ።');
  }

  userSessions[chatId] = { step: 'AWAITING_FAIDA_FIRST' };

  const sent = await bot.sendMessage(chatId, '🆔 **ደረጃ 1/6፦** እባክዎን የ **ፋይዳ (Fayda FAN)** ቁጥርዎን ያስገቡ፡', { parse_mode: 'Markdown' });
  userSessions[chatId].mainMessageId = sent.message_id;
}

// -------------------------------------------------------------
// D. USER INPUT & STEP PROCESSING
// -------------------------------------------------------------
async function handleUserSteps(chatId, msg) {
  const session = userSessions[chatId];
  if (!session || !session.step) return;

  // Delete User Message to keep chat super clean
  try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}

  const msgId = session.mainMessageId;

  // 1. FAYDA NUMBER CHECK (With 3-reject limit validation)
  if (session.step === 'AWAITING_FAIDA_FIRST' && msg.text) {
    const inputFaida = msg.text.trim();

    // Check existing rejects count
    const { data: existingRecords } = await supabase
      .from('students')
      .select('status')
      .eq('faida_number', inputFaida);

    const rejectedCount = existingRecords ? existingRecords.filter(r => r.status === 'rejected').length : 0;
    const hasApproved = existingRecords ? existingRecords.some(r => r.status === 'approved') : false;

    if (hasApproved) {
      delete userSessions[chatId];
      return bot.editMessageText('✅ ይህ የፋይዳ ቁጥር አስቀድሞ በስኬት ተመዝግቧል። ውጤት ለማየት የመነሻ ገጽን ይጠቀሙ።', { chat_id: chatId, message_id: msgId });
    }

    if (rejectedCount >= 3) {
      delete userSessions[chatId];
      return bot.editMessageText('🛑 ይህ የፋይዳ ቁጥር 3 ጊዜ ማመልከቻ ያስገባ ሲሆን 3ቱም ተቀባይነት አላገኙም። በቦቱ መመዝገብ አይችሉም፤ እባክዎን በትምህርት ቤቱ በአካል በመገኘት ይመዝገቡ።', { chat_id: chatId, message_id: msgId });
    }

    session.faida_number = inputFaida;
    session.step = 'SELECT_GRADE';

    const gradeKeyboard = {
      inline_keyboard: [
        [{ text: '9ኛ ክፍል', callback_data: 'GRADE_9' }, { text: '10ኛ ክፍል', callback_data: 'GRADE_10' }],
        [{ text: '11ኛ ክፍል', callback_data: 'GRADE_11' }, { text: '12ኛ ክፍል', callback_data: 'GRADE_12' }]
      ]
    };

    return bot.editMessageText(`✅ የፋይዳ ቁጥር (${inputFaida}) ተመዝግቧል።\n\n📚 **ደረጃ 2/6፦** እባክዎን መመዝገብ የሚፈልጉትን ክፍል ይምረጡ፡`, {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: gradeKeyboard
    });
  }

  // TEXT INPUTS (Names & Phone)
  if (session.step === 'AWAITING_FULL_NAME' && msg.text) {
    session.full_name = msg.text.trim();
    session.step = 'AWAITING_FATHER_NAME';
    return bot.editMessageText(`👤 የተማሪ ስም፡ **${session.full_name}**\n\n👨 **የአባት ሙሉ ስም** ያስገቡ፡`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_FATHER_NAME' && msg.text) {
    session.father_name = msg.text.trim();
    session.step = 'AWAITING_MOTHER_NAME';
    return bot.editMessageText(`👨 የአባት ስም፡ **${session.father_name}**\n\n👩 **የእናት ሙሉ ስም** ያስገቡ፡`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_MOTHER_NAME' && msg.text) {
    session.mother_name = msg.text.trim();
    session.step = 'AWAITING_MOTHER_PHONE';
    return bot.editMessageText(`👩 የእናት ስም፡ **${session.mother_name}**\n\n📞 **የእናት የስልክ ቁጥር** ያስገቡ፡`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  }

  if (session.step === 'AWAITING_MOTHER_PHONE' && msg.text) {
    session.mother_phone = msg.text.trim();
    session.step = 'AWAITING_CARD_PHOTO';
    return bot.editMessageText(`✅ የስልክ ቁጥር ተመዝግቧል።\n\n📸 **ደረጃ 4/6፦** እባክዎን የባለፈው ዓመት የትምህርት **ሪፖርት ካርድዎን** ጥራት ያለው ፎቶ ይላኩ፡`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  }

  // PHOTO UPLOADS WITH ANIMATION STATUS
  if (session.step === 'AWAITING_CARD_PHOTO' && msg.photo) {
    await bot.editMessageText('🔍 ሰነዱ እየተፈተሸ ነው... እባክዎን ይቆዩ።', { chat_id: chatId, message_id: msgId });
    
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await bot.editMessageText('⏳ ፎቶው ወደ Storage በመጫን ላይ ነው...', { chat_id: chatId, message_id: msgId });
    
    const url = await uploadTelegramPhotoToSupabase(fileId, `card_${session.faida_number}`);
    session.card_photo_url = url;

    session.step = 'AWAITING_ID_PHOTO';
    return bot.editMessageText('✅ ሪፖርት ካርድ ተጫኗል!\n\n📸 **ደረጃ 5/6፦** እባክዎን የ **ብሔራዊ መታወቂያዎን (National ID)** ፎቶ ይላኩ፡', { chat_id: chatId, message_id: msgId });
  }

  if (session.step === 'AWAITING_ID_PHOTO' && msg.photo) {
    await bot.editMessageText('🔍 መታወቂያው እየተመረመረ ነው...', { chat_id: chatId, message_id: msgId });
    
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await bot.editMessageText('⏳ መታወቂያው ወደ Storage በመጫን ላይ ነው...', { chat_id: chatId, message_id: msgId });
    
    const url = await uploadTelegramPhotoToSupabase(fileId, `faida_${session.faida_number}`);
    session.faida_photo_url = url;

    // Proceed to Summary Edit Screen
    return showSummaryAndReviewScreen(chatId);
  }

  if (session.step === 'AWAITING_PAYMENT_SCREENSHOT' && msg.photo) {
    await bot.editMessageText('🔍 ደረሰኙ እየተረጋገጠ ነው...', { chat_id: chatId, message_id: msgId });

    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const receiptUrl = await uploadTelegramPhotoToSupabase(fileId, `receipt_${session.faida_number}`);

    // Insert to Supabase Database
    const { error } = await supabase.from('students').insert([{
      telegram_id: msg.from.id,
      full_name: `${session.full_name} ${session.father_name}`,
      father_name: session.father_name,
      mother_name: session.mother_name,
      faida_number: session.faida_number,
      mother_phone: session.mother_phone,
      grade_level: session.grade,
      stream: session.stream,
      card_photo_url: session.card_photo_url,
      faida_photo_url: session.faida_photo_url,
      receipt_photo_url: receiptUrl,
      status: 'pending',
      payment_status: 'pending'
    }]);

    if (error) {
      console.error(error);
      return bot.editMessageText('❌ መረጃውን ሲመዘገብ ስህተት አጋጥሟል። እባክዎን እንደገና ይሞክሩ።', { chat_id: chatId, message_id: msgId });
    }

    bot.editMessageText('🎉 **ምዝገባዎ በስኬት ተጠናቋል!**\n\nማመልከቻዎ በአድሚን ተገምግሞ ሲጸድቅ ማሳወቂያ ይደርስዎታል።', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
    delete userSessions[chatId];
  }
}

// -------------------------------------------------------------
// E. CALLBACK BUTTON HANDLERS (Grades, Streams, Edit Actions)
// -------------------------------------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = userSessions[chatId];
  if (!session) return;

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
      return bot.editMessageText(`✅ ${grade}ኛ ክፍል ተመርጧል።\n\n🧭 እባክዎን የትምህርት ዘርፍ ይምረጡ፡`, { chat_id: chatId, message_id: msgId, reply_markup: streamKeyboard });
    } else {
      session.stream = null;
      session.step = 'AWAITING_FULL_NAME';
      return bot.editMessageText(`✅ ${grade}ኛ ክፍል ተመርጧል።\n\n👤 **ደረጃ 3/6፦** የተማሪውን **ሙሉ ስም** ያስገቡ፡`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
    }
  }

  if (data.startsWith('STREAM_')) {
    session.stream = data.replace('STREAM_', '');
    session.step = 'AWAITING_FULL_NAME';
    return bot.editMessageText(`✅ ዘርፍ፡ **${session.stream}** ተመርጧል።\n\n👤 **ደረጃ 3/6፦** የተማሪውን **ሙሉ ስም** ያስገቡ፡`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  }

  // SUMMARY EDIT BUTTON HANDLERS
  if (data === 'EDIT_FAIDA') {
    session.step = 'AWAITING_FAIDA_FIRST';
    return bot.editMessageText('🆔 አዲስ **ፋይዳ ቁጥር** ያስገቡ፡', { chat_id: chatId, message_id: msgId });
  }

  if (data === 'EDIT_NAME') {
    session.step = 'AWAITING_FULL_NAME';
    return bot.editMessageText('👤 አዲስ **የተማሪ ሙሉ ስም** ያስገቡ፡', { chat_id: chatId, message_id: msgId });
  }

  if (data === 'CONFIRM_GO_TO_PAYMENT') {
    session.step = 'AWAITING_PAYMENT_SCREENSHOT';
    const paymentText = `💳 **የክፍያ መረጃ (ደረጃ 6/6)**\n\n` +
      `እባክዎን የምዝገባ ክፍያ **500 ብር** በሚከተለው የባንክ ሂሳብ ገቢ ያድርጉ፡\n` +
      `🏦 **ኢትዮጵያ ንግድ ባንክ:** 1000XXXXXXXXX\n` +
      `👤 **ስም:** ንጉስ ሁለተኛ ደረጃ ትምህርት ቤት\n\n` +
      `📸 ክፍያውን ፈጽመው ደረሰኙን (ስክሪንሹት) ይላኩ።`;

    return bot.editMessageText(paymentText, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
  }
});

// REVIEW & EDIT SUMMARY SCREEN
function showSummaryAndReviewScreen(chatId) {
  const session = userSessions[chatId];
  session.step = 'REVIEW_SUMMARY';

  let summaryText = `📋 **የማመልከቻዎ ማጠቃለያ**\n\n` +
    `👤 **ስም:** ${session.full_name} ${session.father_name}\n` +
    `🆔 **ፋይዳ ቁጥር:** ${session.faida_number}\n` +
    `📚 **ክፍል:** ${session.grade}ኛ ${session.stream ? `(${session.stream})` : ''}\n` +
    `👩 **የእናት ስም:** ${session.mother_name}\n` +
    `📞 **ስልክ:** ${session.mother_phone}\n\n` +
    `እባክዎን መረጃዎቹ ትክክል መሆናቸውን ያረጋግጡ። ለማስተካከል የሚፈልጉት ካለ ከታች ያሉትን ቁልፎች ይጠቀሙ፦`;

  const reviewButtons = {
    inline_keyboard: [
      [{ text: '✏️ ፋይዳ ለማስተካከል', callback_data: 'EDIT_FAIDA' }],
      [{ text: '✏️ ስም ለማስተካከል', callback_data: 'EDIT_NAME' }],
      [{ text: '✅ መረጃው ትክክል ነው (ወደ ክፍያ እለፍ)', callback_data: 'CONFIRM_GO_TO_PAYMENT' }]
    ]
  };

  return bot.editMessageText(summaryText, {
    chat_id: chatId,
    message_id: session.mainMessageId,
    reply_markup: reviewButtons,
    parse_mode: 'Markdown'
  });
}

// -------------------------------------------------------------
// F. RESULT CHECKING LOGIC
// -------------------------------------------------------------
function handleViewResultStart(chatId) {
  userSessions[chatId] = { step: 'AWAITING_RESULT_FAIDA' };
  bot.sendMessage(chatId, '🔍 እባክዎን ለማረጋገጫ የ **ፋይዳ (Fayda FAN)** ቁጥርዎን ያስገቡ፡');
}

// HTTP Express Server for Server Hosting
const http = require('http');
http.createServer((req, res) => res.end('School Registration Bot Running!')).listen(process.env.PORT || 3000);

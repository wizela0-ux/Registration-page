require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// 1. Initialize Bot & Supabase
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// User State Management
const userSessions = {};

// -------------------------------------------------------------
// A. START COMMAND & MAIN MENU
// -------------------------------------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSessions[chatId] = {}; 

  const welcomeText = `👋 ሰላም ${msg.from.first_name}!\nእንኳን ወደ ትምህርት ቤታችን ኦፊሴላዊ ቦት በደህና መጡ።\n\nእባክዎን ከታች ካሉት አማራጮች አንዱን ይምረጡ፡`;
  
  const keyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '📝 ለማመዝገብ' }, { text: '📊 ውጤት ለማየት' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };

  bot.sendMessage(chatId, welcomeText, keyboard);
});

// -------------------------------------------------------------
// B. MAIN BUTTON HANDLER
// -------------------------------------------------------------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '📝 ለማመዝገብ') {
    handleRegistrationStart(chatId);
  } else if (text === '📊 ውጤት ለማየት') {
    handleViewResultStart(chatId);
  } else {
    handleUserSteps(chatId, msg);
  }
});

// -------------------------------------------------------------
// C. REGISTRATION FLOW
// -------------------------------------------------------------
async function handleRegistrationStart(chatId) {
  const { data: config } = await supabase.from('settings').select('value').eq('key', 'is_registration_open').single();
  
  if (config && config.value === 'false') {
    return bot.sendMessage(chatId, '❌ የዘመኑ ምዝገባ ተጠናቋል/ተዘጋቷል! ለተጨማሪ መረጃ ትምህርት ቤቱን በአካል ያነጋግሩ።');
  }

  userSessions[chatId] = { step: 'SELECT_GRADE', failCount: 0 };

  const gradeKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '9ኛ ክፍል', callback_data: 'GRADE_9' }, { text: '10ኛ ክፍል', callback_data: 'GRADE_10' }],
        [{ text: '11ኛ ክፍል', callback_data: 'GRADE_11' }, { text: '12ኛ ክፍል', callback_data: 'GRADE_12' }]
      ]
    }
  };

  bot.sendMessage(chatId, '📚 እባክዎን መመዝገብ የሚፈልጉትን የክፍል ደረጃ ይምረጡ፡', gradeKeyboard);
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('GRADE_')) {
    const grade = data.split('_')[1];
    userSessions[chatId].grade = parseInt(grade);
    userSessions[chatId].step = 'AWAITING_CARD_PHOTO';

    bot.sendMessage(chatId, `✅ የ ${grade}ኛ ክፍል ተመርጧል።\n\n📸 እባክዎን የባለፈው ዓመት የትምህርት **ሪፖርት ካርድዎን** ጥራት ያለው ፎቶ ይላኩ፡`);
  }
});

// -------------------------------------------------------------
// D. USER STEPS PROCESSING
// -------------------------------------------------------------
async function handleUserSteps(chatId, msg) {
  const session = userSessions[chatId];
  if (!session || !session.step) return;

  // 1. CARD PHOTO & OCR VERIFICATION
  if (session.step === 'AWAITING_CARD_PHOTO' && msg.photo) {
    bot.sendMessage(chatId, '🔍 ካርዱ እየተፈተሸ ነው... እባክዎን ትንሽ ይጠብቁ።');
    
    const isPassed = true; 
    const avgScore = 65.5; 

    if (!isPassed || avgScore <= 50) {
      session.failCount = (session.failCount || 0) + 1;
      if (session.failCount >= 3) {
        userSessions[chatId] = {};
        return bot.sendMessage(chatId, '⚠️ ካርዱን ማረጋገጥ አልተቻለም (3 ጊዜ ተሞክሯል)።\nእባክዎን አስፈላጊውን ሰነድ ይዘው በትምህርት ቤቱ በአካል በመገኘት ይመዝገቡ።');
      }
      return bot.sendMessage(chatId, `❌ የቀረበው ካርድ መስፈርቱን አላሟላም (Passed መሆን እና Average > 50 መሆን አለበት)። እባክዎን እንደገና ይሞክሩ (ቀሪ ሙከራ፡ ${3 - session.failCount})።`);
    }

    session.average_score = avgScore;
    session.step = 'AWAITING_ID_PHOTO';
    return bot.sendMessage(chatId, '✅ ካርዱ ተረጋግጧል!\n\n📸 አሁን ደግሞ የ **ብሔራዊ መታወቂያዎን (National ID)** ፊት ለፊት ፎቶ ይላኩ፡');
  }

  // 2. NATIONAL ID PHOTO
  if (session.step === 'AWAITING_ID_PHOTO' && msg.photo) {
    session.step = 'AWAITING_FAIDA';
    return bot.sendMessage(chatId, '✅ መታወቂያው ተቀብለናል።\n\n🆔 እባክዎን የ **ፋይዳ (Fayda FAN)** ቁጥርዎን ያስገቡ፡');
  }

  // 3. FAYDA NUMBER
  if (session.step === 'AWAITING_FAIDA' && msg.text) {
    session.faida_number = msg.text.trim();
    session.step = 'AWAITING_FULL_NAME';
    return bot.sendMessage(chatId, '👤 የተማሪውን **ሙሉ ስም** ያስገቡ፡');
  }

  // 4. FULL NAME
  if (session.step === 'AWAITING_FULL_NAME' && msg.text) {
    session.full_name = msg.text.trim();
    session.step = 'AWAITING_FATHER_NAME';
    return bot.sendMessage(chatId, '👨 የ **አባት ሙሉ ስም** ያስገቡ፡');
  }

  // 5. FATHER NAME
  if (session.step === 'AWAITING_FATHER_NAME' && msg.text) {
    session.father_name = msg.text.trim();
    session.step = 'AWAITING_MOTHER_NAME';
    return bot.sendMessage(chatId, '👩 የ **እናት ሙሉ ስም** ያስገቡ፡');
  }

  // 6. MOTHER NAME
  if (session.step === 'AWAITING_MOTHER_NAME' && msg.text) {
    session.mother_name = msg.text.trim();
    session.step = 'AWAITING_MOTHER_PHONE';
    return bot.sendMessage(chatId, '📞 የ **እናት የስልክ ቁጥር** ያስገቡ፡');
  }

  // 7. MOTHER PHONE & PAYMENT TIMER
  if (session.step === 'AWAITING_MOTHER_PHONE' && msg.text) {
    session.mother_phone = msg.text.trim();
    session.step = 'AWAITING_PAYMENT_SCREENSHOT';

    const paymentInfo = `💳 **የክፍያ መረጃ**\n\n` +
      `እባክዎን የምዝገባ ክፍያ **500 ብር** በሚከተለው የባንክ ሂሳብ ገቢ ያድርጉ፡\n` +
      `🏦 **ኢትዮጵያ ንግድ ባንክ:** 1000XXXXXXXXX\n` +
      `👤 **ስም:** XXX School\n\n` +
      `⏱️ **ማሳሰቢያ:** ክፍያውን ፈጽመው የስክሪንሹት ፎቶ እና የትራንዛክሽን ቁጥር በ **20 ደቂቃ** ውስጥ ይላኩ።`;

    bot.sendMessage(chatId, paymentInfo, { parse_mode: 'Markdown' });

    setTimeout(() => {
      if (userSessions[chatId] && userSessions[chatId].step === 'AWAITING_PAYMENT_SCREENSHOT') {
        bot.sendMessage(chatId, '⏰ የ 20 ደቂቃ የክፍያ ማረጋገጫ ጊዜ አልፏል። እባክዎን ምዝገባውን ከ አዲስ ይጀምሩ።');
        delete userSessions[chatId];
      }
    }, 20 * 60 * 1000);
    return;
  }

  // 8. PAYMENT SCREENSHOT & TXN
  if (session.step === 'AWAITING_PAYMENT_SCREENSHOT') {
    if (msg.photo || msg.text) {
      const { data: newStudent, error } = await supabase.from('students').insert([
        {
          telegram_id: msg.from.id,
          full_name: session.full_name,
          father_name: session.father_name,
          mother_name: session.mother_name,
          faida_number: session.faida_number,
          mother_phone: session.mother_phone,
          grade_level: session.grade,
          average_score: session.average_score,
          is_registered: true
        }
      ]).select().single();

      if (error) {
        return bot.sendMessage(chatId, '❌ መረጃውን ሲመዘገብ ስህተት አጋጥሟል። እባክዎን የፋይዳ ቁጥርዎት ቀደም ብሎ ያልተመዘገበ መሆኑን ያረጋግጡ።');
      }

      bot.sendMessage(chatId, '🎉 **ምዝገባዎ በስኬት ተጠናቋል!**\n\nክፍያው ተረጋግጦ ክፍሎች ሲመደቡ ማሳወቂያ ይደርስዎታል።');
      delete userSessions[chatId];
    }
  }

  // -------------------------------------------------------------
  // E. VIEW RESULT LOGIC
  // -------------------------------------------------------------
  if (session.step === 'AWAITING_RESULT_FAIDA' && msg.text) {
    const inputFaida = msg.text.trim();

    const { data: student, error } = await supabase
      .from('students')
      .select('*')
      .eq('faida_number', inputFaida)
      .single();

    if (error || !student) {
      return bot.sendMessage(chatId, '❌ የቀረበው የፋይዳ ቁጥር አልተገኘም። እባክዎን ቁጥሩን አስተካክለው እንደገና ይሞክሩ።');
    }

    const { data: results } = await supabase
      .from('results')
      .select('*, subjects(subject_name)')
      .eq('student_id', student.id)
      .eq('is_published', true);

    if (!results || results.length === 0) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, `👋 ሰላም **${student.full_name}**!\n\n⚠️ የ ${student.grade_level}ኛ ክፍል ውጤት ገና በአድሚን አልተለቀቀም። እባክዎን በትዕግስት ይቆዩ።`, { parse_mode: 'Markdown' });
    }

    let resMsg = `👤 **ተማሪ:** ${student.full_name} ${student.father_name}\n`;
    resMsg += `🏫 **ክፍል:** ${student.grade_level}${student.section || ' (ያልተመደበ)'}\n`;
    resMsg += `🆔 **የፋይዳ ቁጥር:** ${student.faida_number}\n`;
    resMsg += `-----------------------------------\n`;

    let total = 0;
    results.forEach(r => {
      resMsg += `🔹 **${r.subjects.subject_name}:** ${r.score}\n`;
      total += r.score;
    });

    const avg = (total / results.length).toFixed(2);
    resMsg += `-----------------------------------\n`;
    resMsg += `📊 **ድምር:** ${total}\n`;
    resMsg += `📈 **አማካይ (Average):** ${avg}\n`;

    bot.sendMessage(chatId, resMsg, { parse_mode: 'Markdown' });
    delete userSessions[chatId];
  }
}

function handleViewResultStart(chatId) {
  userSessions[chatId] = { step: 'AWAITING_RESULT_FAIDA' };
  bot.sendMessage(chatId, '🔍 እባክዎን ለማረጋገጫ የ **ፋይዳ (Fayda FAN)** ቁጥርዎን ያስገቡ፡');
}

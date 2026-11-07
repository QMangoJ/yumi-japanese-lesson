/* YUMI front-end i18n dictionaries (en source / zh / fr).
 *
 * Keys are the CURRENT source strings as rendered in English mode
 * (a few legacy strings are mixed Chinese+English — those have an
 * explicit `en` entry that normalises them to English only).
 * The engine lives in app.js: it walks visible text nodes and
 * swaps each node's text for the active language's value, so at
 * any moment the page shows exactly ONE language. Review bodies
 * (real Preply reviews) are deliberately NOT in these dictionaries
 * — they stay in their original English. Data (names, emails,
 * dates, prices) is never translated either.
 */
"use strict";

window.YUMI_I18N = {
  /* English normalisations for legacy mixed-language strings. */
  en: {
    "10 节课 · 10 lessons": "10 lessons",
    "20 节课 · 20 lessons": "20 lessons",
    "6 节课 · 6 lessons": "6 lessons",
    "一周1节 · 1× / week": "1× / week",
    "一周2节 · 2× / week": "2× / week",
    "一周3节 · 3× / week": "3× / week",
    "先选好每周固定的上课时间，一次买下一整包课时， 系统会自动把每一节课都排好。推荐每周固定 1–3 节，节奏稳定效果好。":
      "Pick fixed weekly times and buy the whole package at once — every lesson is scheduled for you automatically. A steady rhythm of 1–3 lessons a week works best.",
    "先选星期…": "Pick a weekday…",
    "单次预约 · Single lesson": "Single lesson",
    "固定时间 1 · Weekly slot 1": "Weekly slot 1",
    "开始时间 (JST) · Start time": "Start time (JST)",
    "星期 · Weekday": "Weekday",
    "每周几节 · Lessons per week": "Lessons per week",
    "申请退款": "Request a refund",
    "请选择每周固定的上课时间": "Please choose your fixed weekly lesson times",
    "课时包 · Lesson package": "Lesson package",
    "课时包 · 每周固定时间": "Lesson package · fixed weekly times",
    "选择课时包 · Package size": "Package size",
    "课时包 · 每周固定时间 · 6 节课": "Lesson package · fixed weekly times · 6 lessons",
  },

  zh: {
    /* header / nav */
    "Reviews": "评价",
    "About": "关于我",
    "Lessons": "课程",
    "Price": "价格",
    "FAQ": "常见问题",
    "Contact": "联系我",
    "Login": "登录",
    "Account": "我的账户",
    "Admin": "后台",
    "Book a Lesson": "预约课程",
    "Book a lesson": "预约课程",
    "Japanese Lessons": "日语课程",
    /* hero */
    "ONLINE JAPANESE LESSONS · ENGLISH SUPPORT AVAILABLE": "在线日语课程 · 提供英语辅助",
    "Hi there! I'm": "你好！我是",
    ", a certified Japanese teacher living in Tokyo, originally from Aomori in Japan's Tohoku region. People say I'm bright and friendly — and I love traveling abroad.":
      "，一位住在东京的持证日语老师，老家在日本东北地区的青森。大家都说我开朗又亲切——我也很喜欢出国旅行。",
    "Certified Japanese tutor · Tokyo, Japan": "持证日语老师 · 日本东京",
    "Japanese that feels like chatting with a friend.": "像和朋友聊天一样学日语。",
    "Book your first lesson and let's talk about your goals.": "预约你的第一节课，聊聊你的学习目标吧。",
    "See lesson menu": "查看课程菜单",
    "★ 5.0 · 414 lessons taught": "★ 5.0 · 已教授 414 节课",
    "lessons per student, on average": "平均每位学生的课时数",
    "student rating": "学生评分",
    "teaching experience": "教学经验",
    "13 yrs": "13 年",
    "(13 years teaching English)": "（13 年英语教学经验）",
    /* upcoming-lessons calendar (task 1) */
    "No lessons this day.": "这一天没有课程。",
    "Beginners": "入门",
    "Conversation": "会话",
    "JLPT": "JLPT",
    "Travel": "旅行",
    "Business": "商务",
    "Lesson": "课程",
    "Trial": "体验课",
    "Previous month": "上个月",
    "Next month": "下个月",
    "· Native": "· 母语",
    "· C1 — fluent support": "· C1 — 可流利辅助",
    "Japanese (native) · English (C1) · Spanish · Khmer · French": "日语（母语）· 英语（C1）· 西班牙语 · 高棉语 · 法语",
    /* sections */
    "01 — STUDENT VOICES": "01 — 学生评价",
    "02 — ABOUT ME": "02 — 关于我",
    "03 — LESSONS": "03 — 课程",
    "04 — PRICE": "04 — 价格",
    "05 — BOOK A LESSON": "05 — 预约课程",
    "06 — MY BOOKINGS": "06 — 我的预约",
    "07 — FAQ": "07 — 常见问题",
    "08 — CONTACT": "08 — 联系我",
    "What Students Say": "学生们怎么说",
    "16 reviews · 414 lessons taught": "16 条评价 · 已教授 414 节课",
    "All 16 reviews are 5 stars. Category scores are based on 32 anonymous lesson ratings. Reviews from Yumi's students on Preply.":
      "16 条评价全部是五星。分项评分基于 32 份匿名课程评分。评价来自 Yumi 在 Preply 的学生。",
    "Clarity": "讲解清晰",
    "Progress": "进步效果",
    "Preparation": "备课充分",
    "Reassurance": "耐心安心",
    /* about */
    "Hi, I'm Yumi! 🌸": "你好，我是 Yumi！🌸",
    "Languages": "语言",
    "Based in": "所在地",
    "Tokyo, Japan": "日本东京",
    "Tokyo, Japan (from Aomori)": "日本东京（来自青森）",
    "Experience": "经历",
    "13 years teaching English · 10+ years at international trade shows · Japanese logistics company":
      "13 年英语教学 · 10 多年国际展会经验 · 日本物流公司经历",
    "Education": "教育背景",
    "Kanda University of International Studies — International Communication": "神田外语大学 — 国际交流专业",
    "Ask me about": "可以向我了解",
    "Tohoku festivals, Japanese culture & ways of thinking, making friends in Tokyo": "东北地区的节日、日本文化与思维方式、在东京交朋友",
    "I know how hard learning a language can be, because I struggled with English myself at first. That experience became my strength:":
      "我深知学一门语言有多难，因为我自己一开始学英语时也很吃力。这段经历反而成了我的优势：",
    "taught me how to support learners who are starting a foreign language for the very first time.":
      "让我懂得如何帮助第一次学外语的学习者。",
    "I've lived in a homestay in the U.S. and studied abroad in Australia for a year, and backpacked around Southeast Asia as a student. In Cambodia, when everything I had was stolen, travelers and locals helped me — and I've wanted to give back to people traveling to Japan ever since.":
      "我曾在美国寄宿家庭生活过，在澳大利亚留学一年，学生时代还背包走遍东南亚。在柬埔寨时，我随身的东西被偷光，是当地人和旅友帮了我——从那以后，我就一直想回报来日本旅行的人。",
    "My lessons are fun and relaxed, like hanging out with a friend. Tell me your goals and interests, and we'll find your path together.":
      "我的课轻松又有趣，就像和朋友相聚。告诉我你的目标和兴趣，我们一起找到适合你的学习路径。",
    /* lessons / courses */
    "CONVERSATION": "会话",
    "BEGINNERS": "零基础",
    "BUSINESS": "商务",
    "TRAVEL": "旅行",
    "CUSTOM": "定制",
    "Conversational Japanese": "日语会话",
    "Japanese for Complete Beginners": "完全零基础日语",
    "JLPT N5–N4 Preparation": "JLPT N5–N4 备考",
    "Japanese for Travel": "旅行日语",
    "Business Japanese": "商务日语",
    "Other": "其他",
    "Natural, real-life Japanese in a fun, relaxed way. Learn the everyday expressions Japanese people actually use — including casual phrases you won't usually find in textbooks — and build the confidence to speak.":
      "在轻松有趣的氛围里学自然、地道的生活日语。学习日本人日常真正使用的表达——包括课本上通常学不到的口语说法——建立开口的自信。",
    "For: learners who want to chat with Japanese friends or enjoy natural conversation on a trip.":
      "适合：想和日本朋友聊天、或旅行时自然交流的学习者。",
    "Start from hiragana and katakana and build a strong foundation in grammar and vocabulary with the GENKI textbook. English support is always available, so starting from zero is completely fine.":
      "从平假名和片假名开始，用《GENKI》教材扎实打好语法和词汇基础。全程提供英语辅助，从零开始完全没问题。",
    "For: first-time learners who want a friendly, supportive start.": "适合：希望在友好耐心的氛围中起步的初学者。",
    "Focused lessons for the JLPT: grammar, vocabulary, reading, and listening, with careful review of your weak points so you can walk into the exam with confidence.":
      "专注 JLPT 的课程：语法、词汇、阅读与听力，仔细梳理你的薄弱环节，让你自信走进考场。",
    "For: N5–N4 learners preparing for the test.": "适合：备考 N5–N4 的学习者。",
    "Practical phrases and conversations for your trip — restaurants, shopping, hotels, transportation, and more — customized to your own travel plans.":
      "为你的旅行准备实用短语和对话——餐厅、购物、酒店、交通等等——按你自己的行程定制。",
    "For: anyone planning a trip to Japan, beginners included.": "适合：计划去日本旅行的任何人，包括初学者。",
    "Practical Japanese for professional environments, including workplace communication and interview preparation — informed by 10+ years at international trade shows and experience in a Japanese logistics company.":
      "面向职场环境的日语，包括职场沟通和面试准备——源自 10 多年国际展会经验和日本物流公司的工作经历。",
    "For: people working in Japan or interviewing with Japanese companies.": "适合：在日本工作或准备日企面试的人。",
    "Something else in mind? Book an \"Other\" lesson and tell Yumi in the booking notes what you would like to work on — reading together, homework help, pronunciation, or anything else.":
      "有其他想法？预订「其他」课程，在预约备注里告诉 Yumi 你想练什么——一起朗读、作业辅导、发音，或任何内容。",
    "For: any goal that doesn't fit the courses above.": "适合：以上课程覆盖不到的任何目标。",
    "Book this course →": "预订这门课 →",
    /* why */
    "WHY CHOOSE ME": "为什么选择我",
    "3 Reasons Students Choose Me": "学生选择我的 3 个理由",
    "Conversation First": "会话优先",
    "My lessons are conversation-focused: natural expressions friends use with each other — the real-life Japanese you won't find in textbooks — practiced out loud from day one.":
      "我的课以会话为核心：朋友之间自然使用的表达——课本上找不到的生活日语——从第一天起就开口练习。",
    "Beginner-Friendly, From Zero": "亲近初学者，从零开始",
    "Starting from hiragana is more than welcome. Lessons follow the GENKI textbook with full English support, so you can ask anything, as many times as you need — no stress, no judgment.":
      "非常欢迎从平假名开始学。课程使用《GENKI》教材，全程英语辅助，任何问题都可以问、问多少次都行——没压力，不评判。",
    "100% Tailored to Your Goal": "100% 按你的目标定制",
    "Travel, daily life, JLPT N5–N4, or business and job interviews in Japan — every lesson plan is built around your goal, your pace, and your schedule.":
      "无论是旅行、日常生活、JLPT N5–N4，还是在日本的商务与求职面试——每一份学习计划都围绕你的目标、你的节奏和你的时间来设计。",
    /* price */
    "LESSON RATES": "课程价格",
    "Lesson duration": "课程时长",
    "Price (USD)": "价格（美元）",
    "Per lesson": "每节课",
    "30 min": "30 分钟",
    "50 min": "50 分钟",
    "80 min": "80 分钟",
    "120 min": "120 分钟",
    "$15 per lesson": "每节课 $15",
    "$25 per lesson": "每节课 $25",
    "$40 per lesson": "每节课 $40",
    "$60 per lesson": "每节课 $60",
    "Lesson packages": "课时包",
    "6 lessons": "6 节课",
    "10 lessons": "10 节课",
    "20 lessons": "20 节课",
    "Buy": "购买",
    "Book": "预订",
    "* All lessons are held online via Google Meet.": "* 所有课程均通过 Google Meet 在线上课。",
    "per lesson: $15 (30 min) · $25 (50 min) · $40 (80 min) · $60 (120 min)":
      "每节课：$15（30 分钟）· $25（50 分钟）· $40（80 分钟）· $60（120 分钟）",
    "Every course is available at every duration — just pick": "每门课程都可以选任意时长——直接选",
    "See packages in the booking window →": "在预约窗口查看课时包 →",
    /* book section */
    "Book your lesson": "预约你的课程",
    "Choose a course and a lesson at least 72 hours in advance. Times are shown in your timezone.":
      "提前至少 72 小时选择课程和课程时间。时间按你的时区显示。",
    "Closed Saturdays & Sundays. Calendar days are Japan dates; times are shown in your timezone.":
      "周六、周日休息。日历日期为日本日期；时间按你的时区显示。",
    /* modal / picker */
    "Book a lesson →": "预约课程 →",
    "STEP 1": "第 1 步",
    "STEP 2": "第 2 步",
    "STEP 3": "第 3 步",
    "STEP 4": "第 4 步",
    "01 · Choose a date": "01 · 选择日期",
    "02 · Choose a start time": "02 · 选择开始时间",
    "Available times": "可选时间",
    "Choose a date first": "请先选择日期",
    "Checking availability…": "正在查询空位…",
    "Closed on this day": "这天休息",
    "Not available on this date — please pick another day.": "这天不可预约——请选择其他日期。",
    "No times available": "没有可选时间",
    "No times are available on this date.": "这天没有可选时间。",
    "Could not load times": "时间加载失败",
    "Course": "课程",
    "Course — pick one above": "课程 — 请在上方选择",
    "Duration": "时长",
    "30, 50, 80 or 120 minutes": "30、50、80 或 120 分钟",
    "Your Details": "你的信息",
    "Your details": "你的信息",
    "Your name": "你的姓名",
    "Email (for confirmation & managing your booking)": "邮箱（用于确认和管理预约）",
    "Anything you'd like me to know? (goals, level, topics — optional)": "有什么想让我知道的吗？（目标、水平、话题——选填）",
    "Review & pay →": "确认并付款 →",
    "Continue →": "继续 →",
    "← Back": "← 返回",
    "Review & payment": "确认与付款",
    "Payment": "付款",
    "Card number": "卡号",
    "Expiry": "有效期",
    "CVC": "安全码",
    "Pay now": "立即付款",
    "TEST MODE — this checkout is a demo. No real payment is taken; use any card details to try the flow.":
      "测试模式——这是演示结账，不会真实扣款；随便填卡号即可体验流程。",
    "Sign in to pay": "登录后付款",
    "One quick step before payment: sign in with Google, so this booking is saved to":
      "付款前还差一步：用 Google 登录，这样这节课会保存到",
    "account. The booking will use your Google email — that's what lets you (and only you) reschedule or cancel it later.":
      "账户里。预约将使用你的 Google 邮箱——这样只有你本人能改期或取消。",
    "Everything you've picked and typed is saved on this device — after signing in, you'll come straight back to this booking, right at the payment step.":
      "你选的和填写的内容都保存在这台设备上——登录后会直接回到这笔预约的付款步。",
    "Continue with Google": "使用 Google 继续",
    "Google account": "Google 账户",
    "🎉 You're booked!": "🎉 预约成功！",
    "Done": "完成",
    "Lessons are held online — your meeting link is in the table above, or your teacher will send it before the lesson. A confirmation has been sent to your email.":
      "课程在线进行——会议链接在上表中，或者老师会在课前发给你。确认邮件已发送到你的邮箱。",
    /* summary / my bookings */
    "Date": "日期",
    "Time": "时间",
    "Name": "姓名",
    "Email": "邮箱",
    "Total": "总计",
    "Online meeting": "在线会议",
    "The meeting link will appear here once payment is complete.": "付款完成后，会议链接会显示在这里。",
    "Cancelled": "已取消",
    "Upcoming lessons": "即将上课",
    "Lesson history": "历史课程",
    "Past activity": "历史记录",
    "No past bookings yet.": "暂无历史预约。",
    "You have no upcoming lessons.": "你暂无即将开始的课程。",
    "Cancel this booking": "取消这节课",
    "Request a refund": "申请退款",
    "Reschedule": "改期",
    "Confirm new time": "确认新时间",
    "Manage your lessons and packages here. Times are shown in your timezone, with Japan time (JST) shown alongside.":
      "在这里管理你的课程和课时包。时间按你的时区显示，并附日本时间（JST）。",
    "Go to My Account": "前往我的账户",
    "Go to My Bookings": "前往我的预约",
    "My Bookings": "我的预约",
    "Your lessons, all in one place.": "你的课程，都在这里。",
    /* account */
    "MY ACCOUNT": "我的账户",
    "My Account": "我的账户",
    "Sign out": "退出登录",
    "Package lessons left": "课时包剩余节数",
    "remaining in your active packages": "你生效中课时包的剩余节数",
    "bookings still ahead of you": "你接下来的预约数",
    "Member email": "账户邮箱",
    "Learning profile": "学习档案",
    "Tell Yumi where you are and where you'd like to go — she plans your lessons around it. This is shared with Yumi only.":
      "告诉 Yumi 你现在的水平和想达到的目标——她会据此安排课程。这些内容只会分享给 Yumi。",
    "Japanese level": "日语水平",
    "Complete beginner": "完全零基础",
    "Not sure": "不确定",
    "Learning goals": "学习目标",
    "Save profile": "保存档案",
    "Sign in with Google to see your upcoming lessons, your lesson packages and your learning profile — and to reschedule or cancel an upcoming lesson. Booked as a guest before? Sign in with the same email and your bookings appear here automatically.":
      "用 Google 登录，查看你即将开始的课程、课时包和学习档案——还可以改期或取消课程。以前用游客身份订过课？用同一个邮箱登录，预约会自动出现在这里。",
    "Sign in with Google to see your upcoming lessons and your lesson history — and to reschedule or cancel an upcoming lesson. Booked as a guest? Sign in with the same email and your bookings will appear here automatically.":
      "用 Google 登录，查看你即将开始的课程和历史课程——还可以改期或取消课程。用游客身份订过课？用同一个邮箱登录，预约会自动出现在这里。",
    "New here? Sign in with Google to create your account. Booked as a guest before? Sign in with the same email and your bookings appear here automatically.":
      "第一次来？用 Google 登录即可创建账户。以前用游客身份订过课？用同一个邮箱登录，预约会自动出现在这里。",
    /* packages (front) */
    "Lesson package": "课时包",
    "Single lesson": "单次预约",
    "Package size": "选择课时包",
    "Lessons per week": "每周几节",
    "Weekday": "星期",
    "Start time (JST)": "开始时间 (JST)",
    "Weekly slot 1": "固定时间 1",
    "1× / week": "每周 1 节",
    "2× / week": "每周 2 节",
    "3× / week": "每周 3 节",
    "Pick a weekday…": "先选星期…",
    "Please choose your fixed weekly lesson times": "请选择每周固定的上课时间",
    "Lesson package · fixed weekly times": "课时包 · 每周固定时间",
    "Pick fixed weekly times and buy the whole package at once — every lesson is scheduled for you automatically. A steady rhythm of 1–3 lessons a week works best.":
      "先选好每周固定的上课时间，一次买下一整包课时，系统会自动把每一节课都排好。推荐每周固定 1–3 节，节奏稳定效果好。",
    "You don't have a lesson package yet. A package books the same time every week — steady rhythm, steady progress.":
      "你还没有课时包。课时包每周固定同一时间上课——节奏稳定，进步稳定。",
    "Package": "课时包",
    "Purchase": "购买",
    /* FAQ */
    "Is it okay if I am a complete beginner?": "我是完全的零基础，可以吗？",
    "Absolutely! Everyone is more than welcome. Let's start with a relaxed feeling, just like catching up with a friend — we'll begin with hiragana and katakana and build up with the GENKI textbook.":
      "当然可以！非常欢迎。让我们像和朋友聊天一样轻松开始——从平假名和片假名学起，用《GENKI》教材一步步打基础。",
    "Am I allowed to ask questions in English?": "可以用英语提问吗？",
    "Yes, definitely! I will use English to support you and make sure you gain a crystal-clear, deep understanding of the language.":
      "完全可以！我会用英语辅助你，确保你对所学内容理解得清清楚楚、扎扎实实。",
    "Can I learn specific phrases or Japanese from my favorite anime?": "可以学特定短语或我喜欢的动漫里的日语吗？",
    "Yes! I will fully customize the material so you can learn the exact, real-life Japanese you want to use right now.":
      "可以！我会完全按你的需求定制教材，让你学到的正是你现在就想用的、地道的生活日语。",
    "How do we schedule our lesson times?": "课程时间怎么安排？",
    "Book any open slot on this page at least 72 hours in advance. Students using lesson packages can freely book and adjust their lesson duration from 30 minutes up to 2 hours to fit their weekly schedule — just mention it in the booking notes.":
      "在本页提前至少 72 小时预订任意空位即可。使用课时包的学生可以自由预订、并把课时时长调整为 30 分钟到 2 小时，以配合每周的日程——在预约备注里说明即可。",
    "What tool do you use for lessons? Do I need to prepare anything in advance?": "上课用什么工具？需要提前准备什么吗？",
    "Lessons are held online (Zoom / Google Meet). You do not need to install a special app — simply click the link in your booking confirmation to join from your browser. If no link is shown, your teacher will send it before the lesson.":
      "课程在线进行（Zoom / Google Meet）。不需要安装专门的应用——点击预约确认中的链接就能在浏览器里加入。如果没显示链接，老师会在课前发给你。",
    "Do I need to bring or prepare anything before my lesson?": "上课前需要带什么或准备什么吗？",
    "No special textbook or materials are required. If you have topics you would like to discuss or Japanese phrases you have wondered about in daily life or while traveling, making a quick note beforehand will help us get started smoothly.":
      "不需要特别的教材或材料。如果你有想聊的话题，或者日常生活中、旅行时好奇过的日语句子，提前简单记下来，我们就能更顺畅地开始。",
    "When can I cancel or reschedule a lesson?": "什么时候可以取消或改期？",
    "You can cancel a confirmed lesson from": "你可以从",
    "You can reschedule or cancel anytime in": "你可以随时在",
    "at any time before it starts. Cancel 12 hours or more before the lesson starts and you get a full refund — the amount paid goes back to your original payment method, no matter whether you rescheduled the lesson before. Cancellations within 12 hours of the start are not refunded, and the lesson counts as used. Rescheduling is possible up to 24 hours before the lesson starts, at most twice per booking. New bookings and new rescheduled times must be selected at least 72 hours in advance.":
      "在课程开始前的任意时间取消已确认的课程。开课前 12 小时以上取消可全额退款——款项退回原付款方式，无论之前是否改过期。开课前 12 小时内取消不退款，该节课计为已使用。改期可在开课前 24 小时以上进行，每笔预约最多 2 次。新预约和新的改期时间都必须至少提前 72 小时选定。",
    "What payment methods do you accept?": "可以用哪些付款方式？",
    "Payments are processed securely through Stripe. Major credit and debit cards are accepted (Visa, Mastercard, American Express).":
      "付款通过 Stripe 安全处理。接受主要信用卡和借记卡（Visa、Mastercard、American Express）。",
    "Payments are processed securely through Stripe. You can use major credit or debit cards available at checkout, including Visa, Mastercard, and American Express.":
      "付款通过 Stripe 安全处理。结账时可使用主要信用卡或借记卡，包括 Visa、Mastercard 和 American Express。",
    /* contact / footer / misc */
    "Questions about lessons, levels, or scheduling? No question is too small — I'd love to hear from you.":
      "对课程、水平或时间安排有疑问？问题再小也欢迎——期待你的来信。",
    "Your name": "你的姓名",
    "Message": "留言",
    "Send Message →": "发送留言 →",
    "Thank you! Your message has been noted — Yumi will get back to you soon. 🌸": "谢谢！你的留言已记录——Yumi 会尽快回复你。🌸",
    "EMAIL": "邮箱",
    "INSTAGRAM": "INSTAGRAM",
    "Ready to say “I can speak Japanese!”?": "准备好说出「我会说日语了！」吗？",
    "Fully tailor-made lessons where you can freely adjust your learning schedule around your life. Book and pay right here on this site.":
      "完全定制的课程，可按你的生活自由调整学习安排。就在本站预订和付款。",
    "Lessons are held online. Booking and payment are handled securely on this site.": "课程在线进行。预订和付款都在本站安全完成。",
    "New bookings are taken at least 72 hours in advance. I'm available Monday to Friday, 8:00–22:00 JST. Times are shown in your own timezone":
      "新预约需至少提前 72 小时。我的可约时间是周一至周五 8:00–22:00（JST）。预订时时间按你自己的时区显示",
    "when you book. New bookings are taken at least 72 hours in advance. Package totals are the per-lesson price × the number of lessons — no hidden fees.":
      "。新预约需至少提前 72 小时。课时包总价 = 单节课价格 × 节数——没有隐藏费用。",
    "Choose your lesson time.": "选择你的上课时间。",
    "Booking opens in a pop-up right on this page: pick your course, date and time, and pay securely here — no account needed. Lessons are held online (Zoom / Google Meet), and your meeting link arrives with your confirmation.":
      "预订就在本页弹窗里完成：选课程、日期和时间，在这里安全付款——不需要账户。课程在线进行（Zoom / Google Meet），会议链接会随确认信息一起发给你。",
    "Perfect for beginners — and for travelers who want real conversation. Learn the Japanese native speakers actually use, at your own pace, with a patient teacher who has been exactly where you are.":
      "非常适合初学者——也适合想要真实会话练习的旅行者。按你自己的节奏，学母语者真正使用的日语，老师耐心、而且走过你正在走的路。",
    "SUN": "日", "MON": "一", "TUE": "二", "WED": "三", "THU": "四", "FRI": "五", "SAT": "六",
    "Selected: choose a date and a time": "已选：请选择日期和时间",
    "— this booking is saved to the Google account you signed in with, so it's right there when you come back. Cancelling and rescheduling follow the policy in the FAQ.":
      "——这笔预约保存在你登录的 Google 账户里，回来就能看到。取消和改期按常见问题里的规则执行。",
  },

  fr: {
    "Reviews": "Avis",
    "About": "À propos",
    "Lessons": "Cours",
    "Price": "Tarifs",
    "FAQ": "FAQ",
    "Contact": "Contact",
    "Login": "Se connecter",
    "Account": "Mon compte",
    "Admin": "Admin",
    "Book a Lesson": "Réserver un cours",
    "Book a lesson": "Réserver un cours",
    "Japanese Lessons": "Cours de japonais",
    "ONLINE JAPANESE LESSONS · ENGLISH SUPPORT AVAILABLE": "COURS DE JAPONAIS EN LIGNE · AIDE EN ANGLAIS DISPONIBLE",
    "Hi there! I'm": "Bonjour ! Je suis",
    ", a certified Japanese teacher living in Tokyo, originally from Aomori in Japan's Tohoku region. People say I'm bright and friendly — and I love traveling abroad.":
      ", professeure de japonais certifiée vivant à Tokyo, originaire d'Aomori, dans la région du Tohoku. On me dit joyeuse et chaleureuse — et j'adore voyager à l'étranger.",
    "Certified Japanese tutor · Tokyo, Japan": "Professeure de japonais certifiée · Tokyo, Japon",
    "Japanese that feels like chatting with a friend.": "Un japonais qui ressemble à une conversation entre amis.",
    "Book your first lesson and let's talk about your goals.": "Réservez votre premier cours et parlons de vos objectifs.",
    "See lesson menu": "Voir les cours",
    "★ 5.0 · 414 lessons taught": "★ 5.0 · 414 cours donnés",
    "lessons per student, on average": "cours par élève, en moyenne",
    "student rating": "note des élèves",
    "teaching experience": "d'expérience d'enseignement",
    "13 yrs": "13 ans",
    "(13 years teaching English)": "(13 ans d'enseignement de l'anglais)",
    /* upcoming-lessons calendar (task 1) */
    "No lessons this day.": "Aucun cours ce jour-là.",
    "Beginners": "Débutants",
    "Conversation": "Conversation",
    "JLPT": "JLPT",
    "Travel": "Voyage",
    "Business": "Affaires",
    "Lesson": "Cours",
    "Trial": "Essai",
    "Previous month": "Mois précédent",
    "Next month": "Mois suivant",
    "· Native": "· Langue maternelle",
    "· C1 — fluent support": "· C1 — aide fluide",
    "Japanese (native) · English (C1) · Spanish · Khmer · French": "Japonais (langue maternelle) · Anglais (C1) · Espagnol · Khmer · Français",
    "01 — STUDENT VOICES": "01 — AVIS DES ÉLÈVES",
    "02 — ABOUT ME": "02 — À PROPOS",
    "03 — LESSONS": "03 — COURS",
    "04 — PRICE": "04 — TARIFS",
    "05 — BOOK A LESSON": "05 — RÉSERVER UN COURS",
    "06 — MY BOOKINGS": "06 — MES RÉSERVATIONS",
    "07 — FAQ": "07 — FAQ",
    "08 — CONTACT": "08 — CONTACT",
    "What Students Say": "Ce que disent les élèves",
    "16 reviews · 414 lessons taught": "16 avis · 414 cours donnés",
    "All 16 reviews are 5 stars. Category scores are based on 32 anonymous lesson ratings. Reviews from Yumi's students on Preply.":
      "Les 16 avis sont tous de 5 étoiles. Les notes par catégorie reposent sur 32 évaluations de cours anonymes. Avis des élèves de Yumi sur Preply.",
    "Clarity": "Clarté",
    "Progress": "Progrès",
    "Preparation": "Préparation",
    "Reassurance": "Bienveillance",
    "Hi, I'm Yumi! 🌸": "Bonjour, je suis Yumi ! 🌸",
    "Languages": "Langues",
    "Based in": "Basée à",
    "Tokyo, Japan": "Tokyo, Japon",
    "Tokyo, Japan (from Aomori)": "Tokyo, Japon (originaire d'Aomori)",
    "Experience": "Expérience",
    "13 years teaching English · 10+ years at international trade shows · Japanese logistics company":
      "13 ans d'enseignement de l'anglais · plus de 10 ans dans des salons internationaux · entreprise japonaise de logistique",
    "Education": "Formation",
    "Kanda University of International Studies — International Communication": "Université Kanda d'études internationales — Communication internationale",
    "Ask me about": "Demandez-moi",
    "Tohoku festivals, Japanese culture & ways of thinking, making friends in Tokyo": "Les festivals du Tohoku, la culture et l'esprit japonais, se faire des amis à Tokyo",
    "I know how hard learning a language can be, because I struggled with English myself at first. That experience became my strength:":
      "Je sais à quel point apprendre une langue peut être difficile : j'ai moi-même peiné avec l'anglais au début. Cette expérience est devenue ma force :",
    "taught me how to support learners who are starting a foreign language for the very first time.":
      "m'a appris à accompagner les personnes qui découvrent une langue étrangère pour la toute première fois.",
    "I've lived in a homestay in the U.S. and studied abroad in Australia for a year, and backpacked around Southeast Asia as a student. In Cambodia, when everything I had was stolen, travelers and locals helped me — and I've wanted to give back to people traveling to Japan ever since.":
      "J'ai vécu en famille d'accueil aux États-Unis, étudié un an en Australie et voyagé sac au dos en Asie du Sud-Est pendant mes études. Au Cambodge, quand on m'a tout volé, des voyageurs et des habitants m'ont aidée — depuis, j'ai envie de rendre la pareille aux personnes qui voyagent au Japon.",
    "My lessons are fun and relaxed, like hanging out with a friend. Tell me your goals and interests, and we'll find your path together.":
      "Mes cours sont joyeux et détendus, comme un moment entre amis. Dites-moi vos objectifs et vos centres d'intérêt, et nous trouverons ensemble votre chemin.",
    "CONVERSATION": "CONVERSATION",
    "BEGINNERS": "DÉBUTANTS",
    "BUSINESS": "AFFAIRES",
    "TRAVEL": "VOYAGE",
    "CUSTOM": "SUR MESURE",
    "Conversational Japanese": "Japonais conversationnel",
    "Japanese for Complete Beginners": "Japonais pour grands débutants",
    "JLPT N5–N4 Preparation": "Préparation au JLPT N5–N4",
    "Japanese for Travel": "Japonais pour voyager",
    "Business Japanese": "Japonais des affaires",
    "Other": "Autre",
    "Natural, real-life Japanese in a fun, relaxed way. Learn the everyday expressions Japanese people actually use — including casual phrases you won't usually find in textbooks — and build the confidence to speak.":
      "Un japonais naturel et réel, appris dans la bonne humeur. Découvrez les expressions que les Japonais utilisent vraiment au quotidien — y compris les tournures familières absentes des manuels — et gagnez la confiance pour parler.",
    "For: learners who want to chat with Japanese friends or enjoy natural conversation on a trip.":
      "Pour : les apprenants qui veulent discuter avec des amis japonais ou converser naturellement en voyage.",
    "Start from hiragana and katakana and build a strong foundation in grammar and vocabulary with the GENKI textbook. English support is always available, so starting from zero is completely fine.":
      "Partez des hiragana et des katakana et construisez des bases solides en grammaire et en vocabulaire avec le manuel GENKI. L'aide en anglais est toujours disponible : partir de zéro ne pose aucun problème.",
    "For: first-time learners who want a friendly, supportive start.": "Pour : les débutants qui veulent un démarrage doux et encourageant.",
    "Focused lessons for the JLPT: grammar, vocabulary, reading, and listening, with careful review of your weak points so you can walk into the exam with confidence.":
      "Des cours ciblés pour le JLPT : grammaire, vocabulaire, lecture et écoute, avec un travail attentif sur vos points faibles pour aborder l'examen en toute confiance.",
    "For: N5–N4 learners preparing for the test.": "Pour : les apprenants N5–N4 qui préparent l'examen.",
    "Practical phrases and conversations for your trip — restaurants, shopping, hotels, transportation, and more — customized to your own travel plans.":
      "Des phrases et conversations pratiques pour votre voyage — restaurants, shopping, hôtels, transports et bien plus — adaptées à votre propre itinéraire.",
    "For: anyone planning a trip to Japan, beginners included.": "Pour : toute personne qui prépare un voyage au Japon, débutants compris.",
    "Practical Japanese for professional environments, including workplace communication and interview preparation — informed by 10+ years at international trade shows and experience in a Japanese logistics company.":
      "Un japonais pratique pour le monde professionnel, communication au travail et préparation aux entretiens comprises — nourri par plus de 10 ans d'expérience dans des salons internationaux et dans une entreprise japonaise de logistique.",
    "For: people working in Japan or interviewing with Japanese companies.": "Pour : les personnes qui travaillent au Japon ou passent des entretiens dans des entreprises japonaises.",
    "Something else in mind? Book an \"Other\" lesson and tell Yumi in the booking notes what you would like to work on — reading together, homework help, pronunciation, or anything else.":
      "Autre chose en tête ? Réservez un cours « Autre » et dites à Yumi dans les notes de réservation ce que vous aimeriez travailler — lecture à deux, aide aux devoirs, prononciation, ou tout autre sujet.",
    "For: any goal that doesn't fit the courses above.": "Pour : tout objectif qui n'entre pas dans les cours ci-dessus.",
    "Book this course →": "Réserver ce cours →",
    "WHY CHOOSE ME": "POURQUOI ME CHOISIR",
    "3 Reasons Students Choose Me": "3 raisons de me choisir",
    "Conversation First": "La conversation d'abord",
    "My lessons are conversation-focused: natural expressions friends use with each other — the real-life Japanese you won't find in textbooks — practiced out loud from day one.":
      "Mes cours sont centrés sur la conversation : les expressions naturelles que les amis utilisent entre eux — le japonais de la vraie vie, absent des manuels — pratiquées à voix haute dès le premier jour.",
    "Beginner-Friendly, From Zero": "Accueillant pour les débutants, dès zéro",
    "Starting from hiragana is more than welcome. Lessons follow the GENKI textbook with full English support, so you can ask anything, as many times as you need — no stress, no judgment.":
      "Commencer par les hiragana est tout à fait bienvenu. Les cours suivent le manuel GENKI avec une aide complète en anglais : posez toutes vos questions, autant de fois qu'il le faut — sans stress ni jugement.",
    "100% Tailored to Your Goal": "100 % adapté à votre objectif",
    "Travel, daily life, JLPT N5–N4, or business and job interviews in Japan — every lesson plan is built around your goal, your pace, and your schedule.":
      "Voyage, vie quotidienne, JLPT N5–N4, ou affaires et entretiens d'embauche au Japon — chaque programme est construit autour de votre objectif, de votre rythme et de votre emploi du temps.",
    "LESSON RATES": "TARIFS DES COURS",
    "Lesson duration": "Durée du cours",
    "Price (USD)": "Prix (USD)",
    "Per lesson": "Par cours",
    "30 min": "30 min",
    "50 min": "50 min",
    "80 min": "80 min",
    "120 min": "120 min",
    "$15 per lesson": "15 $ par cours",
    "$25 per lesson": "25 $ par cours",
    "$40 per lesson": "40 $ par cours",
    "$60 per lesson": "60 $ par cours",
    "Lesson packages": "Forfaits de cours",
    "6 lessons": "6 cours",
    "10 lessons": "10 cours",
    "20 lessons": "20 cours",
    "Buy": "Acheter",
    "Book": "Réserver",
    "* All lessons are held online via Google Meet.": "* Tous les cours ont lieu en ligne via Google Meet.",
    "per lesson: $15 (30 min) · $25 (50 min) · $40 (80 min) · $60 (120 min)":
      "par cours : 15 $ (30 min) · 25 $ (50 min) · 40 $ (80 min) · 60 $ (120 min)",
    "Every course is available at every duration — just pick": "Chaque cours est disponible dans toutes les durées — choisissez",
    "See packages in the booking window →": "Voir les forfaits dans la fenêtre de réservation →",
    "Book your lesson": "Réservez votre cours",
    "Choose a course and a lesson at least 72 hours in advance. Times are shown in your timezone.":
      "Choisissez un cours au moins 72 heures à l'avance. Les horaires sont affichés dans votre fuseau horaire.",
    "Closed Saturdays & Sundays. Calendar days are Japan dates; times are shown in your timezone.":
      "Fermé les samedis et dimanches. Les jours du calendrier sont des dates japonaises ; les horaires sont affichés dans votre fuseau horaire.",
    "Book a lesson →": "Réserver un cours →",
    "STEP 1": "ÉTAPE 1",
    "STEP 2": "ÉTAPE 2",
    "STEP 3": "ÉTAPE 3",
    "STEP 4": "ÉTAPE 4",
    "01 · Choose a date": "01 · Choisissez une date",
    "02 · Choose a start time": "02 · Choisissez un horaire",
    "Available times": "Horaires disponibles",
    "Choose a date first": "Choisissez d'abord une date",
    "Checking availability…": "Vérification des disponibilités…",
    "Closed on this day": "Fermé ce jour-là",
    "Not available on this date — please pick another day.": "Indisponible à cette date — veuillez choisir un autre jour.",
    "No times available": "Aucun horaire disponible",
    "No times are available on this date.": "Aucun horaire n'est disponible à cette date.",
    "Could not load times": "Impossible de charger les horaires",
    "Course": "Cours",
    "Course — pick one above": "Cours — choisissez ci-dessus",
    "Duration": "Durée",
    "30, 50, 80 or 120 minutes": "30, 50, 80 ou 120 minutes",
    "Your Details": "Vos coordonnées",
    "Your details": "Vos coordonnées",
    "Your name": "Votre nom",
    "Email (for confirmation & managing your booking)": "E-mail (pour la confirmation et la gestion de votre réservation)",
    "Anything you'd like me to know? (goals, level, topics — optional)": "Quelque chose à me signaler ? (objectifs, niveau, sujets — facultatif)",
    "Review & pay →": "Vérifier et payer →",
    "Continue →": "Continuer →",
    "← Back": "← Retour",
    "Review & payment": "Vérification et paiement",
    "Payment": "Paiement",
    "Card number": "Numéro de carte",
    "Expiry": "Expiration",
    "CVC": "CVC",
    "Pay now": "Payer maintenant",
    "TEST MODE — this checkout is a demo. No real payment is taken; use any card details to try the flow.":
      "MODE TEST — ce paiement est une démo. Aucun paiement réel n'est prélevé ; utilisez n'importe quelle carte pour essayer.",
    "Sign in to pay": "Connectez-vous pour payer",
    "One quick step before payment: sign in with Google, so this booking is saved to":
      "Une petite étape avant le paiement : connectez-vous avec Google pour que cette réservation soit enregistrée sur",
    "account. The booking will use your Google email — that's what lets you (and only you) reschedule or cancel it later.":
      "compte. La réservation utilisera votre e-mail Google — c'est ce qui vous permet (à vous seul) de la déplacer ou de l'annuler plus tard.",
    "Everything you've picked and typed is saved on this device — after signing in, you'll come straight back to this booking, right at the payment step.":
      "Tout ce que vous avez choisi et saisi est conservé sur cet appareil — après la connexion, vous reviendrez directement à cette réservation, à l'étape du paiement.",
    "Continue with Google": "Continuer avec Google",
    "Google account": "Compte Google",
    "🎉 You're booked!": "🎉 C'est réservé !",
    "Done": "Terminé",
    "Lessons are held online — your meeting link is in the table above, or your teacher will send it before the lesson. A confirmation has been sent to your email.":
      "Les cours ont lieu en ligne — votre lien de réunion se trouve dans le tableau ci-dessus, ou votre professeure vous l'enverra avant le cours. Une confirmation a été envoyée à votre adresse e-mail.",
    "Date": "Date",
    "Time": "Heure",
    "Name": "Nom",
    "Email": "E-mail",
    "Total": "Total",
    "Online meeting": "Réunion en ligne",
    "The meeting link will appear here once payment is complete.": "Le lien de réunion apparaîtra ici une fois le paiement terminé.",
    "Cancelled": "Annulé",
    "Upcoming lessons": "Cours à venir",
    "Lesson history": "Historique des cours",
    "Past activity": "Activité passée",
    "No past bookings yet.": "Aucune réservation passée pour le moment.",
    "You have no upcoming lessons.": "Vous n'avez aucun cours à venir.",
    "Cancel this booking": "Annuler cette réservation",
    "Request a refund": "Demander un remboursement",
    "Reschedule": "Déplacer",
    "Confirm new time": "Confirmer le nouvel horaire",
    "Manage your lessons and packages here. Times are shown in your timezone, with Japan time (JST) shown alongside.":
      "Gérez ici vos cours et vos forfaits. Les horaires sont affichés dans votre fuseau horaire, avec l'heure du Japon (JST) à côté.",
    "Go to My Account": "Aller à mon compte",
    "Go to My Bookings": "Aller à mes réservations",
    "My Bookings": "Mes réservations",
    "Your lessons, all in one place.": "Vos cours, au même endroit.",
    "MY ACCOUNT": "MON COMPTE",
    "My Account": "Mon compte",
    "Sign out": "Se déconnecter",
    "Package lessons left": "Cours de forfait restants",
    "remaining in your active packages": "restants dans vos forfaits actifs",
    "bookings still ahead of you": "réservations à venir",
    "Member email": "E-mail du compte",
    "Learning profile": "Profil d'apprentissage",
    "Tell Yumi where you are and where you'd like to go — she plans your lessons around it. This is shared with Yumi only.":
      "Dites à Yumi où vous en êtes et où vous voulez aller — elle préparera vos cours en conséquence. Ces informations ne sont partagées qu'avec Yumi.",
    "Japanese level": "Niveau de japonais",
    "Complete beginner": "Grand débutant",
    "Not sure": "Pas sûr",
    "Learning goals": "Objectifs d'apprentissage",
    "Save profile": "Enregistrer le profil",
    "Sign in with Google to see your upcoming lessons, your lesson packages and your learning profile — and to reschedule or cancel an upcoming lesson. Booked as a guest before? Sign in with the same email and your bookings appear here automatically.":
      "Connectez-vous avec Google pour voir vos cours à venir, vos forfaits et votre profil d'apprentissage — et pour déplacer ou annuler un cours. Vous aviez réservé en invité ? Connectez-vous avec le même e-mail et vos réservations apparaîtront ici automatiquement.",
    "Sign in with Google to see your upcoming lessons and your lesson history — and to reschedule or cancel an upcoming lesson. Booked as a guest? Sign in with the same email and your bookings will appear here automatically.":
      "Connectez-vous avec Google pour voir vos cours à venir et votre historique — et pour déplacer ou annuler un cours. Vous aviez réservé en invité ? Connectez-vous avec le même e-mail et vos réservations apparaîtront ici automatiquement.",
    "New here? Sign in with Google to create your account. Booked as a guest before? Sign in with the same email and your bookings appear here automatically.":
      "Nouveau ici ? Connectez-vous avec Google pour créer votre compte. Vous aviez réservé en invité ? Connectez-vous avec le même e-mail et vos réservations apparaîtront ici automatiquement.",
    "Lesson package": "Forfait de cours",
    "Single lesson": "Cours unique",
    "Package size": "Taille du forfait",
    "Lessons per week": "Cours par semaine",
    "Weekday": "Jour de la semaine",
    "Start time (JST)": "Heure de début (JST)",
    "Weekly slot 1": "Créneau hebdomadaire 1",
    "1× / week": "1× / semaine",
    "2× / week": "2× / semaine",
    "3× / week": "3× / semaine",
    "Pick a weekday…": "Choisissez un jour…",
    "Please choose your fixed weekly lesson times": "Veuillez choisir vos horaires hebdomadaires fixes",
    "Lesson package · fixed weekly times": "Forfait · horaires hebdomadaires fixes",
    "Pick fixed weekly times and buy the whole package at once — every lesson is scheduled for you automatically. A steady rhythm of 1–3 lessons a week works best.":
      "Choisissez des horaires fixes chaque semaine et achetez tout le forfait en une fois — chaque cours est programmé automatiquement. Un rythme régulier de 1 à 3 cours par semaine donne les meilleurs résultats.",
    "You don't have a lesson package yet. A package books the same time every week — steady rhythm, steady progress.":
      "Vous n'avez pas encore de forfait. Un forfait réserve le même horaire chaque semaine — un rythme régulier, des progrès réguliers.",
    "Package": "Forfait",
    "Purchase": "Achat",
    "Is it okay if I am a complete beginner?": "Puis-je commencer si je suis grand débutant ?",
    "Absolutely! Everyone is more than welcome. Let's start with a relaxed feeling, just like catching up with a friend — we'll begin with hiragana and katakana and build up with the GENKI textbook.":
      "Bien sûr ! Tout le monde est le bienvenu. Commençons en toute détente, comme une conversation entre amis — nous partirons des hiragana et des katakana et progresserons avec le manuel GENKI.",
    "Am I allowed to ask questions in English?": "Puis-je poser des questions en anglais ?",
    "Yes, definitely! I will use English to support you and make sure you gain a crystal-clear, deep understanding of the language.":
      "Oui, bien sûr ! Je vous aiderai en anglais pour que votre compréhension de la langue soit claire et profonde.",
    "Can I learn specific phrases or Japanese from my favorite anime?": "Puis-je apprendre des phrases précises ou le japonais de mon anime préféré ?",
    "Yes! I will fully customize the material so you can learn the exact, real-life Japanese you want to use right now.":
      "Oui ! Je personnaliserai entièrement le contenu pour que vous appreniez exactement le japonais de la vraie vie que vous voulez utiliser dès maintenant.",
    "How do we schedule our lesson times?": "Comment planifie-t-on les horaires des cours ?",
    "Book any open slot on this page at least 72 hours in advance. Students using lesson packages can freely book and adjust their lesson duration from 30 minutes up to 2 hours to fit their weekly schedule — just mention it in the booking notes.":
      "Réservez n'importe quel créneau libre sur cette page au moins 72 heures à l'avance. Les élèves en forfait peuvent réserver librement et ajuster la durée de leurs cours de 30 minutes à 2 heures selon leur semaine — signalez-le simplement dans les notes de réservation.",
    "What tool do you use for lessons? Do I need to prepare anything in advance?": "Quel outil utilisez-vous pour les cours ? Faut-il préparer quelque chose ?",
    "Lessons are held online (Zoom / Google Meet). You do not need to install a special app — simply click the link in your booking confirmation to join from your browser. If no link is shown, your teacher will send it before the lesson.":
      "Les cours ont lieu en ligne (Zoom / Google Meet). Aucune application spéciale à installer — cliquez simplement sur le lien de votre confirmation pour rejoindre depuis votre navigateur. Si aucun lien n'apparaît, votre professeure vous l'enverra avant le cours.",
    "Do I need to bring or prepare anything before my lesson?": "Dois-je apporter ou préparer quelque chose avant le cours ?",
    "No special textbook or materials are required. If you have topics you would like to discuss or Japanese phrases you have wondered about in daily life or while traveling, making a quick note beforehand will help us get started smoothly.":
      "Aucun manuel ni matériel particulier n'est requis. Si vous avez des sujets dont vous aimeriez parler ou des phrases japonaises qui vous intriguent au quotidien ou en voyage, les noter à l'avance nous aidera à bien démarrer.",
    "When can I cancel or reschedule a lesson?": "Quand puis-je annuler ou déplacer un cours ?",
    "You can cancel a confirmed lesson from": "Vous pouvez annuler un cours confirmé depuis",
    "You can reschedule or cancel anytime in": "Vous pouvez déplacer ou annuler à tout moment dans",
    "at any time before it starts. Cancel 12 hours or more before the lesson starts and you get a full refund — the amount paid goes back to your original payment method, no matter whether you rescheduled the lesson before. Cancellations within 12 hours of the start are not refunded, and the lesson counts as used. Rescheduling is possible up to 24 hours before the lesson starts, at most twice per booking. New bookings and new rescheduled times must be selected at least 72 hours in advance.":
      "à tout moment avant son début. Annulez 12 heures ou plus avant le début du cours et vous êtes intégralement remboursé — le montant repart sur votre moyen de paiement d'origine, même si vous aviez déjà déplacé le cours. Les annulations à moins de 12 heures du début ne sont pas remboursées et le cours compte comme utilisé. Le déplacement est possible jusqu'à 24 heures avant le début, au maximum deux fois par réservation. Les nouvelles réservations et les nouveaux horaires doivent être choisis au moins 72 heures à l'avance.",
    "What payment methods do you accept?": "Quels moyens de paiement acceptez-vous ?",
    "Payments are processed securely through Stripe. Major credit and debit cards are accepted (Visa, Mastercard, American Express).":
      "Les paiements sont traités en toute sécurité par Stripe. Les principales cartes de crédit et de débit sont acceptées (Visa, Mastercard, American Express).",
    "Payments are processed securely through Stripe. You can use major credit or debit cards available at checkout, including Visa, Mastercard, and American Express.":
      "Les paiements sont traités en toute sécurité par Stripe. Vous pouvez utiliser les principales cartes de crédit ou de débit proposées au paiement, dont Visa, Mastercard et American Express.",
    "Questions about lessons, levels, or scheduling? No question is too small — I'd love to hear from you.":
      "Des questions sur les cours, les niveaux ou les horaires ? Aucune question n'est trop petite — écrivez-moi avec plaisir.",
    "Your name": "Votre nom",
    "Message": "Message",
    "Send Message →": "Envoyer le message →",
    "Thank you! Your message has been noted — Yumi will get back to you soon. 🌸": "Merci ! Votre message est bien noté — Yumi vous répondra bientôt. 🌸",
    "EMAIL": "E-MAIL",
    "INSTAGRAM": "INSTAGRAM",
    "Ready to say “I can speak Japanese!”?": "Prêt à dire « Je parle japonais ! » ?",
    "Fully tailor-made lessons where you can freely adjust your learning schedule around your life. Book and pay right here on this site.":
      "Des cours entièrement sur mesure, avec un planning que vous ajustez librement à votre vie. Réservez et payez directement sur ce site.",
    "Lessons are held online. Booking and payment are handled securely on this site.": "Les cours ont lieu en ligne. La réservation et le paiement se font en toute sécurité sur ce site.",
    "New bookings are taken at least 72 hours in advance. I'm available Monday to Friday, 8:00–22:00 JST. Times are shown in your own timezone":
      "Les nouvelles réservations se font au moins 72 heures à l'avance. Je suis disponible du lundi au vendredi, de 8 h à 22 h (JST). Les horaires sont affichés dans votre fuseau horaire",
    "when you book. New bookings are taken at least 72 hours in advance. Package totals are the per-lesson price × the number of lessons — no hidden fees.":
      "lors de la réservation. Les nouvelles réservations se font au moins 72 heures à l'avance. Le total d'un forfait = le prix par cours × le nombre de cours — sans frais cachés.",
    "Choose your lesson time.": "Choisissez l'heure de votre cours.",
    "Booking opens in a pop-up right on this page: pick your course, date and time, and pay securely here — no account needed. Lessons are held online (Zoom / Google Meet), and your meeting link arrives with your confirmation.":
      "La réservation se fait dans une fenêtre sur cette page même : choisissez votre cours, la date et l'heure, et payez en toute sécurité ici — sans compte. Les cours ont lieu en ligne (Zoom / Google Meet) et votre lien de réunion arrive avec votre confirmation.",
    "Perfect for beginners — and for travelers who want real conversation. Learn the Japanese native speakers actually use, at your own pace, with a patient teacher who has been exactly where you are.":
      "Parfait pour les débutants — et pour les voyageurs qui veulent de vraies conversations. Apprenez le japonais que les natifs utilisent vraiment, à votre rythme, avec une professeure patiente qui est passée par là.",
    "SUN": "dim.", "MON": "lun.", "TUE": "mar.", "WED": "mer.", "THU": "jeu.", "FRI": "ven.", "SAT": "sam.",
    "Selected: choose a date and a time": "Sélection : choisissez une date et un horaire",
    "— this booking is saved to the Google account you signed in with, so it's right there when you come back. Cancelling and rescheduling follow the policy in the FAQ.":
      "— cette réservation est enregistrée sur le compte Google avec lequel vous êtes connecté : vous la retrouverez à votre retour. L'annulation et le déplacement suivent les règles de la FAQ.",
  },
};


/* Additions: placeholders, transient messages, legacy names. */
Object.assign(window.YUMI_I18N.zh, {
  "Hi Yumi, I'd like to ask about…": "你好 Yumi，我想咨询……",
  "e.g. Hold everyday conversations on my trip to Japan this spring; pass JLPT N4 in December…":
    "例如：今年春天去日本旅行时能日常对话；12 月通过 JLPT N4……",
  "Message sent ✓": "已发送 ✓",
  "Sending…": "发送中…",
  "Creating your booking…": "正在创建预约…",
  "Processing (mock)…": "处理中（模拟）…",
  "Trial lesson": "体验课",
  "Loading your account…": "正在加载你的账户…",
  "Sign-in will be available soon. You can still book lessons as a guest — just book with the email you will sign in with later, and your bookings will show up here automatically.":
    "登录功能即将开放。你仍可以游客身份订课——用你之后要登录的邮箱预订，预约会自动出现在这里。",
  "Saved ✓ Yumi will see your level and goals when planning your lessons.": "已保存 ✓ Yumi 安排课程时会看到你的水平和目标。",
  "Saving…": "保存中…",
  "Lessons are online: your meeting link is sent after booking and payment.": "课程在线进行：会议链接会在预订和付款后发送。",
  "Go to page": "前往页面",
});
Object.assign(window.YUMI_I18N.fr, {
  "Hi Yumi, I'd like to ask about…": "Bonjour Yumi, je voudrais demander…",
  "e.g. Hold everyday conversations on my trip to Japan this spring; pass JLPT N4 in December…":
    "ex. : tenir des conversations quotidiennes lors de mon voyage au Japon ce printemps ; réussir le JLPT N4 en décembre…",
  "Message sent ✓": "Message envoyé ✓",
  "Sending…": "Envoi…",
  "Creating your booking…": "Création de votre réservation…",
  "Processing (mock)…": "Traitement (démo)…",
  "Trial lesson": "Cours d'essai",
  "Loading your account…": "Chargement de votre compte…",
  "Sign-in will be available soon. You can still book lessons as a guest — just book with the email you will sign in with later, and your bookings will show up here automatically.":
    "La connexion sera bientôt disponible. Vous pouvez toujours réserver en invité — réservez avec l'e-mail que vous utiliserez pour vous connecter plus tard, et vos réservations apparaîtront ici automatiquement.",
  "Saved ✓ Yumi will see your level and goals when planning your lessons.": "Enregistré ✓ Yumi verra votre niveau et vos objectifs en préparant vos cours.",
  "Saving…": "Enregistrement…",
  "Lessons are online: your meeting link is sent after booking and payment.": "Les cours ont lieu en ligne : votre lien de réunion est envoyé après la réservation et le paiement.",
  "Go to page": "Aller à la page",
});
Object.assign(window.YUMI_I18N.zh, {
  "Please enter your name.": "请输入你的姓名。",
  "Please enter a valid email address.": "请输入有效的邮箱地址。",
  "Please write a message.": "请填写留言内容。",
  "Could not load booking options. Please refresh the page.": "预约选项加载失败，请刷新页面。",
  "Please choose a course.": "请选择课程。",
  "Please pick a date and a time.": "请选择日期和时间。",
  "Please enter your name and a valid email.": "请输入姓名和有效的邮箱。",
  "That time was just taken or is no longer bookable — please pick a new time. Your course and details were kept.":
    "该时段刚刚被订走或已不可预约——请重新选择时间。你的课程和已填信息都保留着。",
  "Google sign-in didn't complete — everything you entered is still here. When you're ready, continue to sign in and pay.":
    "Google 登录未完成——你填写的内容都还在。准备好后，继续登录并付款即可。",
  "Google sign-in didn't complete — please try again.": "Google 登录未完成——请重试。",
});
Object.assign(window.YUMI_I18N.fr, {
  "Please enter your name.": "Veuillez saisir votre nom.",
  "Please enter a valid email address.": "Veuillez saisir une adresse e-mail valide.",
  "Please write a message.": "Veuillez écrire un message.",
  "Could not load booking options. Please refresh the page.": "Impossible de charger les options de réservation. Veuillez actualiser la page.",
  "Please choose a course.": "Veuillez choisir un cours.",
  "Please pick a date and a time.": "Veuillez choisir une date et un horaire.",
  "Please enter your name and a valid email.": "Veuillez saisir votre nom et un e-mail valide.",
  "That time was just taken or is no longer bookable — please pick a new time. Your course and details were kept.":
    "Ce créneau vient d'être pris ou n'est plus réservable — veuillez choisir un nouvel horaire. Votre cours et vos coordonnées ont été conservés.",
  "Google sign-in didn't complete — everything you entered is still here. When you're ready, continue to sign in and pay.":
    "La connexion Google n'a pas abouti — tout ce que vous avez saisi est toujours là. Quand vous êtes prêt, continuez pour vous connecter et payer.",
  "Google sign-in didn't complete — please try again.": "La connexion Google n'a pas abouti — veuillez réessayer.",
});

/* Late-found static copy (booking pane subtitle). */
Object.assign(window.YUMI_I18N.zh, {
  "Choose a course and a lesson at least 72 hours in advance. Times are shown in your timezone.": "请选择课程，并预约至少 72 小时之后的课时。时间以您所在的时区显示。",
});
Object.assign(window.YUMI_I18N.fr, {
  "Choose a course and a lesson at least 72 hours in advance. Times are shown in your timezone.": "Choisissez un cours et réservez un créneau au moins 72 heures à l'avance. Les horaires sont affichés dans votre fuseau horaire.",
});

/* Inline <strong> fragment inside the gate sentence. */
Object.assign(window.YUMI_I18N.zh, { "your": "你的" });
Object.assign(window.YUMI_I18N.fr, { "your": "votre" });

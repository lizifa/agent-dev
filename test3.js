// @version 0.0.11 本地无 AC_AUTH_FILE 时使用内存 mock，避免 aircode init 报错
import lark from "@larksuiteoapi/node-sdk";

let EventDB;
let MsgTable;

// 本地运行时无 AC_AUTH_FILE，用内存表 mock；部署到 Aircode 云时用真实 aircode
function createMockTable() {
  const store = [];
  let id = 0;
  const match = (obj, cond) =>
    Object.keys(cond).every((k) => obj[k] === cond[k]);
  return {
    async save(record) {
      const row = { ...record, createdAt: record.createdAt || new Date() };
      if (record._id != null) {
        const i = store.findIndex((r) => r._id === record._id);
        if (i >= 0) {
          store[i] = { ...store[i], ...row };
          return store[i];
        }
      }
      row._id = row._id || `mock_${++id}`;
      store.push(row);
      return row;
    },
    where(cond) {
      const filtered = store.filter((r) => match(r, cond));
      return {
        async find() {
          return [...filtered];
        },
        async findOne() {
          return filtered[0] || null;
        },
        sort(opt) {
          const desc = opt.createdAt === -1;
          return {
            async find() {
              const out = [...filtered].sort(
                (a, b) =>
                  (desc ? 1 : -1) *
                  (new Date(b.createdAt) - new Date(a.createdAt)),
              );
              return out;
            },
          };
        },
        async delete() {
          for (const r of filtered) {
            const i = store.indexOf(r);
            if (i >= 0) store.splice(i, 1);
          }
        },
        async count() {
          return filtered.length;
        },
      };
    },
  };
}

async function ensureDB() {
  if (EventDB) return;
  if (process.env.AC_AUTH_FILE) {
    const aircode = (await import("aircode")).default;
    EventDB = aircode.db.table("event");
    MsgTable = aircode.db.table("msg");
  } else {
    EventDB = createMockTable();
    MsgTable = createMockTable();
  }
}

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const FEISHU_BOTNAME = "小书包";
const MAX_CONVERSATION_SIZE = 4096; // 历史会话最大长度（字符），超过则丢弃旧消息

const client = new lark.Client({
  appId: FEISHU_APP_ID,
  appSecret: FEISHU_APP_SECRET,
  disableTokenCache: false,
});

console.log(
  {
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    disableTokenCache: false,
  },
  process.env,
  "mmmmm",
);

// 日志辅助函数，请贡献者使用此函数打印关键日志
function logger(param) {
  console.debug(`[CF]`, param);
}

// 回复消息
async function reply(messageId, content) {
  try {
    return await client.im.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify({
          text: content,
        }),
        msg_type: "text",
      },
    });
  } catch (e) {
    logger("send message to feishu error", e, messageId, content);
  }
}

// 简单回复：直接返回收到的内容或固定话术
function getSimpleReply(question) {
  const t = question.trim();
  if (!t) return "你好，请发送你想说的内容～";
  return `收到：${t}`;
}

// 保存用户会话
async function saveConversation(sessionId, question, answer) {
  const msgSize = question.length + answer.length;
  const result = await MsgTable.save({
    sessionId,
    question,
    answer,
    msgSize,
  });
  if (result) {
    // 有历史会话是否需要抛弃
    await discardConversation(sessionId);
  }
}

// 如果历史会话记录超过 MAX_CONVERSATION_SIZE，则从最旧的开始丢弃
async function discardConversation(sessionId) {
  let totalSize = 0;
  const countList = [];
  const historyMsgs = await MsgTable.where({ sessionId })
    .sort({ createdAt: -1 })
    .find();
  const historyMsgLen = historyMsgs.length;
  for (let i = 0; i < historyMsgLen; i++) {
    const msgId = historyMsgs[i]._id;
    totalSize += historyMsgs[i].msgSize;
    countList.push({
      msgId,
      totalSize,
    });
  }
  for (const c of countList) {
    if (c.totalSize > MAX_CONVERSATION_SIZE) {
      await MsgTable.where({ _id: c.msgId }).delete();
    }
  }
}

// 清除历史会话
async function clearConversation(sessionId) {
  return await MsgTable.where({ sessionId }).delete();
}

// 指令处理
async function cmdProcess(cmdParams) {
  switch (cmdParams && cmdParams.action) {
    case "/help":
      await cmdHelp(cmdParams.messageId);
      break;
    case "/clear":
      await cmdClear(cmdParams.sessionId, cmdParams.messageId);
      break;
    default:
      await cmdHelp(cmdParams.messageId);
      break;
  }
  return { code: 0 };
}

// 帮助指令
async function cmdHelp(messageId) {
  const helpText = `指令使用指南

Usage:
    /clear    清除上下文
    /help     获取更多帮助
  `;
  await reply(messageId, helpText);
}

// 清除记忆指令
async function cmdClear(sessionId, messageId) {
  await clearConversation(sessionId);
  await reply(messageId, "✅记忆已清除");
}

// 自检函数
async function doctor() {
  if (FEISHU_APP_ID === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置飞书应用的 AppID，请检查 & 部署后重试",
        en_US:
          "Here is no FeiSHu APP id, please check & re-Deploy & call again",
      },
    };
  }
  if (!FEISHU_APP_ID.startsWith("cli_")) {
    return {
      code: 1,
      message: {
        zh_CN:
          "你配置的飞书应用的 AppID 是错误的，请检查后重试。飞书应用的 APPID 以 cli_ 开头。",
        en_US:
          "Your FeiShu App ID is Wrong, Please Check and call again. FeiShu APPID must Start with cli",
      },
    };
  }
  if (FEISHU_APP_SECRET === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置飞书应用的 Secret，请检查 & 部署后重试",
        en_US:
          "Here is no FeiSHu APP Secret, please check & re-Deploy & call again",
      },
    };
  }

  if (FEISHU_BOTNAME === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置飞书应用的名称，请检查 & 部署后重试",
        en_US:
          "Here is no FeiSHu APP Name, please check & re-Deploy & call again",
      },
    };
  }

  return {
    code: 0,
    message: {
      zh_CN:
        "✅ 配置成功，接下来你可以在飞书应用当中使用机器人来完成你的工作。",
      en_US:
        "✅ Configuration is correct, you can use this bot in your FeiShu App",
    },
    meta: {
      FEISHU_APP_ID,
      FEISHU_BOTNAME,
    },
  };
}

async function handleReply(userInput, sessionId, messageId, eventId) {
  const question = userInput.text.replace("@_user_1", "");
  logger("question: " + question);
  const action = question.trim();
  if (action.startsWith("/")) {
    return await cmdProcess({ action, sessionId, messageId });
  }
  const answer = getSimpleReply(question);
  await saveConversation(sessionId, question, answer);
  await reply(messageId, answer);

  const evt_record = await EventDB.where({ event_id: eventId }).findOne();
  evt_record.content = userInput.text;
  await EventDB.save(evt_record);
  return { code: 0 };
}

export default async function (params, context) {
  await ensureDB();
  // 如果存在 encrypt 则说明配置了 encrypt key
  if (params.encrypt) {
    logger("user enable encrypt key");
    return {
      code: 1,
      message: {
        zh_CN: "你配置了 Encrypt Key，请关闭该功能。",
        en_US: "You have open Encrypt Key Feature, please close it.",
      },
    };
  }
  // 处理飞书开放平台的服务端校验
  if (params.type === "url_verification") {
    logger("deal url_verification");
    return {
      challenge: params.challenge,
    };
  }
  // 自检查逻辑
  if (!params.hasOwnProperty("header") || context.trigger === "DEBUG") {
    logger("enter doctor");
    return await doctor();
  }
  // 处理飞书开放平台的事件回调
  if (params.header.event_type === "im.message.receive_v1") {
    let eventId = params.header.event_id;
    let messageId = params.event.message.message_id;
    let chatId = params.event.message.chat_id;
    let senderId = params.event.sender.sender_id.user_id;
    let sessionId = chatId + senderId;

    // 对于同一个事件，只处理一次
    const count = await EventDB.where({ event_id: eventId }).count();
    if (count != 0) {
      logger("skip repeat event");
      return { code: 1 };
    }
    await EventDB.save({ event_id: eventId });

    // 私聊直接回复
    if (params.event.message.chat_type === "p2p") {
      // 不是文本消息，不处理
      if (params.event.message.message_type != "text") {
        await reply(messageId, "暂不支持其他类型的提问");
        logger("skip and reply not support");
        return { code: 0 };
      }
      // 是文本消息，直接回复
      const userInput = JSON.parse(params.event.message.content);
      return await handleReply(userInput, sessionId, messageId, eventId);
    }

    // 群聊，需要 @ 机器人
    if (params.event.message.chat_type === "group") {
      // 这是日常群沟通，不用管
      if (
        !params.event.message.mentions ||
        params.event.message.mentions.length === 0
      ) {
        logger("not process message without mention");
        return { code: 0 };
      }
      // 没有 mention 机器人，则退出。
      if (params.event.message.mentions[0].name != FEISHU_BOTNAME) {
        logger("bot name not equal first mention name ");
        return { code: 0 };
      }
      const userInput = JSON.parse(params.event.message.content);
      return await handleReply(userInput, sessionId, messageId, eventId);
    }
  }

  logger("return without other log");
  return {
    code: 2,
  };
}

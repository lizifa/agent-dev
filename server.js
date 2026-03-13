const axios = require("axios");
const schedule = require("node-schedule");
const express = require("express");
const { DateTime } = require("luxon");
const crypto = require("crypto");

// ===================== 所有配置项 =====================
const CONFIG = {
  // 群机器人 Webhook（仅发送、定时推送）
  FEISHU_WEBHOOK:
    "https://open.feishu.cn/open-apis/bot/v2/hook/ba101f68-3221-4108-9534-59d5bbacf065",
  FEISHU_SIGN_SECRET: "9zLkUzBp2DczKJ3UmCJ6ed", // 去掉空格
  // 企业自建应用（用于 @ 机器人 回复消息），未配置则无法回复 @
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || "",
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || "",
  EVENT_PORT: parseInt(process.env.EVENT_PORT || "3000", 10),
  CRON_TIME: "0 0 9 * * *",
  RN_GITHUB_RELEASE_URL:
    "https://api.github.com/repos/facebook/react-native/releases/latest",
  RN_OFFICIAL_BLOG_URL: "https://reactnative.dev/blog",
  MSG_TITLE: "React Native每日更新",
  MAX_SUMMARY_LENGTH: 600,
};
// =====================================================

/**
 * 生成飞书机器人签名（与官方 Java/PHP 一致）
 * key = timestamp + "\\n" + secret，message = 空 → HMAC-SHA256 → Base64
 */
function generateFeishuSign(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac("sha256", stringToSign);
  return hmac.digest("base64");
}

/** 缓存 tenant_access_token，避免频繁请求 */
let cachedToken = { value: null, expireAt: 0 };

/**
 * 获取飞书 tenant_access_token（企业自建应用）
 */
async function getTenantAccessToken() {
  if (cachedToken.value && Date.now() < cachedToken.expireAt - 60000) {
    return cachedToken.value;
  }
  if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET) {
    throw new Error(
      "未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET，请在环境变量或飞书开放平台应用凭证中配置",
    );
  }
  let res;
  try {
    res = await axios.post(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        app_id: CONFIG.FEISHU_APP_ID,
        app_secret: CONFIG.FEISHU_APP_SECRET,
      },
      { headers: { "Content-Type": "application/json" }, timeout: 5000 },
    );
  } catch (err) {
    const msg = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error("❌ 请求 tenant_access_token 网络异常：", msg);
    throw new Error(`飞书鉴权请求失败: ${msg}`);
  }
  const data = res.data || {};
  if (data.tenant_access_token) {
    cachedToken = {
      value: data.tenant_access_token,
      expireAt: Date.now() + (data.expire || 7200) * 1000,
    };
    return cachedToken.value;
  }
  const errMsg =
    data.msg || data.error_description || "获取 tenant_access_token 失败";
  const code = data.code ?? data.error;
  console.error("❌ 飞书鉴权返回错误：", { code, msg: errMsg, data });
  throw new Error(`飞书鉴权失败(code=${code}): ${errMsg}`);
}

/**
 * 向指定会话发送文本消息（用于回复被 @ 的群聊）
 */
async function sendMessageToChat(chatId, text) {
  const token = await getTenantAccessToken();
  let res;
  try {
    res = await axios.post(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
        validateStatus: () => true,
      },
    );
  } catch (err) {
    console.error(
      "❌ 发送消息请求异常：",
      err.message,
      err.response?.data ? JSON.stringify(err.response.data) : "",
    );
    return false;
  }
  if (res.status !== 200 || res.data?.code !== 0) {
    const d = res.data || {};
    const code = d.code ?? res.status;
    const msg = d.msg || d.error_description || res.statusText;
    console.error("❌ 发送消息失败：", { code, msg, data: d });
    if (code === 99991663) {
      console.error("💡 可能原因：机器人未加入该群，或未开通「发群消息」权限");
    }
    if (code === 230001) {
      console.error("💡 可能原因：应用未发布/未生效，或 chat_id 无效");
    }
    return false;
  }
  return true;
}

/**
 * 获取React Native最新动态
 */
async function getLatestRNInfo() {
  let rnContent = "";
  const now = DateTime.now()
    .setZone("Asia/Shanghai")
    .toFormat("yyyy-MM-dd HH:mm:ss");

  try {
    const githubRes = await axios.get(CONFIG.RN_GITHUB_RELEASE_URL, {
      timeout: 10000,
      headers: { "User-Agent": "RN-Feishu-Bot" },
    });

    if (githubRes.status === 200) {
      const data = githubRes.data;
      const version = data.tag_name || "未知版本";
      const title = data.name || "无版本名称";
      const body =
        (data.body || "无更新说明")
          .replace(/<[^>]*>/g, "")
          .substring(0, CONFIG.MAX_SUMMARY_LENGTH) + "...";
      const url = data.html_url || "";

      rnContent += `### 🚀 React Native最新更新（${now}）\n`;
      rnContent += `> 版本：${version} | 标题：${title}\n`;
      rnContent += `> 更新摘要：${body}\n`;
      rnContent += `> 完整详情：[点击查看](${url})\n\n`;
    }
  } catch (err) {
    rnContent += `### ⚠️ 获取GitHub更新失败（${now}）\n`;
    rnContent += `> 错误信息：${err.message}\n\n`;
  }

  rnContent += `### 📢 官方动态补充\n`;
  rnContent += `> 官方博客最新内容：[React Native Blog](${CONFIG.RN_OFFICIAL_BLOG_URL})\n\n`;
  rnContent += `### 💡 核心思考\n`;
  rnContent += `> 1. 每日同步RN版本更新，提前感知API变更与兼容性风险；\n`;
  rnContent += `> 2. 跟进官方修复的Bug，为APP稳定性优化提供参考；\n`;
  rnContent += `> 3. 辅助制定RN版本升级计划，平衡业务迭代与技术升级节奏。`;

  return rnContent;
}

/**
 * 推送信息到飞书（带签名校验）
 */
async function sendToFeishu(content) {
  if (!CONFIG.FEISHU_WEBHOOK || !CONFIG.FEISHU_SIGN_SECRET) {
    console.error("❌ 请先配置Webhook和签名密钥！");
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateFeishuSign(CONFIG.FEISHU_SIGN_SECRET, timestamp);

  const bodyWithSign = {
    timestamp: timestamp.toString(),
    sign: sign,
    msg_type: "text",
    content: { text: `【${CONFIG.MSG_TITLE}】\n\n${content}` },
  };

  const opts = {
    headers: { "Content-Type": "application/json" },
    timeout: 10000,
    validateStatus: () => true,
  };

  try {
    let res = await axios.post(CONFIG.FEISHU_WEBHOOK, bodyWithSign, opts);
    if (res.status === 200 && res.data?.StatusCode === 0) {
      console.log(
        `✅ 推送成功：${DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss")}`,
      );
      return;
    }
    if (res.data?.code === 19021) {
      console.warn(
        "⚠️ 签名校验失败(19021)，尝试无签名发送（若飞书已关闭签名校验）…",
      );
      const bodyNoSign = {
        msg_type: "text",
        content: { text: `【${CONFIG.MSG_TITLE}】\n\n${content}` },
      };
      res = await axios.post(CONFIG.FEISHU_WEBHOOK, bodyNoSign, opts);
    }
    if (res.status === 200 && res.data?.StatusCode === 0) {
      console.log(
        `✅ 推送成功（无签名）：${DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss")}`,
      );
    } else {
      console.error(
        "❌ 飞书返回异常：",
        res.status,
        res.data || res.statusText,
      );
      if (res.data?.code === 19021) {
        console.error(
          "💡 请检查：1) 在飞书群机器人设置里重新复制「签名校验」密钥；2) 本机时间是否准确（与网络时间同步）。",
        );
      }
    }
  } catch (err) {
    console.error(`❌ 推送失败：${err.message}`);
    if (err.response) console.error("❌ 飞书错误响应：", err.response.data);
  }
}

/**
 * 定时任务主逻辑（返回内容文本，供 Webhook 或回复消息使用）
 */
async function runTask() {
  console.log(`🔄 任务启动：${DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss")}`);
  const rnInfo = await getLatestRNInfo();
  await sendToFeishu(rnInfo);
  return rnInfo;
}

// ---------- 事件订阅：接收群内 @ 机器人 消息 ----------
const app = express();
app.use(express.json());

app.post("/feishu/event", (req, res) => {
  const body = req.body || {};
  // 1. URL 校验：飞书配置「请求地址」时会发此请求，需 1 秒内原样返回 challenge
  if (body.type === "url_verification") {
    return res.json({ challenge: body.challenge || "" });
  }
  // 2. 事件回调
  if (body.type === "event_callback") {
    const event = body.event || {};
    if (event.type === "im.message.receive_v1") {
      const msg = event.message || {};
      const chatId = msg.chat_id;
      const mentions = msg.mentions || [];
      // 只有被 @ 时才回复（订阅「获取用户在群组中@机器人的消息」时，收到即表示被 @）
      if (mentions.length > 0 && chatId) {
        res.status(200).send(""); // 先快速响应飞书，避免超时
        (async () => {
          if (!CONFIG.FEISHU_APP_ID || !CONFIG.FEISHU_APP_SECRET) {
            console.warn(
              "⚠️ 未配置 FEISHU_APP_ID/FEISHU_APP_SECRET，无法回复 @ 消息",
            );
            return;
          }
          try {
            const rnInfo = await getLatestRNInfo();
            const replyText = `【${CONFIG.MSG_TITLE}】\n\n${rnInfo}`;
            await sendMessageToChat(chatId, replyText);
            console.log(
              `✅ 已回复 @ 消息：${DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss")}`,
            );
          } catch (err) {
            console.error("❌ 处理 @ 消息失败：", err.message);
            await sendMessageToChat(
              chatId,
              `处理请求失败：${err.message}`,
            ).catch(() => {});
          }
        })();
        return;
      }
    }
    return res.status(200).send("");
  }
  res.status(200).send("");
});

// 健康检查，便于部署/运维
app.get("/health", (req, res) =>
  res.json({ ok: true, t: new Date().toISOString() }),
);

app.listen(CONFIG.EVENT_PORT, () => {
  console.log(
    `📡 事件订阅服务已启动：http://0.0.0.0:${CONFIG.EVENT_PORT}，回调路径：POST /feishu/event`,
  );
});

// 启动机器人：立即执行一次 + 定时
runTask();
// 保存 job 实例
const job = schedule.scheduleJob(CONFIG.CRON_TIME, runTask);

console.log(`🚀 RN飞书机器人已启动！`);
console.log(`🔧 定时规则：${CONFIG.CRON_TIME}`);
// 用 job 实例获取下次执行时间
console.log(
  `📅 下次执行时间：${job.nextInvocation()?.toLocaleString() || "立即执行"}`,
);

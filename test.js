import * as lark from "@larksuiteoapi/node-sdk";
import express from "express";
import bodyParser from "body-parser";

const server = express();
server.use(bodyParser.json());

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: process.env.FEISHU_ENCRYPT_KEY,
}).register({
  "im.message.receive_v1": async (data) => {
    const chatId = data.message.chat_id;

    const res = await client.im.message.create({
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text: "hello world" }),
        msg_type: "text",
      },
    });
    return res;
  },
});

server.use("/webhook/event", lark.adaptExpress(eventDispatcher));
server.listen(3000);

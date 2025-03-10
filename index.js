const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Ocard 原始 Webhook
const OCARD_WEBHOOK_URL = "https://api.ocard.co/bot_line/webhook?app_id=boyfriend";

// 營業時間
const OPEN_TIME = 9;  // 早上9點
const CLOSE_TIME = 22; // 晚上10點

// LINE Webhook 處理
app.post("/webhook", async (req, res) => {
    try {
        console.log("Webhook 收到訊息:", JSON.stringify(req.body, null, 2)); // 🛠️ Debug 日誌

        const event = req.body.events?.[0]; 
        if (!event) {
            return res.status(200).send("No event data");
        }

        // 取得現在時間
        const now = new Date();
        const currentHour = now.getHours();
        console.log(`目前時間: ${currentHour} 時`);

        // **判斷是否為「手動回覆」或「LINE 自動回覆」**
        if (event.source?.userId === "Uxxxxxxxxxxxx" || event.deliveryContext?.isRedelivery) {
            console.log("手動回覆或 LINE 自動回覆，略過回應");
            return res.status(200).send("Skipped reply");
        }

        // **下班時間回應**
        if (currentHour >= CLOSE_TIME || currentHour < OPEN_TIME) {
            console.log("下班時間，自動回覆用戶...");
            return res.json({
                replyToken: event.replyToken,
                messages: [
                    {
                        type: "text",
                        text: "您好，現在是下班時間，請留下您的訊息，上班時間會由專人為您服務。\n\n如需預約請提供您要操作的部位及操作方式，加速回覆速度喔😊\n\n也歡迎參考官網：https://boyfriendwax.com/"
                    }
                ]
            });
        }

        // **攔截 Ocard 會員綁定訊息**
        const messageText = event.message?.text || "";
        if (messageText.includes("請綁定您的會員")) {
            console.log("攔截會員綁定畫面，不回傳給用戶");
            return res.status(200).send("Intercepted binding message");
        }

        // **轉發給 Ocard 原始 Webhook**
        const ocardResponse = await axios.post(OCARD_WEBHOOK_URL, req.body, {
            headers: {
                "Content-Type": "application/json"
            }
        });

        console.log("成功轉發至 Ocard:", ocardResponse.data);
        res.status(200).send("Forwarded to Ocard");

    } catch (error) {
        console.error("Webhook Error:", error.response?.data || error.message);
        res.status(500).send("Server error");
    }
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

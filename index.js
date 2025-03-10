const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Ocard API Webhook
const OCARD_WEBHOOK_URL = "https://api.ocard.co/bot_line/webhook?app_id=boyfriend";

// LINE Webhook 處理
app.post("/webhook", async (req, res) => {
    try {
        console.log("Webhook 收到訊息:", JSON.stringify(req.body, null, 2)); // 🛠️ Debug 記錄

        const event = req.body.events?.[0]; 
        if (!event) {
            return res.status(200).send("No event data");
        }

        // **攔截 Ocard 會員綁定訊息**
        const messageText = event.message?.text || "";
        if (messageText.includes("請綁定您的會員")) {
            console.log("攔截會員綁定畫面，不回傳給用戶");
            return res.status(200).send("Intercepted binding message");
        }

        // **轉發給 Ocard API**
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

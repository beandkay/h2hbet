const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function sendEmail() {
    try {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.log("⚠️ Skipping email: SMTP_USER and SMTP_PASS are not set in .env");
            return;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail', // You can change this or use host/port for other providers
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        const soccerPath = path.join(__dirname, 'esoccer_analysis.md');
        const basketballPath = path.join(__dirname, 'ebasketball_analysis.md');
        
        let content = "";
        
        if (fs.existsSync(soccerPath)) {
            content += fs.readFileSync(soccerPath, 'utf8') + "\n\n========================================\n\n";
        }
        if (fs.existsSync(basketballPath)) {
            content += fs.readFileSync(basketballPath, 'utf8');
        }

        if (!content) {
            console.log("⚠️ Skipping email: No analysis files found.");
            return;
        }

        const mailOptions = {
            from: process.env.SMTP_USER,
            to: 'tinyswish@gmail.com',
            subject: `H2H Analysis Report - ${new Date().toLocaleString()}`,
            text: content,
            html: `<pre style="font-family: monospace;">${content.replace(/\n/g, '<br>')}</pre>`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 Email sent successfully to tinyswish@gmail.com! Message ID: ${info.messageId}`);
    } catch (error) {
        console.error("❌ Failed to send email:", error.message);
    }
}

sendEmail();

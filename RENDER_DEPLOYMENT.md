# PATHORA Monetization Backend Deployment on Render

This backend runs on **Node.js + Express + Mongoose (Plain JavaScript)**.

## Environment Variables to Configure on Render Dashboard

In the **Environment** tab of your Render Web Service, add the following variables:

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment | `production` |
| `PORT` | Web port | `5000` or `10000` (Render default) |
| `MONGODB_URI` | MongoDB Atlas Connection String | `mongodb+srv://<username>:<NEW_ROTATED_PASSWORD>@cluster0.mwlgbfa.mongodb.net/arrowapp?retryWrites=true&w=majority` |
| `RAZORPAY_KEY_ID` | Razorpay Key ID | `rzp_test_Sg3K7MXaFUsrl3` (or Live when compliant) |
| `RAZORPAY_KEY_SECRET` | Razorpay Secret (Rotated) | *(Your newly rotated secret from Razorpay Dashboard)* |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret | *(Configured under Razorpay Webhooks tab)* |

## Render Web Service Settings

- **Name:** `pathora-monetization-backend`
- **Root Directory:** `backend`
- **Environment:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Health Check Path:** `/health`

## Webhook URL Configuration in Razorpay Dashboard
Set Webhook URL to:  
`https://<your-render-app-name>.onrender.com/api/payments/webhook`

Selected Events:
- `payment.captured`
- `order.paid`
- `payment.failed`


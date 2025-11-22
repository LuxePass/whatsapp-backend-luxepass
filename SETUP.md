# Quick Setup Guide

## Step 1: Install Dependencies

```bash
cd whatsapp-backend
npm install
```

## Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your Meta credentials:

```env
META_TOKEN=your_token_here
META_PHONE_NUMBER_ID=your_phone_number_id
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
WEBHOOK_VERIFY_TOKEN=generate_random_string_here
PORT=8000
```

## Step 3: Get Meta Credentials

### Access Token
1. Go to [Meta Business Manager](https://business.facebook.com)
2. Business Settings → System Users
3. Create System User (if needed)
4. Generate Token with permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copy the token (save it - you won't see it again!)

### Phone Number ID
1. Go to [WhatsApp Manager](https://business.facebook.com/wa/manage/home/)
2. Phone Numbers tab
3. Click on your phone number
4. Copy the **Phone Number ID** (not the phone number itself)

### App ID & Secret
1. Go to [Meta for Developers](https://developers.facebook.com)
2. Your App → Settings → Basic
3. Copy **App ID** and **App Secret**

### Verify Token
Generate a random string:
```bash
openssl rand -hex 32
```

## Step 4: Start the Server

```bash
npm run dev
```

Server runs on `http://localhost:8000`

## Step 5: Setup Webhook (Local Development)

### Using ngrok

```bash
# Install ngrok
npm install -g ngrok

# Start ngrok
ngrok http 8000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

### Configure in Meta

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Your App → WhatsApp → Configuration
3. Set **Callback URL**: `https://your-ngrok-url.ngrok.io/webhook`
4. Set **Verify Token**: Same as `WEBHOOK_VERIFY_TOKEN` in `.env`
5. Subscribe to fields:
   - ✅ `messages`
   - ✅ `message_status`
6. Click **Verify and Save**

## Step 6: Test

### Test Webhook
Send a message to your WhatsApp Business number. Check server logs.

### Test API
```bash
curl -X POST http://localhost:8000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "to": "1234567890",
    "type": "text",
    "message": "Hello from API!"
  }'
```

## Step 7: Connect Frontend

Update your frontend `.env`:

```env
VITE_WHATSAPP_BACKEND_URL=http://localhost:8000/api
```

Restart your frontend dev server.

## Troubleshooting

### Webhook not working?
- Check ngrok is running
- Verify `WEBHOOK_VERIFY_TOKEN` matches Meta
- Check server logs for errors

### Messages not sending?
- Verify `META_TOKEN` is valid
- Check phone number format (no +, no spaces)
- Check Meta API error in logs

### CORS errors?
- Add frontend URL to `ALLOWED_ORIGINS` in `.env`
- Restart server after changing `.env`

## Production Deployment

See `README.md` for Docker and production setup instructions.


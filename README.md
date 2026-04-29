# WhatsApp Business Cloud API Backend

Production-grade Node.js backend for WhatsApp Business Cloud API integration with webhook support, message sending, and conversation management.

## 🚀 Features

- ✅ **Webhook Integration** - Receive and process incoming WhatsApp messages
- ✅ **Message Sending** - Send text, media, and template messages
- ✅ **Conversation Management** - Track conversations and message history
- ✅ **Production Ready** - Logging, error handling, security middleware
- ✅ **Docker Support** - Containerized deployment
- ✅ **TypeScript Ready** - ES Modules with modern JavaScript

## 📋 Prerequisites

- Node.js 18+ (LTS recommended)
- Meta Developer Account with WhatsApp Business API access
- Permanent Access Token from Meta Business Manager
- Webhook URL (use ngrok for local development)

## 🛠️ Installation

### 1. Clone and Setup

```bash
cd whatsapp-backend
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

```env
META_TOKEN=your_permanent_access_token
META_PHONE_NUMBER_ID=your_phone_number_id
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
WEBHOOK_VERIFY_TOKEN=your_random_verify_token
PORT=8000
```

**Broadcast (Marketing Messages API)** uses a hardcoded default template name `marketing_update`. Create this template in [Meta Business Manager](https://business.facebook.com) → WhatsApp Manager → Message templates:

- **Name:** `marketing_update` (must match exactly)
- **Category:** Marketing
- **Language:** English (or your locale)
- **Body:** One variable for the message text, e.g. `Here's an update from us: {{1}}`

Optional overrides:

```env
META_MARKETING_TEMPLATE_NAME=your_other_template_name
META_MARKETING_TEMPLATE_LANGUAGE=en
```

### 3. Get Meta Credentials

1. **Access Token**: Go to Meta Business Manager → System Users → Create token with `whatsapp_business_messaging` permission
2. **Phone Number ID**: WhatsApp Manager → Phone Numbers → Copy the ID
3. **App ID & Secret**: Meta for Developers → Your App → Settings → Basic
4. **Verify Token**: Generate a random string (e.g., `openssl rand -hex 32`)

## 🏃 Running the Server

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

Server will start on `http://localhost:8000`

## 📡 API Endpoints

### Health Check

```http
GET /health
```

### Webhook (Meta)

```http
GET /webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE
POST /webhook
```

### Send Message

```http
POST /api/messages
Content-Type: application/json

{
  "to": "1234567890",
  "type": "text",
  "message": "Hello from WhatsApp API!"
}
```

**Message Types:**

- `text` - Text message
- `image` - Image with optional caption
- `video` - Video with optional caption
- `document` - Document with optional filename
- `audio` - Audio file
- `template` - Template message

**Example Requests:**

```json
// Text message
{
  "to": "1234567890",
  "type": "text",
  "message": "Hello!"
}

// Image message
{
  "to": "1234567890",
  "type": "image",
  "mediaUrl": "https://example.com/image.jpg",
  "caption": "Check this out!"
}

// Template message
{
  "to": "1234567890",
  "type": "template",
  "templateName": "hello_world",
  "languageCode": "en"
}
```

### Get Conversations

```http
GET /api/conversations
```

### Get Conversation Messages

```http
GET /api/conversations/:conversationId/messages
```

### Mark Conversation as Read

```http
POST /api/conversations/:conversationId/read
```

## 🔗 Frontend Integration

Update your frontend `.env` to point to the backend:

```env
VITE_WHATSAPP_BACKEND_URL=http://localhost:8000/api
```

### Example Frontend Usage

```javascript
// Send a text message
const response = await fetch("http://localhost:8000/api/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    to: "1234567890",
    type: "text",
    message: "Hello from frontend!",
  }),
});

const data = await response.json();
console.log(data);
```

```javascript
// Get all conversations
const response = await fetch("http://localhost:8000/api/conversations");
const { data } = await response.json();
console.log(data);
```

```javascript
// Get messages for a conversation
const conversationId = "1234567890";
const response = await fetch(
  `http://localhost:8000/api/conversations/${conversationId}/messages`
);
const { data } = await response.json();
console.log(data);
```

## 🔐 Webhook Setup

### 1. Local Development (ngrok)

```bash
# Install ngrok
npm install -g ngrok

# Start your server
npm run dev

# In another terminal, expose your local server
ngrok http 8000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)

### 2. Configure Webhook in Meta

1. Go to Meta for Developers → Your App → WhatsApp → Configuration
2. Set **Callback URL**: `https://your-ngrok-url.ngrok.io/webhook`
3. Set **Verify Token**: Same as `WEBHOOK_VERIFY_TOKEN` in your `.env`
4. Subscribe to fields: `messages`, `message_status`
5. Click **Verify and Save**

### 3. Test Webhook

Send a test message to your WhatsApp Business number. You should see logs in your server console.

## 🐳 Docker Deployment

### Build and Run

```bash
# Build image
docker build -t whatsapp-backend .

# Run container
docker run -d \
  --name whatsapp-backend \
  -p 8000:8000 \
  --env-file .env \
  whatsapp-backend
```

### Docker Compose

```bash
docker-compose up -d
```

## 📊 Logging

Logs are written to:

- Console (all environments)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)
- `logs/exceptions.log` (uncaught exceptions)
- `logs/rejections.log` (unhandled promise rejections)

## 🔒 Security Features

- **Helmet.js** - Security headers
- **CORS** - Configurable origin whitelist
- **Rate Limiting** - 100 requests per 15 minutes per IP
- **Webhook Signature Verification** - Validates Meta webhook signatures
- **Input Validation** - Request validation and sanitization

## 🧪 Testing

```bash
npm test
```

## 📝 Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS for webhook URL
- [ ] Configure proper CORS origins
- [ ] Set up PostgreSQL and run Prisma schema sync
- [ ] Configure log rotation
- [ ] Set up monitoring/alerting
- [ ] Use environment-specific secrets
- [ ] Enable webhook signature verification
- [ ] Set up backup/recovery

## 🔄 Database Integration

This project now uses Prisma with PostgreSQL for durable storage.

1. Set `DATABASE_URL` in your `.env`.
2. Generate the Prisma client:

```bash
npm run prisma:generate
```

3. Push schema to your database:

```bash
npm run prisma:db:push
```

4. Start the server:

```bash
npm run dev
```

## 📚 API Documentation

See `examples/postman_collection.json` for Postman collection with all endpoints.

## 🐛 Troubleshooting

### Webhook not receiving messages

1. Verify webhook URL is accessible (use ngrok for local)
2. Check `WEBHOOK_VERIFY_TOKEN` matches Meta configuration
3. Ensure webhook is subscribed to `messages` field
4. Check server logs for errors

### Messages not sending

1. Verify `META_TOKEN` is valid and not expired
2. Check `META_PHONE_NUMBER_ID` is correct
3. Ensure phone number is in correct format (no +, no spaces)
4. Check Meta API error responses in logs

### CORS errors

1. Add your frontend origin to `ALLOWED_ORIGINS` in `.env`
2. Restart server after changing environment variables

## 📄 License

MIT

## 🤝 Support

For issues and questions, please open an issue on GitHub.


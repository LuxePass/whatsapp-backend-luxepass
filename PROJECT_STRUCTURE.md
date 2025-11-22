# Project Structure

```
whatsapp-backend/
├── src/
│   ├── config/
│   │   ├── env.js              # Environment configuration
│   │   └── logger.js           # Winston logger setup
│   ├── controllers/
│   │   ├── webhookController.js      # Webhook verification & event handling
│   │   ├── messageController.js      # Message sending logic
│   │   └── conversationController.js # Conversation management
│   ├── services/
│   │   └── whatsappService.js  # WhatsApp API integration
│   ├── routes/
│   │   ├── webhookRoutes.js    # Webhook endpoints
│   │   ├── messageRoutes.js   # Message API endpoints
│   │   └── conversationRoutes.js # Conversation API endpoints
│   ├── middlewares/
│   │   ├── errorHandler.js    # Global error handler
│   │   ├── requestLogger.js   # Request logging
│   │   └── rawBody.js         # Raw body for webhook verification
│   └── utils/
│       ├── webhookVerification.js # Webhook signature verification
│       ├── messageStorage.js   # In-memory message storage
│       └── validation.js       # Zod validation schemas
├── tests/                      # Test files
├── examples/
│   ├── postman_collection.json # Postman API collection
│   └── webhook_payloads.json   # Example webhook payloads
├── logs/                       # Log files (created at runtime)
├── server.js                   # Main application entry point
├── package.json                # Dependencies and scripts
├── Dockerfile                  # Docker image configuration
├── docker-compose.yml          # Docker Compose configuration
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
├── README.md                   # Complete documentation
├── SETUP.md                    # Quick setup guide
└── PROJECT_STRUCTURE.md        # This file
```

## Key Files

### Entry Point
- **server.js** - Express server setup, middleware configuration, route registration

### Configuration
- **src/config/env.js** - Environment variable management and validation
- **src/config/logger.js** - Winston logger with file and console transports

### Controllers
- **webhookController.js** - Handles Meta webhook verification (GET) and events (POST)
- **messageController.js** - Processes message sending requests from frontend
- **conversationController.js** - Manages conversation listing and message retrieval

### Services
- **whatsappService.js** - Core WhatsApp Business API integration:
  - `sendTextMessage()` - Send text messages
  - `sendMediaMessage()` - Send images, videos, documents, audio
  - `sendTemplateMessage()` - Send approved template messages
  - `markMessageAsRead()` - Mark messages as read

### Routes
- **/webhook** - Meta webhook endpoint
- **/api/messages** - Send messages
- **/api/conversations** - Get conversations and messages

### Middleware
- **errorHandler.js** - Global error handling
- **requestLogger.js** - Request/response logging
- **rawBody.js** - Capture raw body for webhook signature verification

### Utilities
- **webhookVerification.js** - Verify Meta webhook signatures
- **messageStorage.js** - In-memory storage (replace with DB in production)
- **validation.js** - Zod schemas for request validation

## API Endpoints

### Webhook
- `GET /webhook` - Webhook verification
- `POST /webhook` - Receive webhook events

### Messages
- `POST /api/messages` - Send a message

### Conversations
- `GET /api/conversations` - Get all conversations
- `GET /api/conversations/:id/messages` - Get messages for conversation
- `POST /api/conversations/:id/read` - Mark conversation as read

### Health
- `GET /health` - Health check endpoint

## Environment Variables

Required:
- `META_TOKEN` - Permanent access token
- `META_PHONE_NUMBER_ID` - WhatsApp phone number ID
- `WEBHOOK_VERIFY_TOKEN` - Webhook verification token

Optional:
- `META_APP_ID` - App ID (for signature verification)
- `META_APP_SECRET` - App secret (for signature verification)
- `PORT` - Server port (default: 8000)
- `NODE_ENV` - Environment (development/production)
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)

## Next Steps

1. **Database Integration** - Replace `messageStorage.js` with database calls
2. **Authentication** - Add API key or JWT authentication
3. **Rate Limiting** - Adjust rate limits per endpoint
4. **Monitoring** - Add APM tools (New Relic, Datadog, etc.)
5. **Testing** - Add unit and integration tests
6. **Documentation** - Generate API docs with Swagger/OpenAPI


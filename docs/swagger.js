import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Daisu API',
      version: '1.0.0',
      description: 'API for Daisu Language Learning Platform — real-time chat, vocabulary, achievements, events, DMs, and more.',
      contact: { name: 'Weco', email: 'matiaspalma2594@gmail.com' },
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management' },
      { name: 'Chat', description: 'Rooms and messages' },
      { name: 'DMs', description: 'Direct messages' },
      { name: 'Social', description: 'Follows, blocks, reports' },
      { name: 'Vocabulary', description: 'Word bank and flashcards' },
      { name: 'Achievements', description: 'Badges, XP, leaderboard' },
      { name: 'Events', description: 'Community events' },
      { name: 'Notifications', description: 'User notifications' },
      { name: 'Resources', description: 'Learning resources' },
      { name: 'News', description: 'News articles' },
      { name: 'Memberships', description: 'Plans and payments' },
      { name: 'Analytics', description: 'Admin analytics' },
      { name: 'Search', description: 'Search functionality' },
      { name: 'Admin', description: 'Admin operations' },
    ],
    paths: {
      // AUTH
      '/api/createuser': {
        post: { tags: ['Auth'], summary: 'Register a new user', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name','email','password'], properties: { name: {type:'string'}, email: {type:'string',format:'email'}, password: {type:'string',minLength:6}, image: {type:'string'} }}}}},
          responses: { 201: { description: 'User created with JWT token' }, 409: { description: 'User already exists' }}
        }
      },
      '/api/login': {
        post: { tags: ['Auth'], summary: 'Login with credentials', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email','password'], properties: { email: {type:'string'}, password: {type:'string'} }}}}},
          responses: { 200: { description: 'User data with JWT token' }, 401: { description: 'Invalid credentials' }}
        }
      },
      // USERS
      '/api/getusers': { get: { tags: ['Users'], summary: 'List all users', parameters: [{name:'search',in:'query',schema:{type:'string'}}] }},
      '/api/users/{id}': { get: { tags: ['Users'], summary: 'Get user profile', parameters: [{name:'id',in:'path',required:true,schema:{type:'integer'}}] }},
      '/api/updateuser': { put: { tags: ['Users'], summary: 'Update user profile' }},
      '/api/deleteuser/{id}': { delete: { tags: ['Users'], summary: 'Delete user (admin)', parameters: [{name:'id',in:'path',required:true,schema:{type:'integer'}}] }},
      // CHAT
      '/api/rooms': {
        get: { tags: ['Chat'], summary: 'List rooms', parameters: [{name:'language',in:'query',schema:{type:'string'}},{name:'type',in:'query',schema:{type:'string'}}] },
        post: { tags: ['Chat'], summary: 'Create room' }
      },
      '/api/rooms/{id}': {
        get: { tags: ['Chat'], summary: 'Get room details', parameters: [{name:'id',in:'path',required:true,schema:{type:'integer'}}] },
        patch: { tags: ['Chat'], summary: 'Update room (admin)' },
        delete: { tags: ['Chat'], summary: 'Delete room (admin)' }
      },
      '/api/chats': { get: { tags: ['Chat'], summary: 'Get messages with filters', parameters: [{name:'room_id',in:'query',schema:{type:'integer'}},{name:'limit',in:'query',schema:{type:'integer'}},{name:'offset',in:'query',schema:{type:'integer'}}] }},
      '/api/messages/{messageId}': {
        patch: { tags: ['Chat'], summary: 'Edit message (15min window)' },
        delete: { tags: ['Chat'], summary: 'Soft-delete message' }
      },
      // DMs
      '/api/dms': {
        get: { tags: ['DMs'], summary: 'List conversations' },
        post: { tags: ['DMs'], summary: 'Start/get conversation' }
      },
      '/api/dms/{conversationId}/messages': {
        get: { tags: ['DMs'], summary: 'Get DM messages' },
        post: { tags: ['DMs'], summary: 'Send DM message' }
      },
      // VOCABULARY
      '/api/vocabulary': {
        get: { tags: ['Vocabulary'], summary: 'List vocabulary words', parameters: [{name:'language',in:'query',schema:{type:'string'}},{name:'mastery_level',in:'query',schema:{type:'integer'}}] },
        post: { tags: ['Vocabulary'], summary: 'Add vocabulary word' }
      },
      '/api/vocabulary/review': { get: { tags: ['Vocabulary'], summary: 'Get words due for review' }},
      '/api/vocabulary/{id}/review': { post: { tags: ['Vocabulary'], summary: 'Submit review result', requestBody: { content: { 'application/json': { schema: { type:'object', properties: { correct: {type:'boolean'} }}}}}}},
      '/api/vocabulary/stats': { get: { tags: ['Vocabulary'], summary: 'Vocabulary statistics' }},
      // ACHIEVEMENTS
      '/api/achievements': { get: { tags: ['Achievements'], summary: 'List all achievements' }},
      '/api/users/{id}/achievements': { get: { tags: ['Achievements'], summary: 'User earned achievements' }},
      '/api/users/{id}/xp': { get: { tags: ['Achievements'], summary: 'User XP and log' }},
      '/api/leaderboard': { get: { tags: ['Achievements'], summary: 'XP leaderboard (top 20)' }},
      // EVENTS
      '/api/events': {
        get: { tags: ['Events'], summary: 'List upcoming events' },
        post: { tags: ['Events'], summary: 'Create event' }
      },
      '/api/events/{id}/register': { post: { tags: ['Events'], summary: 'Register for event' }},
      '/api/events/my': { get: { tags: ['Events'], summary: 'My events' }},
      // NOTIFICATIONS
      '/api/notifications': { get: { tags: ['Notifications'], summary: 'Get notifications' }},
      '/api/notifications/unread-count': { get: { tags: ['Notifications'], summary: 'Unread count' }},
      '/api/notifications/read-all': { post: { tags: ['Notifications'], summary: 'Mark all read' }},
      // SOCIAL
      '/api/users/{id}/follow': { post: { tags: ['Social'], summary: 'Follow user' }},
      '/api/users/{id}/unfollow': { post: { tags: ['Social'], summary: 'Unfollow user' }},
      '/api/users/{id}/followers': { get: { tags: ['Social'], summary: 'Get followers' }},
      '/api/users/{id}/following': { get: { tags: ['Social'], summary: 'Get following' }},
      '/api/report': { post: { tags: ['Social'], summary: 'Report a message' }},
      '/api/match': { get: { tags: ['Social'], summary: 'Find tandem partner' }},
      // RESOURCES
      '/api/resources': {
        get: { tags: ['Resources'], summary: 'List resources', parameters: [{name:'type',in:'query',schema:{type:'string',enum:['textbook','video','article','link','tool']}},{name:'language',in:'query',schema:{type:'string'}}] },
        post: { tags: ['Resources'], summary: 'Create resource (admin)' }
      },
      '/api/resources/saved': { get: { tags: ['Resources'], summary: 'Saved/bookmarked resources' }},
      '/api/resources/{id}/save': {
        post: { tags: ['Resources'], summary: 'Bookmark resource' },
        delete: { tags: ['Resources'], summary: 'Remove bookmark' }
      },
      // NEWS
      '/api/news': {
        get: { tags: ['News'], summary: 'List published articles', security: [], parameters: [{name:'category',in:'query',schema:{type:'string',enum:['tips','events','stories','updates','world']}}] },
        post: { tags: ['News'], summary: 'Create article (admin)' }
      },
      '/api/news/{slug}': { get: { tags: ['News'], summary: 'Get article by slug', security: [] }},
      // MEMBERSHIPS
      '/api/memberships/plans': { get: { tags: ['Memberships'], summary: 'List membership plans', security: [] }},
      '/api/memberships/my': { get: { tags: ['Memberships'], summary: 'My membership info' }},
      '/api/memberships/subscribe': { post: { tags: ['Memberships'], summary: 'Subscribe to plan' }},
      '/api/memberships/cancel': { post: { tags: ['Memberships'], summary: 'Cancel subscription' }},
      // ANALYTICS
      '/api/analytics/top-users': { get: { tags: ['Analytics'], summary: 'Top users by messages (admin)' }},
      '/api/analytics/messages-per-room': { get: { tags: ['Analytics'], summary: 'Messages per room (admin)' }},
      '/api/analytics/active-users-timeline': { get: { tags: ['Analytics'], summary: 'Active users 24h/7d/30d (admin)' }},
      '/api/analytics/flood-detection': { get: { tags: ['Analytics'], summary: 'Spam detection (admin)' }},
      '/api/analytics/audit-log': { get: { tags: ['Analytics'], summary: 'Moderation audit log (admin)' }},
      '/api/analytics/banned-words': {
        get: { tags: ['Analytics'], summary: 'List banned words (admin)' },
        post: { tags: ['Analytics'], summary: 'Add banned word (admin)' }
      },
      // SEARCH
      '/api/search': { get: { tags: ['Search'], summary: 'Global search', parameters: [{name:'q',in:'query',required:true,schema:{type:'string'}},{name:'type',in:'query',schema:{type:'string',enum:['all','users','rooms','messages']}}] }},
      // STATS
      '/api/stats': { get: { tags: ['Analytics'], summary: 'Dashboard stats (users, rooms, messages count)' }},
      '/api/user/stats/{userId}': { get: { tags: ['Users'], summary: 'User statistics', parameters: [{name:'userId',in:'path',required:true,schema:{type:'integer'}}] }},
    },
  },
  apis: [], // We define paths inline above
};

const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;

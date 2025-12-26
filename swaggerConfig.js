// swaggerConfig.js

import swaggerJSDoc from 'swagger-jsdoc';

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'API Commulab Tutor AI Psikologi (Backend)',
        version: '1.0.0',
        description: 'API backend untuk manajemen pasien, sesi, transkrip, dan analisis kinerja konselor (melalui model AI dan Gemini).',
    },
    servers: [
        {
            url: 'http://localhost:3000/api', // Sesuaikan dengan base URL API
            description: 'Server Pengembangan Lokal',
        },
    ],
    components: {
        securitySchemes: {
            // Skema otentikasi Bearer Token
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
        },
    },
    security: [
        // Default untuk semua endpoint
        {
            bearerAuth: [], 
        },
    ],
};

const options = {
    swaggerDefinition,
    // Path to API docs (tempat swagger-jsdoc mencari file route)
    apis: ['./routes/*.js',
  './docs/*.swagger.js'], 
};

export const swaggerSpec = swaggerJSDoc(options);
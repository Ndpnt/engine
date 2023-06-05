import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import swaggerJsdoc from 'swagger-jsdoc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

router.get('/', (req, res) => {
  res.json(swaggerJsdoc({
    definition: {
      swagger: '2.0',
      openapi: '3.1.0',
      info: {
        title: 'Open Terms Archive API',
        version: '1.0.0',
        license: {
          name: 'EUPL-1.2',
          url: 'https://eupl.eu/1.2/',
        },
      },
    },
    apis: [`${__dirname}/*.js`],
  }));
});

export default router;

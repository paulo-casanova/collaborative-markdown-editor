export const BACKEND_PORT = process.env.TEST_BACKEND_PORT || '8088';
export const BACKEND_URL = process.env.TEST_API_URL || `http://127.0.0.1:${BACKEND_PORT}`;

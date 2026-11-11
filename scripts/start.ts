// Set production before loading the server, on macOS and Windows alike.
process.env.NODE_ENV = 'production';
await import('../server');
export {};

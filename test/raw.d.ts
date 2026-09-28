// Vite `?raw` imports, used by test/scheduled.test.ts to read wrangler.toml.
declare module '*?raw' {
  const content: string;
  export default content;
}

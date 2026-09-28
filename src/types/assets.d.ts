/** Ambient module for binary font assets bundled via the wrangler "Data" rule in wrangler.toml. */
declare module '*.woff2' {
  const data: ArrayBuffer;
  export default data;
}

/** Ambient module for the default logo, bundled as inline text via the wrangler "Text" rule (R17 task 6). */
declare module '*.svg' {
  const markup: string;
  export default markup;
}

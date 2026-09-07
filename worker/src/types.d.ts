declare module '*.ttf' {
  const content: ArrayBuffer;
  export default content;
}

declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
